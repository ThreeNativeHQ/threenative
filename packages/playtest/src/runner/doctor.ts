import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

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
