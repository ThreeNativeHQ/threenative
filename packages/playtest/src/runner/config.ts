import { readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { WEBGPU_BROWSER_ARGS } from "./browser.js";

export interface IPlaytestServerConfig {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface IStandalonePlaytestConfig {
  /**
   * Accept a software WebGPU adapter. Off by default: without `--enable-features=Vulkan`, or
   * headless on a host whose GPU the browser will not reach, Chromium serves WebGPU from
   * SwiftShader and nothing errors — the adapter answers, limits look healthy, and the run
   * reports a CPU rasteriser's results. A run that cannot name a hardware adapter is not
   * render evidence, so it fails unless the operator says otherwise.
   */
  allowSoftwareAdapter?: boolean;
  android?: { activity: string; packageName: string };
  adbPath?: string;
  /** @see IAndroidDriverOptions.touchRotation */
  touchRotation?: number;
  artifactDirectory: string;
  browserArgs?: readonly string[];
  device?: string;
  desktop?: { executable: string };
  endpoint?: string;
  headless: boolean;
  ios?: { appPath?: string; bundleId: string; transport: "device" | "simulator" };
  mailboxRoot?: string;
  port?: number;
  projectPath: string;
  scenarioPath: string;
  scenarioPaths?: readonly string[];
  server?: IPlaytestServerConfig;
  timeoutMs: number;
  target?: "android" | "browser" | "desktop" | "ios";
  trace: boolean;
  url: string;
  xcrunPath?: string;
}

export interface IPlaytestFlagHelp {
  default: string;
  summary: string;
  takesValue: boolean;
  allowDashValue?: boolean;
  repeatable?: boolean;
}

export const PLAYTEST_FLAGS = {
  "--adb": { default: "auto-discover", summary: "absolute adb executable path", takesValue: true },
  "--touch-rotation": {
    default: "read from the device",
    summary: "Android raw-touch rotation (0-3) when the app's window and the display disagree",
    takesValue: true,
  },
  "--allow-software": { default: "false", summary: "accept a software WebGPU adapter as evidence", takesValue: false },
  "--activity": { default: ".MystralActivity", summary: "Android launch activity", takesValue: true },
  "--app": { default: "required for iOS", summary: "built iOS .app bundle", takesValue: true },
  "--artifacts": { default: "artifacts/playtest", summary: "artifact output directory", takesValue: true },
  "--browser-arg": { allowDashValue: true, default: "none (repeatable)", repeatable: true, summary: "one additional Chromium argument", takesValue: true },
  "--browser-recipe": { default: "none", summary: "named browser recipe (webgpu)", takesValue: true },
  "--bundle-id": { default: "dev.threenative.runtime", summary: "iOS application bundle identifier", takesValue: true },
  "--device": { default: "platform default", summary: "Android serial or iOS device identifier", takesValue: true },
  "--executable": { default: "required for desktop", summary: "native desktop game executable", takesValue: true },
  "--endpoint": { default: "http://127.0.0.1:41777/playtest", summary: "device bridge endpoint", takesValue: true },
  "--headed": { default: "false", summary: "show the browser window", takesValue: false },
  "--mailbox-root": { default: "Android external files directory", summary: "native device mailbox directory", takesValue: true },
  "--ios-transport": { default: "simulator", summary: "iOS transport (simulator or device)", takesValue: true },
  "--project": { default: ".", summary: "project root used to resolve paths", takesValue: true },
  "--package": { default: "com.mystral.engine", summary: "Android application id", takesValue: true },
  "--scenario": { default: "required (or positional; repeatable)", repeatable: true, summary: "scenario JSON path or glob", takesValue: true },
  "--server-command": { default: "none", summary: "command for a managed app server", takesValue: true },
  "--server-timeout": { default: "15000", summary: "managed server readiness timeout in ms", takesValue: true },
  "--timeout": { default: "15000", summary: "page operation timeout in ms", takesValue: true },
  "--target": { default: "browser", summary: "execution target (browser, android, desktop, or ios)", takesValue: true },
  "--trace": { default: "false", summary: "write a Playwright trace", takesValue: false },
  "--url": { default: "http://127.0.0.1:5173 (or a free managed port)", summary: "application URL", takesValue: true },
  "--port": { default: "free when managing a server", summary: "managed server port (0 chooses a free port)", takesValue: true },
  "--xcrun": { default: "auto-discover", summary: "absolute xcrun executable path", takesValue: true },
} as const satisfies Record<string, IPlaytestFlagHelp>;

export class PlaytestCliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaytestCliUsageError";
  }
}

