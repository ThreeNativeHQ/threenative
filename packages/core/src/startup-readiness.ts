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

export class StartupReadiness {
  #compileBudgetMs: number;
  #frameBudgetMs: number;
  #stableFrameLimit: number;
  #stableWindowMs: number;
  #compileSettled = false;
  #stableFrameCount = 0;
  #started = false;
  #ready = false;
  #compileTimer: ReturnType<typeof setTimeout> | undefined;
  #windowTimer: ReturnType<typeof setTimeout> | undefined;
  #resolveReady: () => void = () => undefined;
  readonly #readyPromise: Promise<void>;

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
    this.#readyPromise = new Promise<void>((resolve) => {
      this.#resolveReady = resolve;
    });
  }

  whenReady(): Promise<void> {
    return this.#readyPromise;
  }

  /** True once first-use compilation settled or its bounded wait expired. */
  get compileSettled(): boolean {
    return this.#compileSettled;
  }

  /** True after the sustained in-budget frame window has completed. */
  get ready(): boolean {
    return this.#ready;
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
      this.#markReady();
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
      this.#markReady();
    }, this.#stableWindowMs);
  }

  #markReady(): void {
    if (this.#ready) return;
    this.#ready = true;
    if (this.#windowTimer !== undefined) clearTimeout(this.#windowTimer);
    this.#windowTimer = undefined;
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
