export type StartupCompile = () => Promise<void> | void;

export interface IStartupReadinessOptions {
  /** Maximum wall-clock time spent waiting for first-use compilation. */
  readonly compileBudgetMs?: number;
  /** Maximum measured callback duration for a stable startup frame. */
  readonly frameBudgetMs?: number;
  /** Number of consecutive in-budget frames required after compilation settles. */
  readonly stableFrames?: number;
  /**
   * How long after first-use work settles the readiness still waits for sustained in-budget
   * frames before resolving anyway. Default 10 000 ms.
   *
   * A host whose steady state runs entirely above `frameBudgetMs` would otherwise hold a loading
   * screen open for as long as the game ran — the frame window must be bounded like every other
   * launch-path wait, because a launch that is slower than it could be is a disappointment and a
   * launch that never finishes is a bug.
   */
  readonly stableWindowMs?: number;
  /** Default ceiling on a single `hold()`, when the caller does not give one. */
  readonly holdBudgetMs?: number;
}

/**
 * The startup contract shared by the loading screen and the native/web render loop.
 *
 * The 50 ms frame budget is above the observed steady-state windows (20.9 ms and 33.5 ms) while
 * rejecting the 76 ms startup window that preceded the reported stall. Five consecutive frames
 * keep a loading screen up through recurring first-use work instead of treating one quiet frame as
 * readiness. Compilation is bounded because the native host has shipped renderers whose
 * `compileAsync()` promise never settles.
 */
export const STARTUP_COMPILE_BUDGET_MS = 15_000;
export const STARTUP_FRAME_BUDGET_MS = 50;
export const STARTUP_STABLE_FRAMES = 5;
/**
 * How long the sustained-frame window may wait past compile settlement before resolving anyway.
 * Above every observed healthy startup (five sub-50 ms frames inside one second) but short enough
 * that a device running above budget forever still reaches its game in seconds, not never.
 */
export const STARTUP_STABLE_WINDOW_MS = 10_000;
/**
 * Default ceiling on one game-registered `hold()`.
 *
 * Longer than the other launch budgets because what it bounds is a game's own asset tier over a
 * network rather than local compilation — 70 model files on a cold cache is seconds, and cutting a
 * cold first launch off at ten would ship a thinner world to exactly the players who waited. Still
 * bounded, for the same reason everything else here is: a hold that never settles must cost a
 * poorer-looking game and never a game that does not start.
 */
export const STARTUP_HOLD_BUDGET_MS = 45_000;

/** One registered hold: the game's own launch work, and the bounded wait for it. */
interface IHold {
  readonly label: string;
  settled: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  expired: boolean;
}

export class StartupReadiness {
  #compileBudgetMs: number;
  #frameBudgetMs: number;
  #stableFrameLimit: number;
  #stableWindowMs: number;
  #compileSettled = false;
  #stableFrameCount = 0;
  #started = false;
  #ready = false;
  #frameWindowDone = false;
  readonly #holds = new Map<string, IHold>();
  #holdBudgetMs: number;
  #compileTimer: ReturnType<typeof setTimeout> | undefined;
  #windowTimer: ReturnType<typeof setTimeout> | undefined;
  #resolveReady: () => void = () => undefined;
  #resolveFrameworkReady: () => void = () => undefined;
  readonly #readyPromise: Promise<void>;
  readonly #frameworkReadyPromise: Promise<void>;

