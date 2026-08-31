import { PLAYTEST_STARTUP_READY_TIMEOUT_MS, playtestDiagnostic, type IPlaytestBridgeReady, type IPlaytestStartupObservation } from "../index.js";
import { PlaytestBridgeError } from "./bridgeClient.js";


export interface IStartupReadySource {
  readonly description: { readonly capabilities: readonly string[] };
  readiness(): Promise<IPlaytestBridgeReady>;
}

/** Which rule the wait resolved on, so a report never reads as more than it measured. */
export type PlaytestStartupRule = "sustained-frames" | "compile-settled";

export interface IStartupReadyOutcome {
  readonly startup: IPlaytestStartupObservation;
  readonly rule: PlaytestStartupRule;
}

export interface IWaitForStartupReadyOptions {
  readonly bridge: IStartupReadySource;
  /**
   * Accept compile settlement instead of full readiness.
   *
   * Set only from `--allow-software` / `TN_PLAYTEST_ALLOW_SOFTWARE`, never from a timeout, an
   * adapter guess or any other fallback. Readiness requires a sustained in-budget frame window,
   * which asks "is this running smoothly enough to show a player" — a lane that has been told
   * out loud that the machine has no GPU has already conceded it is not measuring that, and on
   * a CPU rasteriser the window can only ever expire rather than be met. Compile settlement is
   * still required either way: that is the part that makes the run observe the game instead of
   * the loading screen, and it is not weakened here.
   */
  readonly acceptCompileSettled?: boolean;
  /**
   * Advances the application. A browser run pumps a frame; a device renders on its own clock and
   * passes a short wait. This is not scenario semantics — no step is being counted here — it is
   * the boundary before the first observation is taken.
   */
  readonly pump: () => Promise<void>;
  /**
   * True once the run is being torn down, so the wait stops instead of outliving it.
   *
   * The runner installs SIGINT/SIGTERM handlers that close the browser and remove its profile.
   * Without this, a signal arriving mid-wait left the poll running to its own deadline — up to
   * three minutes — and the teardown behind it did not happen until then. The orphan gate,
   * which kills a run on purpose and then asserts the profile is gone, is exactly the thing
   * that catches it: `before 1, after 3`, with no process holding the directories.
   */
  readonly aborted?: () => boolean;
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
): Promise<IStartupReadyOutcome | undefined> {
  const { bridge, pump } = options;
  if (!bridge.description.capabilities.includes("runtime.startup")) return undefined;
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? PLAYTEST_STARTUP_READY_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error(`TN_PLAYTEST_STARTUP_TIMEOUT_INVALID: ${String(options.timeoutMs)}`);
  const deadline = now() + timeoutMs;
  // A game that does not report compile settlement cannot be relaxed against: the relaxation
  // needs the earlier signal to exist, and inferring it from a phase that cannot distinguish the
  // two would be the implicit fallback this must never have.
  const settled = (observation: IPlaytestStartupObservation): boolean =>
    options.acceptCompileSettled === true && observation.compileSettled === true;
  const aborted = options.aborted ?? (() => false);
  if (aborted()) throw abortedDuringStartup();
  let observed = await pollStartup(bridge);
  while (observed === BUSY || (observed.phase !== "ready" && !settled(observed))) {
    if (aborted()) throw abortedDuringStartup();
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
  return {
    rule: observed.phase === "ready" ? "sustained-frames" : "compile-settled",
    startup: observed,
  };
}

/**
 * The run is going away. Unwind now so the caller's teardown runs, rather than holding the
 * process open for the rest of the deadline while a browser profile sits on disk.
 */
function abortedDuringStartup(): PlaytestBridgeError {
  return new PlaytestBridgeError(playtestDiagnostic(
    "TN_PLAYTEST_STARTUP_ABORTED",
    "The run was torn down while waiting for application startup.",
    "Nothing to fix in the scenario: this is the shutdown path, and the wait yields to it so the browser and its profile are released immediately.",
  ));
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
    // Say what came back. "no startup observation" covers a bridge that omitted the field, one
    // that sent a non-object, and a transport that dropped it in flight — three different faults
    // with three different owners. On the device mailbox this is the only description of the
    // payload anyone gets, because the app's console does not reach the runner.
    const shape =
      ready === null || typeof ready !== "object"
        ? `ready() returned ${ready === null ? "null" : typeof ready}`
        : `ready() returned keys [${Object.keys(ready).sort().join(", ")}] with startup=${
            startup === undefined ? "absent" : JSON.stringify(startup)
          }`;
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_STARTUP_NOT_READY",
      `Bridge advertises 'runtime.startup' but ready() returned no startup observation; ${shape}.`,
      "Report { phase, progress } from the bridge's ready() handler, or stop advertising runtime.startup.",
      { capability: "runtime.startup" },
    ));
  }
  return startup;
}
