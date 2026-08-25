import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium, type Browser, type BrowserContext } from "playwright";

import { discoverAdb } from "./android.js";
import type { IStandalonePlaytestConfig } from "./config.js";
import { DeviceMetricsRecorder, type IPlaytestDeviceMetricsObservation } from "./deviceMetrics.js";
import { findFreePort } from "./sampling.js";
import { runStandalonePlaytest, type IStandalonePlaytestReport } from "./runner.js";

const execFileAsync = promisify(execFile);
const CHROME_PACKAGE = "com.android.chrome";
const CHROME_COMPONENT = `${CHROME_PACKAGE}/com.google.android.apps.chrome.Main`;

export interface IAndroidBrowserDependencies {
  connectOverCDP(endpoint: string): Promise<Browser>;
  execAdb(adbPath: string, serial: string, args: readonly string[]): Promise<string>;
  findFreePort(): Promise<number>;
}

const DEFAULT_DEPENDENCIES: IAndroidBrowserDependencies = {
  connectOverCDP: (endpoint) => chromium.connectOverCDP(endpoint),
  execAdb: async (adbPath, serial, args) => {
    try {
      const { stdout } = await execFileAsync(adbPath, ["-s", serial, ...args], {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      const detail = error as Error & { stderr?: string; stdout?: string };
      throw new Error(detail.stderr || detail.stdout || detail.message);
    }
  },
  findFreePort,
};

export function androidBrowserUrl(source: string): { port: number; url: string } {
  const url = new URL(source);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`TN_PLAYTEST_PAGE_UNREACHABLE: Android Chrome requires an http or https --url, got '${source}'.`);
  }
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  url.hostname = "127.0.0.1";
  // URL serialisation hides default ports, so build the authority explicitly. The Android side
  // must name the exact reverse mapping even when the source used the scheme default.
  const authority = `127.0.0.1:${port}`;
  return { port, url: `${url.protocol}//${authority}${url.pathname}${url.search}${url.hash}` };
}

export class AndroidChromeBrowserSession {
  private browser?: Browser;
  private cdpPort?: number;
  private metrics?: DeviceMetricsRecorder;
  private reversePort?: number;

  constructor(
    private readonly config: IStandalonePlaytestConfig,
    private readonly dependencies: IAndroidBrowserDependencies = DEFAULT_DEPENDENCIES,
  ) {}

  async prepare(activeConfig: IStandalonePlaytestConfig): Promise<void> {
    const serial = this.requiredSerial();
    const adbPath = this.config.adbPath ?? discoverAdb();
    const adb = (args: readonly string[]) => this.dependencies.execAdb(adbPath, serial, args);
    try {
      const state = (await adb(["get-state"])).trim();
      if (state !== "device") throw new Error(`adb state was '${state || "empty"}'`);
      this.metrics = new DeviceMetricsRecorder({ adb, serial });
      await this.metrics.sampleNow("before").catch(() => undefined);
      this.metrics.start();

      const device = androidBrowserUrl(activeConfig.url);
      this.reversePort = device.port;
      await adb(["reverse", `tcp:${device.port}`, `tcp:${device.port}`]);
      this.cdpPort = await this.dependencies.findFreePort();
      await adb(["forward", `tcp:${this.cdpPort}`, "localabstract:chrome_devtools_remote"]);
      await adb(["shell", "am", "force-stop", CHROME_PACKAGE]);
      await adb([
        "shell", "am", "start", "-W",
        "-a", "android.intent.action.VIEW",
        "-n", CHROME_COMPONENT,
        "-d", device.url,
      ]);
    } catch (error) {
      await this.close();
      throw deviceFailure(serial, error);
    }
  }

  async connect(): Promise<Browser> {
    const serial = this.requiredSerial();
    if (this.cdpPort === undefined) throw deviceFailure(serial, "CDP forward was not prepared");
    try {
      this.browser = await this.dependencies.connectOverCDP(`http://127.0.0.1:${this.cdpPort}`);
      return this.browser;
    } catch (error) {
      throw deviceFailure(serial, `Chrome CDP was unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async context(browser: Browser): Promise<BrowserContext> {
    const context = browser.contexts()[0];
    if (context === undefined) throw deviceFailure(this.requiredSerial(), "Chrome CDP exposed no default browser context");
    return context;
  }

  async finish(): Promise<IPlaytestDeviceMetricsObservation | undefined> {
    if (this.metrics === undefined) return undefined;
    await this.metrics.sampleNow("after").catch(() => undefined);
    this.metrics.stop();
    return this.metrics.observation();
  }

  async close(): Promise<void> {
    this.metrics?.stop();
    const serial = this.config.device;
    if (serial === undefined) return;
    const adbPath = this.config.adbPath ?? discoverAdb();
    const adb = (args: readonly string[]) => this.dependencies.execAdb(adbPath, serial, args);
    // Remove exactly the mappings and Chrome process this run owns. Other adb users survive.
    await adb(["shell", "am", "force-stop", CHROME_PACKAGE]).catch(() => undefined);
    if (this.cdpPort !== undefined) {
      await adb(["forward", "--remove", `tcp:${this.cdpPort}`]).catch(() => undefined);
      this.cdpPort = undefined;
    }
    if (this.reversePort !== undefined) {
      await adb(["reverse", "--remove", `tcp:${this.reversePort}`]).catch(() => undefined);
      this.reversePort = undefined;
    }
  }

  private requiredSerial(): string {
    if (this.config.device === undefined) {
      throw new Error("TN_PLAYTEST_DEVICE_FAILED: Android Chrome requires --device <serial>.");
    }
    return this.config.device;
  }
}

export async function runAndroidBrowserPlaytest(
  config: IStandalonePlaytestConfig,
  dependencies: IAndroidBrowserDependencies = DEFAULT_DEPENDENCIES,
): Promise<IStandalonePlaytestReport> {
  const session = new AndroidChromeBrowserSession(config, dependencies);
  return runStandalonePlaytest(config, { remoteBrowser: session });
}

export async function runAndroidBrowserPlaytests(
  config: IStandalonePlaytestConfig,
): Promise<readonly IStandalonePlaytestReport[]> {
  const scenarioPaths = config.scenarioPaths ?? [config.scenarioPath];
  const reports: IStandalonePlaytestReport[] = [];
  for (const [index, scenarioPath] of scenarioPaths.entries()) {
    reports.push(await runAndroidBrowserPlaytest({
      ...config,
      artifactDirectory: scenarioPaths.length === 1
        ? config.artifactDirectory
        : `${config.artifactDirectory}/${String(index + 1).padStart(2, "0")}`,
      scenarioPath,
      scenarioPaths: undefined,
    }));
  }
  return reports;
}

function deviceFailure(serial: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`TN_PLAYTEST_DEVICE_FAILED: Android Chrome device '${serial}' failed: ${detail}`);
}