  constructor(options: IStartupReadinessOptions = {}) {
    this.#compileBudgetMs = positiveNumber(
      options.compileBudgetMs ?? STARTUP_COMPILE_BUDGET_MS,
      "compileBudgetMs",
    );
    this.#frameBudgetMs = positiveNumber(
      options.frameBudgetMs ?? STARTUP_FRAME_BUDGET_MS,
      "frameBudgetMs",
    );
    this.#stableFrameLimit = positiveInteger(
      options.stableFrames ?? STARTUP_STABLE_FRAMES,
      "stableFrames",
    );
    this.#stableWindowMs = positiveNumber(
      options.stableWindowMs ?? STARTUP_STABLE_WINDOW_MS,
      "stableWindowMs",
    );
    this.#holdBudgetMs = positiveNumber(
      options.holdBudgetMs ?? STARTUP_HOLD_BUDGET_MS,
      "holdBudgetMs",
    );
    this.#readyPromise = new Promise<void>((resolve) => {
      this.#resolveReady = resolve;
    });
    this.#frameworkReadyPromise = new Promise<void>((resolve) => {
      this.#resolveFrameworkReady = resolve;
    });
  }

  whenReady(): Promise<void> {
    return this.#readyPromise;
  }

  /**
   * Resolves when the framework's own launch work is done, before any game `hold()`.
   *
   * The host needs this separately from `whenReady()`: it is the moment the framework's cost can
   * be stamped, and it is also when the loop may start presenting the game's own progress.
   */
  whenFrameworkReady(): Promise<void> {
    return this.#frameworkReadyPromise;
  }

  /** True once first-use compilation settled or its bounded wait expired. */
  get compileSettled(): boolean {
    return this.#compileSettled;
  }

  /** True after the sustained in-budget frame window has completed. */
  get ready(): boolean {
    return this.#ready;
  }

  /**
   * True once the framework's own launch work is done: compilation settled and the frame window
   * held. Earlier than `ready` whenever the game has registered a hold.
   *
   * Kept separate and kept observable because making `ready` mean "the player can see the world"
   * would otherwise delete the only measurement of how long the *framework* took, and a game with
   * a slow asset tier would hide a framework regression inside its own loading time.
   */
  get frameworkReady(): boolean {
    return this.#frameWindowDone;
  }

  /** Labels of holds that have not settled yet, in registration order. */
  get pendingHolds(): readonly string[] {
    return [...this.#holds.values()].filter((hold) => !hold.settled).map((hold) => hold.label);
  }

  /** Every hold's label paired with whether it settled inside its budget. */
  get holdReport(): readonly { readonly expired: boolean; readonly label: string }[] {
    return [...this.#holds.values()].map((hold) => ({ expired: hold.expired, label: hold.label }));
  }

  /**
   * Add the game's own launch work to the readiness gate.
   *
   * The framework's readiness covers the framework's work — first-use compilation and a sustained
   * frame window — and knows nothing about a second asset tier the game streams after it. Without
   * this, a game that streams one has two bad options: show a half-built world, or hold its own
   * curtain past `whenReady()` and leave every framework-owned observation describing a moment the
   * player never experienced. `timeline.readyMs` reported 1.5 s on a valley that took 8.8 s to
   * appear, and `assert.startup`'s `maxReadyMs` passed on it, because both measure this gate.
   *
   * So the gate takes the game's work too, and then the numbers are about the player again.
   *
   * Fails open, deliberately, twice over: a hold that rejects is treated as settled, and
   * `budgetMs` bounds how long it may delay the world. A launch that is slower than it could be is
   * a disappointment; a launch that never finishes because one texture 404'd is a bug. `expired`
   * on the report says which happened, so a hold that timed out is visible rather than silent.
   *
   * Throws on a duplicate label, and on a hold registered after the gate has already resolved —
   * both mean the caller believes it is gating something it is not, which is the failure this
   * whole seam exists to remove.
   */
  hold(label: string, work: Promise<unknown>, budgetMs: number = this.#holdBudgetMs): void {
    if (typeof label !== "string" || label.trim() === "")
      throw new Error("TN_STARTUP_HOLD_LABEL_INVALID: a hold needs a non-empty label.");
    if (this.#holds.has(label))
      throw new Error(`TN_STARTUP_HOLD_DUPLICATE: '${label}' is already holding startup.`);
    if (this.#ready)
      throw new Error(
        `TN_STARTUP_HOLD_TOO_LATE: '${label}' was registered after startup already resolved.`,
      );
    const bounded = positiveNumber(budgetMs, "holdBudgetMs");
    const hold: IHold = { expired: false, label, settled: false, timer: undefined };
    this.#holds.set(label, hold);
    const release = (expired: boolean): void => {
      if (hold.settled) return;
      hold.settled = true;
      hold.expired = expired;
      if (hold.timer !== undefined) clearTimeout(hold.timer);
      hold.timer = undefined;
      this.#resolveIfComplete();
    };
    hold.timer = setTimeout(() => release(true), bounded);
    void Promise.resolve(work).then(
      () => release(false),
      () => release(false),
    );
  }

  /** Begin the one-time first-use gate after the entered scene has been built. */
  start(compile?: StartupCompile): void {
    if (this.#started) return;
    this.#started = true;
    if (compile === undefined) {
      this.#finishCompile();
      return;
    }

    this.#compileTimer = setTimeout(() => this.#finishCompile(), this.#compileBudgetMs);
    // Defer the call one microtask so the already-visible loading layer gets a present before a
    // renderer that performs synchronous first-use work starts compiling.
    void Promise.resolve()
      .then(() => compile())
      .then(
        () => this.#finishCompile(),
        () => this.#finishCompile(),
      );
  }

  /** Feed actual callback wall time, not requestAnimationFrame timestamp spacing. */
  observe(frameMs: number): void {
    if (!this.#started || this.#ready) return;
    if (
      this.#compileSettled &&
      Number.isFinite(frameMs) &&
      frameMs >= 0 &&
      frameMs <= this.#frameBudgetMs
    ) {
      this.#stableFrameCount += 1;
    } else {
      this.#stableFrameCount = 0;
    }
    if (this.#stableFrameCount >= this.#stableFrameLimit) {
      this.#finishFrameWindow();
    }
  }

  #finishCompile(): void {
    if (this.#compileSettled) return;
    this.#compileSettled = true;
    if (this.#compileTimer !== undefined) clearTimeout(this.#compileTimer);
    this.#compileTimer = undefined;
    // The frame window is the last launch-path wait left, so it is bounded too: a host that never
    // produces an in-budget frame still gets its world within `stableWindowMs`.
    this.#windowTimer = setTimeout(() => {
      this.#windowTimer = undefined;
      this.#finishFrameWindow();
    }, this.#stableWindowMs);
  }

  /** The framework's own work is done. Whether the *world* is ready also depends on the holds. */
  #finishFrameWindow(): void {
    if (this.#frameWindowDone) return;
    this.#frameWindowDone = true;
    if (this.#windowTimer !== undefined) clearTimeout(this.#windowTimer);
    this.#windowTimer = undefined;
    this.#resolveFrameworkReady();
    this.#resolveIfComplete();
  }

  #resolveIfComplete(): void {
    if (this.#ready || !this.#frameWindowDone) return;
    for (const hold of this.#holds.values()) if (!hold.settled) return;
    this.#ready = true;
    this.#resolveReady();
  }
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`TN_STARTUP_${name.toUpperCase()}_INVALID: ${name} must be positive.`);
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1)
    throw new Error(
      `TN_STARTUP_${name.toUpperCase()}_INVALID: ${name} must be a positive integer.`,
    );
  return value;
}
