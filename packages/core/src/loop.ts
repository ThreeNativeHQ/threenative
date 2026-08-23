export interface IFixedStepLoopOptions {
  readonly step?: number;
  readonly maxSteps?: number;
  /** Collect per-frame render samples for diagnostics consumers. Default false. */
  readonly collectMetrics?: boolean;
  readonly onUpdate: (dt: number) => void;
  readonly onRender?: () => undefined | IRenderPerformanceMetrics;
  readonly requestFrame?: (callback: (time: number) => void) => number;
  readonly cancelFrame?: (handle: number) => void;
}

export interface IRenderPerformanceMetrics {
  readonly drawCalls?: number;
  readonly triangles?: number;
}

export interface IRenderPerformanceSample extends IRenderPerformanceMetrics {
  readonly frameMs: number;
}

const MAX_RENDER_PERFORMANCE_SAMPLES = 1_024;

export class FixedStepLoop {
  readonly step: number;
  readonly maxSteps: number;
  #onUpdate: (dt: number) => void;
  #onRender: () => undefined | IRenderPerformanceMetrics;
  #requestFrame: (callback: (time: number) => void) => number;
  #cancelFrame: (handle: number) => void;
  #accumulator = 0;
  #lastTime: number | undefined;
  #frameHandle: number | undefined;
  #running = false;
  #tick = 0;
  #fps = 0;
  #lastRenderTime: number | undefined;
  #renderPerformanceSamples: IRenderPerformanceSample[] = [];
  #frameCallback: (time: number) => void;
  // Sample collection is opt-in because nothing outside a diagnostics consumer reads the series:
  // collecting unconditionally spent allocations on every rendered frame of every game.
  #collectMetrics: boolean;

  constructor(options: IFixedStepLoopOptions) {
    const step = options.step ?? 1 / 60;
    if (!Number.isFinite(step) || step <= 0) {
      throw new Error(
        `FixedStepLoop step must be a finite number of seconds greater than zero, received ${String(options.step)}.`,
      );
    }
    this.step = step;
    // A maxSteps below one passed the while-loop bound `updates < maxSteps` zero
    // times per frame: the game rendered but never simulated, silently.
    const maxSteps = options.maxSteps ?? 5;
    if (!Number.isInteger(maxSteps) || maxSteps < 1) {
      throw new Error(
        `FixedStepLoop maxSteps must be an integer of at least one, received ${String(options.maxSteps)}.`,
      );
    }
    this.maxSteps = maxSteps;
    this.#collectMetrics = options.collectMetrics ?? false;
    this.#onUpdate = options.onUpdate;
    this.#onRender = options.onRender ?? (() => undefined);
    this.#requestFrame =
      options.requestFrame ??
      ((callback) =>
        typeof globalThis.requestAnimationFrame === "function"
          ? globalThis.requestAnimationFrame(callback)
          : 0);
    this.#cancelFrame =
      options.cancelFrame ??
      ((handle) => {
        if (typeof globalThis.cancelAnimationFrame === "function")
          globalThis.cancelAnimationFrame(handle);
      });
    this.#frameCallback = (time) => this.#frame(time);
  }

  get running(): boolean {
    return this.#running;
  }
  get fps(): number {
    return this.#fps;
  }
  runtimeDiagnosticsSeries(): readonly IRenderPerformanceSample[] {
    return this.#renderPerformanceSamples.map((sample) => ({ ...sample }));
  }
  /** Turns sample collection on for the rest of the run; a diagnostics consumer asking for the series is the only caller. */
  setCollectMetrics(enabled: boolean): void {
    this.#collectMetrics = enabled;
  }
  readonly tick = (): number => this.#tick;
  start(now = globalThis.performance?.now() ?? 0): void {
    if (this.#running) return;
    this.#running = true;
    this.#lastTime = now;
    this.#lastRenderTime = undefined;
    this.#tick = 0;
    this.#fps = 0;
    this.#renderPerformanceSamples = [];
    this.#frameHandle = this.#requestFrame(this.#frameCallback);
  }
  stop(): void {
    this.#running = false;
    if (this.#frameHandle !== undefined) this.#cancelFrame(this.#frameHandle);
    this.#frameHandle = undefined;
    this.#lastTime = undefined;
    this.#accumulator = 0;
  }

  stepFrame(now: number): number {
    const elapsed = Math.max(0, (now - (this.#lastTime ?? now)) / 1000);
    this.#lastTime = Math.max(this.#lastTime ?? now, now);
    this.#accumulator += elapsed;
    let updates = 0;
    while (this.#accumulator + Number.EPSILON >= this.step && updates < this.maxSteps) {
      this.#onUpdate(this.step);
      this.#tick += 1;
      this.#accumulator -= this.step;
      updates += 1;
    }
    if (updates === this.maxSteps && this.#accumulator >= this.step) this.#accumulator = 0;
    let frameMs: number | undefined;
    if (Number.isFinite(now)) {
      if (this.#lastRenderTime !== undefined) {
        frameMs = now - this.#lastRenderTime;
        if (frameMs > 0) this.#fps += (1_000 / frameMs - this.#fps) * 0.1;
      }
      this.#lastRenderTime = now;
    }
    // onRender does the rendering itself; only its metrics return value is optional.
    const metrics = this.#onRender();
    if (this.#collectMetrics && frameMs !== undefined && frameMs > 0) {
      const sample: IRenderPerformanceSample = {
        frameMs,
        ...(metrics === undefined || metrics.drawCalls === undefined
          ? {}
          : { drawCalls: metrics.drawCalls }),
        ...(metrics === undefined || metrics.triangles === undefined
          ? {}
          : { triangles: metrics.triangles }),
      };
      this.#renderPerformanceSamples.push(sample);
      if (this.#renderPerformanceSamples.length > MAX_RENDER_PERFORMANCE_SAMPLES)
        this.#renderPerformanceSamples.shift();
    }
    return updates;
  }

  advance(ticks: number): number {
    if (!this.#running) throw new Error("Cannot advance a stopped loop.");
    if (!Number.isInteger(ticks) || ticks <= 0)
      throw new Error("advance ticks must be a positive integer.");
    this.#lastTime = Number.POSITIVE_INFINITY;
    for (let index = 0; index < ticks; index += 1) {
      this.#onUpdate(this.step);
      this.#tick += 1;
    }
    return ticks;
  }

  #frame(time: number): void {
    if (!this.#running) return;
    try {
      this.stepFrame(time);
    } finally {
      if (this.#running) {
        this.#frameHandle = this.#requestFrame(this.#frameCallback);
      }
    }
  }
}
