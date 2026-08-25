import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

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
  private readonly baselinePages = new Set<Page>();
  private browser?: Browser;
  private cdpPort?: number;
  private cdpForwardCreated = false;
  private chromeOwnedPid?: string;
  private defaultContext?: BrowserContext;
  private metrics?: DeviceMetricsRecorder;
  private reversePort?: number;
  private reverseCreated = false;

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
      const localReverse = `tcp:${device.port}`;
      const reverseList = await adb(["reverse", "--list"]);
      if (reverseList.split("\n").some((line) => line.trim().split(/\s+/u)[1] === localReverse)) {
        throw new Error(`adb reverse for device port ${device.port} already exists; refusing to replace a mapping this run does not own`);
      }
      await adb(["reverse", "--no-rebind", localReverse, localReverse]);
      this.reversePort = device.port;
      this.reverseCreated = true;
      this.cdpPort = await this.dependencies.findFreePort();
      await adb(["forward", "--no-rebind", `tcp:${this.cdpPort}`, "localabstract:chrome_devtools_remote"]);
      this.cdpForwardCreated = true;
      const chromeWasRunning = (await adb(["shell", "pidof", CHROME_PACKAGE])).trim().length > 0;
      if (chromeWasRunning) await this.connectAndSnapshot();
      await adb([
        "shell", "am", "start", "-W",
        "-n", CHROME_COMPONENT,
      ]);
      if (!chromeWasRunning) {
        const pid = (await adb(["shell", "pidof", CHROME_PACKAGE])).trim();
        if (pid.length > 0) this.chromeOwnedPid = pid;
      }
    } catch (error) {
      await this.close();
      throw deviceFailure(serial, error);
    }
  }

  async connect(): Promise<Browser> {
    if (this.browser === undefined) await this.connectBrowser();
    return this.browser!;
  }

  async context(browser: Browser): Promise<BrowserContext> {
    const context = this.defaultContext ?? browser.contexts()[0];
    if (context === undefined) throw deviceFailure(this.requiredSerial(), "Chrome CDP exposed no default browser context");
    this.defaultContext = context;
    return context;
  }

  navigationUrl(config: IStandalonePlaytestConfig): string {
    return androidBrowserUrl(config.url).url;
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
    for (const page of this.defaultContext?.pages() ?? []) {
      if (!this.baselinePages.has(page)) await page.close().catch(() => undefined);
    }
    if (this.chromeOwnedPid !== undefined) {
      const currentPid = await adb(["shell", "pidof", CHROME_PACKAGE]).catch(() => "");
      if (currentPid.trim() === this.chromeOwnedPid) {
        await adb(["shell", "am", "force-stop", CHROME_PACKAGE]).catch(() => undefined);
      }
      this.chromeOwnedPid = undefined;
    }
    if (this.cdpPort !== undefined && this.cdpForwardCreated) {
      await adb(["forward", "--remove", `tcp:${this.cdpPort}`]).catch(() => undefined);
      this.cdpForwardCreated = false;
    }
    this.cdpPort = undefined;
    if (this.reversePort !== undefined && this.reverseCreated) {
      await adb(["reverse", "--remove", `tcp:${this.reversePort}`]).catch(() => undefined);
      this.reverseCreated = false;
    }
    this.reversePort = undefined;
  }

  private async connectAndSnapshot(): Promise<void> {
    const browser = await this.connectBrowser();
    const context = browser.contexts()[0];
    if (context === undefined) throw deviceFailure(this.requiredSerial(), "Chrome CDP exposed no default browser context");
    this.defaultContext = context;
    for (const page of context.pages()) this.baselinePages.add(page);
  }

  private async connectBrowser(): Promise<Browser> {
    const serial = this.requiredSerial();
    if (this.cdpPort === undefined) throw deviceFailure(serial, "CDP forward was not prepared");
    try {
      this.browser = await this.dependencies.connectOverCDP(`http://127.0.0.1:${this.cdpPort}`);
      return this.browser;
    } catch (error) {
      throw deviceFailure(serial, `Chrome CDP was unreachable: ${error instanceof Error ? error.message : String(error)}`);
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
