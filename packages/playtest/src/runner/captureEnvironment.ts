import { existsSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import type { IPlaytestScenario } from "../index.js";
import type { IStandalonePlaytestConfig } from "./config.js";

/**
 * The display half of the capture environment bake-in (abstraction report §2.10).
 *
 * The Layer-1/2/3 saga — headless black canvas, a Wayland session hanging Chromium at 120 s
 * against 175 ms under X11, GPU starvation, blank captures — used to be solved by a wrapper
 * every caller had to remember (`sh scripts/xvfb.sh`). The runner now owns the decision
 * itself: pick a display strategy from the environment, strip the Wayland variables that
 * send Chromium at the wrong windowing system, and prefer a *private* Xvfb per run when no
 * usable X display exists. `scripts/xvfb.sh` stays as a thin compatibility path over the
 * same logic; it is no longer required for playtest runs.
 *
 * Fail-closed applies here like everywhere else in this package: a run that needs pixels and
 * cannot get a display errors naming the cause. It never falls through to a headless launch
 * whose screenshots are SwiftShader blanks.
 */

export interface IDisplayStrategyHost {
  kind: "host";
}

export interface IDisplayStrategyExisting {
  display: string;
  kind: "existing";
}

export interface IDisplayStrategyPrivateXvfb {
  kind: "private-xvfb";
  screen: string;
}

export type IDisplayStrategy = IDisplayStrategyHost | IDisplayStrategyExisting | IDisplayStrategyPrivateXvfb;

export const DEFAULT_XVFB_SCREEN = "1600x900x24";

/** Wayland variables that make Chromium pick the wrong windowing system; stripped from the browser child. */
export const STRIPPED_WAYLAND_VARS = ["WAYLAND_DISPLAY", "WAYLAND_SOCKET", "XDG_SESSION_TYPE"] as const;

const X11_SOCKET_DIR = "/tmp/.X11-unix";

export interface IDisplayDecisionInput {
  env: NodeJS.ProcessEnv;
  /** Defaults to checking `/tmp/.X11-unix/X<n>` for the numbered display. */
  displaySocketExists?: (display: string) => boolean;
  platform: string;
}

/**
 * Decide where the browser's pixels come from. A Wayland session never satisfies a run by
 * itself — that is the hang measured at 120 s versus 175 ms — so only a live X display does;
 * everything else on Linux provisions a private Xvfb.
 */
export function decideDisplayStrategy(input: IDisplayDecisionInput): IDisplayStrategy {
  if (input.platform !== "linux") return { kind: "host" };
  const display = input.env.DISPLAY;
  if (display !== undefined && display.length > 0 && (input.displaySocketExists ?? x11SocketExists)(display)) {
    return { display, kind: "existing" };
  }
  return { kind: "private-xvfb", screen: input.env.TN_XVFB_SCREEN ?? DEFAULT_XVFB_SCREEN };
}

function x11SocketExists(display: string): boolean {
  const number = displayNumber(display);
  return number === undefined ? false : existsSync(join(X11_SOCKET_DIR, `X${number}`));
}

function displayNumber(display: string): number | undefined {
  const parsed = Number.parseInt(display.replace(/^:/u, ""), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * Build the environment the browser child launches with whenever this runner owns the
 * display decision: `DISPLAY` pinned to the chosen display and every Wayland variable gone,
 * so Chromium cannot answer the session manager instead of the X server it was pointed at.
 */
export function childEnvForDisplay(env: NodeJS.ProcessEnv, display: string): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = { ...env };
  for (const name of STRIPPED_WAYLAND_VARS) delete child[name];
  child.DISPLAY = display;
  return child;
}

/**
 * Does this run produce pixels at all — headed, screenshotting, or evaluating visual or
 * framebuffer assertions? Only those runs need a display and participate in the capture lock.
 */
export function runNeedsPixels(
  config: Pick<IStandalonePlaytestConfig, "headless">,
  scenario: Pick<IPlaytestScenario, "artifacts" | "assert" | "steps">,
): boolean {
  if (config.headless !== true) return true;
  const takesScreenshot = scenario.artifacts?.screenshots !== false
    || scenario.steps.some(({ screenshot }) => screenshot !== undefined);
  const evaluatesVisual = (scenario.assert?.visual?.length ?? 0) > 0;
  return takesScreenshot || evaluatesVisual || scenario.assert?.framebufferCoverage !== undefined;
}

export interface IProvideDisplayOptions {
  commandExists?: (command: string) => boolean;
  displaySocketExists?: (display: string) => boolean;
  env?: NodeJS.ProcessEnv;
  platform?: string;
  spawnProcess?: typeof spawn;
}

export interface IProvidedDisplay {
  /** `undefined` when the host platform provides its own display. */
  display: string | undefined;
  /** Environment to hand the browser child; Wayland variables stripped wherever we decided. */
  env: NodeJS.ProcessEnv;
  release: () => Promise<void>;
  strategy: IDisplayStrategy;
}

/**
 * Provide a display for this run according to `decideDisplayStrategy`, spawning a private
 * Xvfb when Linux offers no usable X display. Throws — never falls back — when a pixel run
 * cannot be given one.
 */
export async function provideDisplay(options: IProvideDisplayOptions = {}): Promise<IProvidedDisplay> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const strategy = decideDisplayStrategy({
    displaySocketExists: options.displaySocketExists,
    env,
    platform,
  });
  if (strategy.kind === "host") {
    return { display: undefined, env: { ...env }, release: async () => undefined, strategy };
  }
  if (strategy.kind === "existing") {
    return {
      display: strategy.display,
      env: childEnvForDisplay(env, strategy.display),
      release: async () => undefined,
      strategy,
    };
  }
  const commandExists = options.commandExists ?? defaultCommandExists;
  if (!commandExists("Xvfb")) {
    throw new Error(
      "No usable X display is available and Xvfb is not installed, so this pixel-producing run "
        + "cannot start (Debian/Ubuntu 'xvfb', Arch 'xorg-server-xvfb', Fedora "
        + "'xorg-x11-server-Xvfb'). Refusing to render blind.",
    );
  }
  const spawnProcess = options.spawnProcess ?? spawn;
  const xvfb = spawnProcess("Xvfb", [
    "-displayfd",
    "3",
    "-nolisten",
    "tcp",
    "-screen",
    "0",
    strategy.screen,
  ], { stdio: ["ignore", "ignore", "pipe", "pipe"] });
  // An Xvfb that dies instantly must surface as our named launch error below, not as an
  // unhandled 'error' event taking the whole runner down.
  xvfb.on?.("error", () => undefined);
  try {
    const number = await readXvfbDisplayNumber(xvfb);
    const display = `:${number}`;
    return {
      display,
      env: childEnvForDisplay(env, display),
      release: () => stopXvfb(xvfb),
      strategy,
    };
  } catch (error) {
    await stopXvfb(xvfb);
    throw error;
  }
}

const XVFB_DISPLAY_TIMEOUT_MS = 10_000;

/**
 * Xvfb with `-displayfd` picks a free display itself and writes the number to file descriptor
 * 3, which avoids the two-concurrent-gates lock-file race the wrapper also dodges this way.
 */
async function readXvfbDisplayNumber(xvfb: ChildProcess): Promise<number> {
  const report = xvfb.stdio[3];
  if (report === null || report === undefined || typeof (report as NodeJS.ReadableStream).on !== "function") {
    throw new Error("Xvfb was spawned without a display-report descriptor to read.");
  }
  const stream = report as NodeJS.ReadableStream;
  return new Promise<number>((resolveDisplay, rejectDisplay) => {
    let settled = false;
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeListener("data", onData);
      stream.removeListener("close", onClose);
      settle();
    };
    const onData = (chunk: Buffer | string): void => {
      const number = Number.parseInt(String(chunk).trim(), 10);
      if (Number.isInteger(number) && number >= 0) finish(() => resolveDisplay(number));
    };
    const onClose = (): void => finish(() => rejectDisplay(new Error("Xvfb exited before it reported a display.")));
    const timer = setTimeout(() => finish(() => {
      rejectDisplay(new Error(`Xvfb did not report a display within ${XVFB_DISPLAY_TIMEOUT_MS}ms.`));
    }), XVFB_DISPLAY_TIMEOUT_MS);
    stream.on("data", onData);
    stream.on("close", onClose);
  });
}

async function stopXvfb(xvfb: ChildProcess): Promise<void> {
  const exitedAlready = (): boolean => (xvfb.exitCode ?? null) !== null || (xvfb.signalCode ?? null) !== null;
  if (exitedAlready()) return;
  xvfb.kill("SIGTERM");
  const started = Date.now();
  while (Date.now() - started < 1_000 && !exitedAlready()) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  if (!exitedAlready()) xvfb.kill("SIGKILL");
}

function defaultCommandExists(command: string): boolean {
  // Kept dependency-free: PATH probe instead of `which`, matching how the CLI resolves binaries elsewhere.
  const paths = (process.env.PATH ?? "").split(":").filter((segment) => segment.length > 0);
  return paths.some((directory) => existsSync(join(directory, command)));
}