export function formatUsage(): string {
  const flags = Object.entries(PLAYTEST_FLAGS).map(([name, details]) =>
    `  ${name.padEnd(20)} ${details.summary} (default: ${details.default})`,
  );
  return [
    "Usage: threenative-playtest <scenario> [options]",
    "       threenative-playtest --scenario <path> [options]",
    "",
    "Commands:",
    "  doctor                check this machine can run a playtest at all",
    "                        --url <url> also reports the running scene at a glance",
    "                        --device <serial> also reports whether that Android device is",
    "                        cool enough, charged enough and discharging to measure on",
    "                        --text prints either as a human-readable report;",
    "                        --browser-arg extends the WebGPU recipe, repeatable",
    "  init                  create a starter playtest configuration",
    "  record-to-scenario    convert a replay recording into a scenario",
    "                        (requires --oracle <json> and --out <json>)",
    "",
    "Options:",
    ...flags,
    "  --help                print this help and exit 0",
    "",
    "Exit codes:",
    "  0  playtest passed",
    "  1  assertions failed",
    "  2  the run never reached assertions",
    "  75  the capture lock timed out — not a test failure; rerun when the queue clears",
    "",
  ].join("\n");
}

export function parseStandalonePlaytestArgs(argv: readonly string[], cwd = process.cwd()): IStandalonePlaytestConfig {
  const flags = parseFlags(argv);
  const scenarioPatterns = flags.get("--scenario") ?? [positional(argv)].filter((value): value is string => value !== undefined);
  if (scenarioPatterns.length === 0) {
    throw new PlaytestCliUsageError("Missing scenario path. Run: threenative-playtest --scenario playtests/movement.playtest.json --url http://127.0.0.1:5173");
  }
  const urlFlag = flags.get("--url")?.[0];
  const url = urlFlag ?? "http://127.0.0.1:5173";
  const target = flags.get("--target")?.[0] ?? "browser";
  if (target !== "browser" && target !== "android" && target !== "desktop" && target !== "ios") {
    throw new PlaytestCliUsageError(`Unknown target '${target}'. Expected 'browser', 'android', 'desktop', or 'ios'.`);
  }
  const projectPath = resolve(cwd, flags.get("--project")?.[0] ?? ".");
  const serverCommand = flags.get("--server-command")?.[0];
  const requestedPort = readPort(flags.get("--port")?.[0]);
  const urlPort = portFromUrl(url);
  const effectivePort = requestedPort ?? (serverCommand === undefined || urlFlag !== undefined ? urlPort : undefined);
  if (requestedPort !== undefined && requestedPort > 0 && urlFlag !== undefined && urlPort !== undefined && requestedPort !== urlPort) {
    throw new PlaytestCliUsageError(`--port ${requestedPort} conflicts with the port in --url (${urlPort}).`);
  }
  const scenarioPaths = scenarioPatterns.flatMap((pattern) => expandScenarioPattern(projectPath, pattern));
  if (scenarioPaths.length === 0) {
    throw new PlaytestCliUsageError("No scenario files matched the requested patterns.");
  }
  const appPath = flags.get("--app")?.[0];
  const executable = flags.get("--executable")?.[0];
  if (target === "desktop" && executable === undefined) {
    throw new PlaytestCliUsageError("Desktop playtest requires --executable <native-game-executable>.");
  }
  const iosTransport = flags.get("--ios-transport")?.[0] ?? "simulator";
  if (iosTransport !== "simulator" && iosTransport !== "device") {
    throw new PlaytestCliUsageError(`Unknown iOS transport '${iosTransport}'. Expected 'simulator' or 'device'.`);
  }
  const explicitBrowserArgs = flags.get("--browser-arg") ?? [];
  const browserRecipe = flags.get("--browser-recipe")?.[0];
  if (browserRecipe !== undefined && browserRecipe !== "webgpu") {
    throw new PlaytestCliUsageError(`Unknown browser recipe '${browserRecipe}'. Expected 'webgpu'.`);
  }
  if (browserRecipe !== undefined && explicitBrowserArgs.length > 0) {
    throw new PlaytestCliUsageError("Choose --browser-recipe or --browser-arg, not both.");
  }
  const device = flags.get("--device")?.[0];
  if (target === "browser" && device !== undefined) {
    if (browserRecipe !== undefined) {
      throw new PlaytestCliUsageError("Android Chrome device runs cannot honor --browser-recipe; remove it.");
    }
    if (explicitBrowserArgs.length > 0) {
      throw new PlaytestCliUsageError("Android Chrome device runs cannot honor --browser-arg; remove it.");
    }
    if (argv.includes("--headed")) {
      throw new PlaytestCliUsageError("Android Chrome device runs are already visible on the device and cannot honor --headed; remove it.");
    }
  }
  const rawTouchRotation = flags.get("--touch-rotation")?.[0];
  // Fail closed rather than defaulting: a mistyped rotation that quietly became 0 would put every
  // injected touch somewhere else and report the game as broken.
  if (rawTouchRotation !== undefined && !/^[0-3]$/u.test(rawTouchRotation)) {
    throw new Error(
      `TN_PLAYTEST_ANDROID_ROTATION_INVALID: --touch-rotation must be 0, 1, 2 or 3, got '${rawTouchRotation}'.`,
    );
  }
  const touchRotation = rawTouchRotation === undefined ? undefined : Number(rawTouchRotation);
  const browserArgs =
    explicitBrowserArgs.length > 0
      ? explicitBrowserArgs
      : browserRecipe === "webgpu"
        ? [...WEBGPU_BROWSER_ARGS]
        : [];
  return {
    ...(flags.get("--adb")?.[0] === undefined ? {} : { adbPath: flags.get("--adb")![0] }),
    ...(touchRotation === undefined ? {} : { touchRotation }),
    allowSoftwareAdapter: argv.includes("--allow-software"),
    android: {
      activity: flags.get("--activity")?.[0] ?? ".MystralActivity",
      packageName: flags.get("--package")?.[0] ?? "com.mystral.engine",
    },
    artifactDirectory: resolve(projectPath, flags.get("--artifacts")?.[0] ?? "artifacts/playtest"),
    ...(browserArgs.length === 0 ? {} : { browserArgs }),
    ...(device === undefined ? {} : { device }),
    ...(executable === undefined ? {} : { desktop: { executable: resolve(projectPath, executable) } }),
    endpoint: flags.get("--endpoint")?.[0] ?? "http://127.0.0.1:41777/playtest",
    headless: !argv.includes("--headed"),
    ios: {
      ...(appPath === undefined ? {} : { appPath: resolve(projectPath, appPath) }),
      bundleId: flags.get("--bundle-id")?.[0] ?? "dev.threenative.runtime",
      transport: iosTransport,
    },
    ...(flags.get("--mailbox-root")?.[0] === undefined ? {} : { mailboxRoot: flags.get("--mailbox-root")![0] }),
    ...(serverCommand === undefined
      ? effectivePort === undefined ? {} : { port: effectivePort }
      : { port: effectivePort ?? 0 }),
    projectPath,
    scenarioPath: scenarioPaths[0]!,
    scenarioPaths,
    ...(serverCommand === undefined
      ? {}
      : { server: { command: serverCommand, cwd: projectPath, timeoutMs: readPositiveInteger(flags.get("--server-timeout")?.[0], 15_000) } }),
    timeoutMs: readPositiveInteger(flags.get("--timeout")?.[0], 15_000),
    target,
    trace: argv.includes("--trace"),
    url: requestedPort !== undefined && requestedPort > 0 && (urlFlag === undefined || urlPort === undefined)
      ? withPort(url, requestedPort)
      : url,
    ...(flags.get("--xcrun")?.[0] === undefined ? {} : { xcrunPath: flags.get("--xcrun")![0] }),
  };
}

