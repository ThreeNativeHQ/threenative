import { existsSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

import { discoverAdb } from "./android.js";
import { HOT_START_TEMPERATURE_C, parseDeviceBattery, parseDeviceThermal } from "./deviceMetrics.js";

/**
 * `threenative-playtest doctor` — answer "can this machine run a playtest at all?" before a
 * scenario answers "does the game work?".
 *
 * The failures this catches are the ones that read as a broken game: a missing browser binary
 * looks like a launch failure, an absent display turns every screenshot assertion red, and a
 * missing `adb` reports as a device that would not answer. Each check therefore says which
 * capability it costs and the one command that restores it.
 */

export type DoctorStatus = "ok" | "warn" | "fail";

export interface IDoctorCheck {
  readonly detail: string;
  readonly fix?: string;
  readonly name: string;
  readonly status: DoctorStatus;
}

export interface IDoctorReport {
  readonly checks: readonly IDoctorCheck[];
  readonly pass: boolean;
}

export interface IHarnessEnvironment {
  /** Absolute path of the browser Playwright would launch, or undefined when it is not downloaded. */
  readonly browserExecutable: () => string | undefined;
  readonly display: string | undefined;
  /**
   * Absolute path of an adb outside PATH — an SDK install the Android driver and `doctor
   * --device` both reach through `discoverAdb`. Without it, a machine whose adb lives only in
   * `~/Android/Sdk/platform-tools` is told `--target android` cannot run, in the same report
   * that names the device it just reached.
   */
  readonly discoverAdbPath?: () => string | undefined;
  readonly hasCommand: (command: string) => boolean;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly resolveModule: (specifier: string) => string | undefined;
}

const MINIMUM_NODE_MAJOR = 20;

function nodeCheck(version: string): IDoctorCheck {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (Number.isNaN(major)) {
    return {
      detail: `could not read a major version from '${version}'`,
      fix: `Install Node ${MINIMUM_NODE_MAJOR} or newer.`,
      name: "node",
      status: "fail",
    };
  }
  if (major < MINIMUM_NODE_MAJOR) {
    return {
      detail: `node ${version} is older than the ${MINIMUM_NODE_MAJOR} this runner needs`,
      fix: `Install Node ${MINIMUM_NODE_MAJOR} or newer.`,
      name: "node",
      status: "fail",
    };
  }
  return { detail: `node ${version}`, name: "node", status: "ok" };
}

function displayCheck(environment: IHarnessEnvironment): IDoctorCheck {
  if (environment.platform !== "linux") {
    return { detail: `${environment.platform} provides its own display`, name: "display", status: "ok" };
  }
  if (environment.display !== undefined && environment.display.length > 0) {
    return { detail: `DISPLAY=${environment.display}`, name: "display", status: "ok" };
  }
  if (environment.hasCommand("Xvfb")) {
    return {
      detail: "no DISPLAY, but Xvfb is installed, so headless screenshot runs can get one",
      fix: "Prefix the run with 'sh scripts/xvfb.sh' (never 'xvfb-run').",
      name: "display",
      status: "ok",
    };
  }
  return {
    detail: "no DISPLAY and no Xvfb: screenshot and visual assertions have nowhere to draw",
    fix: "Install Xvfb, then prefix the run with 'sh scripts/xvfb.sh' (never 'xvfb-run').",
    name: "display",
    status: "warn",
  };
}

function deviceToolCheck(
  environment: IHarnessEnvironment,
  command: string,
  target: string,
  fix: string,
): IDoctorCheck {
  if (environment.hasCommand(command)) {
    return { detail: `${command} is on PATH, so --target ${target} can run`, name: command, status: "ok" };
  }
  const discovered = command === "adb" ? environment.discoverAdbPath?.() : undefined;
  if (discovered !== undefined) {
    return {
      detail: `${discovered} (off PATH, discovered in the SDK), so --target ${target} can run`,
      name: command,
      status: "ok",
    };
  }
  return {
    detail: `${command} is not on PATH, so --target ${target} cannot run here`,
    fix,
    name: command,
    status: "warn",
  };
}

export function diagnoseHarness(environment: IHarnessEnvironment): IDoctorReport {
  const playwright = environment.resolveModule("playwright");
  const browser = playwright === undefined ? undefined : environment.browserExecutable();
  const checks: IDoctorCheck[] = [
    nodeCheck(environment.nodeVersion),
    playwright === undefined
      ? {
          detail: "playwright is an optional peer of this package and is not installed",
          fix: "Install it: 'npm install -D playwright'.",
          name: "playwright",
          status: "fail",
        }
      : { detail: playwright, name: "playwright", status: "ok" },
    browser === undefined
      ? {
          detail: "playwright has no chromium binary downloaded, so no browser run can launch",
          fix: "Download it: 'npx playwright install chromium'.",
          name: "chromium",
          status: "fail",
        }
      : { detail: browser, name: "chromium", status: "ok" },
    displayCheck(environment),
    deviceToolCheck(
      environment,
      "adb",
      "android",
      "Install the Android SDK platform-tools; if it is installed already, put its 'platform-tools' on PATH.",
    ),
    deviceToolCheck(environment, "xcrun", "ios", "Install Xcode command line tools (macOS only)."),
  ];
  return { checks, pass: checks.every(({ status }) => status !== "fail") };
}

/**
 * Battery floor a measurement lane needs. The playtest doctor only *reports* it; the gate that
 * refuses a run below it is `packages/runtime-native/scripts/device-preflight.mjs`, and the two
 * numbers are deliberately the same so an operator is never told two different stories.
 */
export const COOL_ENOUGH_BATTERY_PERCENT = 50;

export type DeviceProbe = (args: readonly string[]) => Promise<string>;

/**
 * `doctor --device <serial>` answers the one question the run report can only answer too late:
 * **is the phone cool enough to start?**
 *
 * `observations.deviceMetrics` flags a confounded run, but by then the run is spent. This asks
 * first. It reports rather than refuses — a hot device is a run that will not be comparable,
 * not a broken machine — so thermal, charging and battery conditions are `warn` and `pass`
 * survives them. Only an unreachable device or an unparsable probe is `fail`: a probe that
 * cannot be read must never be reported as a healthy zero.
 */
export async function diagnoseDevice(serial: string, probe: DeviceProbe): Promise<IDoctorReport> {
  const state = (await probe(["get-state"]).catch((error: unknown) =>
    `unreachable: ${error instanceof Error ? error.message : String(error)}`)).trim();
  if (state !== "device") {
    return {
      checks: [{
        detail: `${serial} is not online (adb state: ${state.length === 0 ? "missing" : state})`,
        fix: `Reconnect it: 'adb connect ${serial}' for a Wi-Fi device, or replug and 'adb devices'.`,
        name: "device",
        status: "fail",
      }],
      pass: false,
    };
  }
  const thermal = await read(probe, ["shell", "dumpsys", "thermalservice"], parseDeviceThermal);
  const battery = await read(probe, ["shell", "dumpsys", "battery"], parseDeviceBattery);
  const checks: IDoctorCheck[] = [
    { detail: `${serial} is online`, name: "device", status: "ok" },
    thermalCheck(thermal, battery),
    ...batteryChecks(battery),
  ];
  return { checks, pass: checks.every(({ status }) => status !== "fail") };
}

/** A probe that cannot be read is an error carried forward, never a healthy-looking zero. */
async function read<T>(
  probe: DeviceProbe,
  args: readonly string[],
  parse: (output: string) => T,
): Promise<T | Error> {
  try {
    return parse(await probe(args));
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function thermalCheck(
  thermal: ReturnType<typeof parseDeviceThermal> | Error,
  battery: ReturnType<typeof parseDeviceBattery> | Error,
): IDoctorCheck {
  if (thermal instanceof Error) return probeFailure("device.thermal", thermal);
  const skin = thermal.skinTemperatureC.available
    ? `, skin ${round(thermal.skinTemperatureC.value)} °C`
    : "";
  const temperature = battery instanceof Error ? undefined : battery.temperatureC;
  const detail = `${temperature === undefined ? "" : `battery ${temperature} °C, `}thermal status ${thermal.status} (${thermal.statusName})${skin}`;
  const hot = temperature !== undefined && temperature >= HOT_START_TEMPERATURE_C;
  if (!hot && thermal.status === 0) return { detail, name: "device.thermal", status: "ok" };
  return {
    detail,
    fix: `Let it cool below ${HOT_START_TEMPERATURE_C} °C at thermal status 0 before measuring; a run started here is flagged thermally confounded and is not comparable with a cool one.`,
    name: "device.thermal",
    status: "warn",
  };
}

function batteryChecks(battery: ReturnType<typeof parseDeviceBattery> | Error): IDoctorCheck[] {
  if (battery instanceof Error) return [probeFailure("device.battery", battery)];
  const level: IDoctorCheck = battery.levelPercent >= COOL_ENOUGH_BATTERY_PERCENT
    ? { detail: `battery ${battery.levelPercent}%`, name: "device.battery", status: "ok" }
    : {
        detail: `battery ${battery.levelPercent}%, under the ${COOL_ENOUGH_BATTERY_PERCENT}% a measurement lane needs`,
        fix: "Charge it, then unplug and reconnect over Wi-Fi adb before measuring.",
        name: "device.battery",
        status: "warn",
      };
  const charging: IDoctorCheck = battery.charging
    ? {
        detail: `charging (dumpsys battery status ${battery.status}), so current draw and rail power are the charger's, not the game's`,
        fix: "Unplug it and reach it over Wi-Fi adb instead: 'adb tcpip 5555' then 'adb connect <ip>:5555'.",
        name: "device.charging",
        status: "warn",
      }
    : { detail: `discharging (dumpsys battery status ${battery.status})`, name: "device.charging", status: "ok" };
  return [level, charging];
}

function probeFailure(name: string, error: unknown): IDoctorCheck {
  return {
    detail: error instanceof Error ? error.message : String(error),
    fix: "Check the device is unlocked and reachable over adb, then rerun doctor.",
    name,
    status: "fail",
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Real adb, discovered the same way the Android driver discovers it. */
export function readDeviceProbe(serial: string): DeviceProbe {
  const execFileAsync = promisify(execFile);
  const adbPath = discoverAdb();
  return async (args) => {
    const { stdout } = await execFileAsync(adbPath, ["-s", serial, ...args], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  };
}

function commandExists(command: string): boolean {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function readHarnessEnvironment(): IHarnessEnvironment {
  const require = createRequire(import.meta.url);
  const resolveModule = (specifier: string): string | undefined => {
    try {
      return require.resolve(specifier);
    } catch {
      return undefined;
    }
  };
  return {
    browserExecutable: () => {
      try {
        // Playwright throws when the browser was never downloaded, and returns a stale path
        // when it was removed by hand, so the path is confirmed on disk before it is reported.
        const { chromium } = require("playwright") as {
          chromium: { executablePath: () => string };
        };
        const executable = chromium.executablePath();
        return existsSync(executable) ? executable : undefined;
      } catch {
        return undefined;
      }
    },
    display: process.env.DISPLAY,
    discoverAdbPath: () => {
      const discovered = discoverAdb();
      return discovered === "adb" ? undefined : discovered;
    },
    hasCommand: commandExists,
    nodeVersion: process.versions.node,
    platform: process.platform,
    resolveModule,
  };
}

export function formatDoctorReport(report: IDoctorReport): string {
  const symbols: Record<DoctorStatus, string> = { fail: "✗", ok: "✓", warn: "!" };
  const lines = report.checks.map(
    ({ detail, fix, name, status }) =>
      `${symbols[status]} ${name}: ${detail}${fix === undefined || status === "ok" ? "" : `\n    fix: ${fix}`}`,
  );
  lines.push(report.pass ? "" : "\nAt least one check failed; a playtest run here would not be evidence.");
  return `${lines.join("\n")}\n`;
}
