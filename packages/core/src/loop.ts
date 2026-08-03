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

  start(now = globalThis.performance?.now() ?? 0): void {
    if (this.#running) return;
    this.#running = true;
    this.#lastTime = now;
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
    this.#onRender();
    return updates;
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