const SCENARIO_GLOB = /[*?[]/u;

function expandScenarioPattern(projectPath: string, pattern: string): string[] {
  if (!SCENARIO_GLOB.test(pattern)) return [pattern];
  const normalizedPattern = pattern.replaceAll("\\", "/");
  const matches: string[] = [];
  collectScenarioFiles(projectPath, projectPath, matches);
  const matching = matches
    .filter((file) => globMatches(normalizedPattern, file))
    .sort((left, right) => left.localeCompare(right));
  if (matching.length === 0) {
    throw new PlaytestCliUsageError(`Scenario glob '${pattern}' matched no files under '${projectPath}'.`);
  }
  return matching;
}

function collectScenarioFiles(directory: string, root: string, files: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") continue;
      collectScenarioFiles(resolve(directory, entry.name), root, files);
      continue;
    }
    if (!entry.isFile()) continue;
    files.push(relative(root, resolve(directory, entry.name)).replaceAll("\\", "/"));
  }
}

function globMatches(pattern: string, file: string): boolean {
  const patternParts = pattern.split("/");
  const fileParts = file.split("/");
  return matchGlobParts(patternParts, fileParts);
}

function matchGlobParts(pattern: readonly string[], file: readonly string[]): boolean {
  if (pattern.length === 0) return file.length === 0;
  const [head, ...tail] = pattern;
  if (head === "**") {
    return matchGlobParts(tail, file) || (file.length > 0 && matchGlobParts(pattern, file.slice(1)));
  }
  return file.length > 0 && segmentMatches(head ?? "", file[0]!) && matchGlobParts(tail, file.slice(1));
}

