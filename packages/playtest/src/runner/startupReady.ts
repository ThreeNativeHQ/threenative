import { playtestDiagnostic, type IPlaytestBridgeReady, type IPlaytestStartupObservation } from "../index.js";
import { PlaytestBridgeError } from "./bridgeClient.js";

/**
 * How long a run will wait for an application to finish its own first-use startup work.
 *
 * Generous on purpose: this covers shader compilation on a cold machine, and a run that waited
 * a few seconds too long costs a few seconds, while one that gave up too early photographs a
 * loading screen and reports it as the game.
 */
export const PLAYTEST_STARTUP_READY_TIMEOUT_MS = 30_000;

export interface IStartupReadySource {
  readonly description: { readonly capabilities: readonly string[] };
  readiness(): Promise<IPlaytestBridgeReady>;
}

export interface IWaitForStartupReadyOptions {
  readonly bridge: IStartupReadySource;
  /**
   * Advances the application. A browser run pumps a frame; a device renders on its own clock and
   * passes a short wait. This is not scenario semantics — no step is being counted here — it is
   * the boundary before the first observation is taken.
   */
  readonly pump: () => Promise<void>;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

/**
 * Holds until the application says its world is safe to observe, or fails with it named.
 *
 * A fixed-step runner advances ticks as fast as the machine allows, so a scenario's whole step
 * list can complete during a launch that has not finished. Everything the game gates on startup
 * — compute dispatch, the first world present — then never happens inside the run, and the
 * result depends only on how long boot took: the same scenario passed on a workstation and
 * failed in CI with identical tick counts, and captures photographed the loading screen.
 *
 * Waiting a bounded amount for a reported signal removes the race. Padding the scenario with
 * more ticks cannot: ticks are not the clock the loader is on.
 *
 * Returns the startup observation it settled on, or `undefined` for an application that does not
 * report startup at all — a plain Three.js page has no such notion and must keep working.
 */
export async function waitForStartupReady(
  options: IWaitForStartupReadyOptions,
): Promise<IPlaytestStartupObservation | undefined> {
  const { bridge, pump } = options;
  if (!bridge.description.capabilities.includes("runtime.startup")) return undefined;
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? PLAYTEST_STARTUP_READY_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error(`TN_PLAYTEST_STARTUP_TIMEOUT_INVALID: ${String(options.timeoutMs)}`);
  const deadline = now() + timeoutMs;
  let observed = await readStartup(bridge);
  while (observed.phase !== "ready") {
    if (now() >= deadline) {
      throw new PlaytestBridgeError(playtestDiagnostic(
        "TN_PLAYTEST_STARTUP_NOT_READY",
        `Application startup stayed '${observed.phase}' for ${timeoutMs}ms; the run would have observed a game that has not finished loading.`,
        "Let the application reach startup readiness — check that its loading gate can complete headlessly — or remove the runtime.startup capability if it has no startup phase.",
      ));
    }
    await pump();
    observed = await readStartup(bridge);
  }
  return observed;
}

/**
 * A bridge that advertises `runtime.startup` and then does not report it is malformed, not
 * "still loading": waiting on it would hang for the whole timeout and then blame the game.
 */
async function readStartup(bridge: IStartupReadySource): Promise<IPlaytestStartupObservation> {
  const ready = await bridge.readiness();
  const startup = ready.startup;
  if (startup === undefined || typeof startup.phase !== "string") {
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_STARTUP_NOT_READY",
      "Bridge advertises 'runtime.startup' but ready() returned no startup observation.",
      "Report { phase, progress } from the bridge's ready() handler, or stop advertising runtime.startup.",
      { capability: "runtime.startup" },
    ));
  }
  return startup;
}
