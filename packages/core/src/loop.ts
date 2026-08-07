export interface FixedStepLoopOptions {
  readonly step?: number;
  readonly maxSteps?: number;
  readonly onUpdate: (dt: number) => void;
  readonly onRender?: () => void;
  readonly requestFrame?: (callback: (time: number) => void) => number;
  readonly cancelFrame?: (handle: number) => void;
}

export class FixedStepLoop {
  readonly step: number;
  readonly maxSteps: number;
  #onUpdate: (dt: number) => void;
  #onRender: () => void;
  #requestFrame: (callback: (time: number) => void) => number;
  #cancelFrame: (handle: number) => void;
  #accumulator = 0;
  #lastTime: number | undefined;
  #frameHandle: number | undefined;
  #running = false;
  #fps = 0;
  #lastRenderTime: number | undefined;

  constructor(options: FixedStepLoopOptions) {
    this.step = options.step ?? 1 / 60;
    this.maxSteps = options.maxSteps ?? 5;
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
  }

  get running(): boolean {
    return this.#running;
  }

  get fps(): number {
    return this.#fps;
  }

  start(now = globalThis.performance?.now() ?? 0): void {
    if (this.#running) return;
    this.#running = true;
    this.#lastTime = now;
    this.#lastRenderTime = undefined;
    this.#fps = 0;
    this.#frameHandle = this.#requestFrame((time) => this.#frame(time));
  }

  stop(): void {
    this.#running = false;
    if (this.#frameHandle !== undefined) this.#cancelFrame(this.#frameHandle);
    this.#frameHandle = undefined;
    this.#lastTime = undefined;
    this.#accumulator = 0;
  }

  stepFrame(now: number): number {
    const last = this.#lastTime ?? now;
    const elapsed = Math.max(0, (now - last) / 1000);
    this.#lastTime = now;
    this.#accumulator += elapsed;
    let updates = 0;
    while (this.#accumulator + Number.EPSILON >= this.step && updates < this.maxSteps) {
      this.#onUpdate(this.step);
      this.#accumulator -= this.step;
      updates += 1;
    }
    if (updates === this.maxSteps && this.#accumulator >= this.step) this.#accumulator = 0;
    if (Number.isFinite(now)) {
      if (this.#lastRenderTime !== undefined) {
        const frameMs = now - this.#lastRenderTime;
        if (frameMs > 0) this.#fps += (1_000 / frameMs - this.#fps) * 0.1;
      }
      this.#lastRenderTime = now;
    }
    this.#onRender();
    return updates;
  }

  advance(ticks: number): number {
    if (!this.#running) throw new Error("Cannot advance a stopped loop.");
    if (!Number.isInteger(ticks) || ticks <= 0)
      throw new Error("advance ticks must be a positive integer.");
    for (let index = 0; index < ticks; index += 1) {
      this.#lastTime = (this.#lastTime ?? 0) + this.step * 1_000;
      this.#onUpdate(this.step);
    }
    return ticks;
  }

  #frame(time: number): void {
    if (!this.#running) return;
    try {
      this.stepFrame(time);
    } finally {
      if (this.#running) {
        this.#frameHandle = this.#requestFrame((nextTime) => this.#frame(nextTime));
      }
    }
  }
}
