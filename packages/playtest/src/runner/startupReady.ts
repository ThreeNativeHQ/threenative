import { PLAYTEST_STARTUP_READY_TIMEOUT_MS, playtestDiagnostic, type IPlaytestBridgeReady, type IPlaytestStartupObservation } from "../index.js";
import { PlaytestBridgeError } from "./bridgeClient.js";


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
  let observed = await pollStartup(bridge);
  while (observed === BUSY || observed.phase !== "ready") {
    if (now() >= deadline) {
      throw new PlaytestBridgeError(playtestDiagnostic(
        "TN_PLAYTEST_STARTUP_NOT_READY",
        `Application startup stayed '${observed === BUSY ? "unreadable, the bridge kept timing out" : observed.phase}' for ${timeoutMs}ms; the run would have observed a game that has not finished loading.`,
        "Let the application reach startup readiness — check that its loading gate can complete headlessly — or remove the runtime.startup capability if it has no startup phase.",
      ));
    }
    await pump();
    observed = await pollStartup(bridge);
  }
  return observed;
}

/** The bridge was too busy to answer this time round. Distinct from any real phase. */
const BUSY = Symbol("startup-busy");

/**
 * One reading, where "the page did not answer in time" means *still starting*.
 *
 * `ready` carries the protocol's operation timeout like every other call, and this is the one
 * caller that makes it during first-use work — precisely when the page's main thread is most
 * likely to be blocked long enough to trip it. Failing the run there would blame the game for
 * being slow to compile, which is the opposite of what this wait is for. The overall deadline
 * still bounds it, so a page that never comes back is still named; only the reason changes.
 */
async function pollStartup(
  bridge: IStartupReadySource,
): Promise<IPlaytestStartupObservation | typeof BUSY> {
  try {
    return await readStartup(bridge);
  } catch (error) {
    if (
      error instanceof PlaytestBridgeError &&
      error.diagnostic.code === "TN_PLAYTEST_OPERATION_TIMEOUT"
    ) {
      return BUSY;
    }
    throw error;
  }
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