function segmentMatches(pattern: string, value: string): boolean {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += escapeRegExp(character);
  }
  return new RegExp(`${expression}$`, "u").test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
}

function portFromUrl(url: string): number | undefined {
  try {
    const parsed = new URL(url);
    return parsed.port === "" ? undefined : Number(parsed.port);
  } catch {
    return undefined;
  }
}

function withPort(url: string, port: number): string {
  const parsed = new URL(url);
  parsed.port = String(port);
  const result = parsed.toString();
  return url.endsWith("/") ? result : result.replace(/\/$/u, "");
}

function readPort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new PlaytestCliUsageError(`Expected a TCP port from 0 to 65535, received '${value}'.`);
  }
  return parsed;
}

function parseFlags(argv: readonly string[]): Map<string, string[]> {
  const flags = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name?.startsWith("--") || name === "--help") continue;
    if (!isPlaytestFlag(name)) throw new PlaytestCliUsageError(`Unknown flag '${name}'. Run threenative-playtest --help.`);
    const details: IPlaytestFlagHelp = PLAYTEST_FLAGS[name];
    if (!details.takesValue) continue;
    const next = argv[index + 1];
    if (next === undefined || (next.startsWith("--") && (!details.allowDashValue || isPlaytestFlag(next)))) {
      throw new PlaytestCliUsageError(`Flag '${name}' requires a value.`);
    }
    flags.set(name, [...(flags.get(name) ?? []), next]);
    index += 1;
  }
  return flags;
}

function positional(argv: readonly string[]): string | undefined {
  return argv.find((value, index) => !value.startsWith("-") && (index === 0 || !argv[index - 1]?.startsWith("--")));
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new PlaytestCliUsageError(`Expected a positive integer, received '${value ?? ""}'.`);
  }
  return parsed;
}

function isPlaytestFlag(value: string): value is keyof typeof PLAYTEST_FLAGS {
  return Object.prototype.hasOwnProperty.call(PLAYTEST_FLAGS, value);
}
