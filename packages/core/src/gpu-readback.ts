import type { IRendererLike } from "./renderer.js";

export interface IGPUReadbackOptions {
  /** The GPU storage attribute to copy — a TSL storage node's `.value`. */
  readonly attribute: unknown;
  /**
   * Frames between readback requests. `1` asks every frame; larger values throttle.
   *
   * A copy off the GPU costs a queue submission and a mapped buffer, so a game reading a field it
   * only consults for physics asks for it every few frames and pays the staleness instead.
   */
  readonly everyFrames: number;
}

/** A landed copy of GPU memory, with the age of the frame that produced it. */
export interface IGPUReadbackSample {
  readonly data: Float32Array;
  /**
   * Frames between the frame whose GPU state these bytes hold and the frame reading them.
   *
   * This is the number a caller must not be allowed to ignore. A buoyancy solver that treats a
   * 4-frame-old surface as this frame's surface floats a hull through the water it is drawn on,
   * and nothing in the frame says so.
   */
  readonly staleFrames: number;
}

/**
 * A throttled, fire-and-forget copy of a GPU buffer into CPU memory.
 *
 * Every sample it hands back carries its own age. That is the whole point: the copy is
 * asynchronous, so the bytes are always some frames behind the GPU, and a class that hid that
 * would let a caller mistake stale data for live data with no way to find out.
 *
 * `request()` never awaits and never blocks the frame. One copy is in flight at a time; requests
 * made while one is pending are dropped rather than queued, because a backlog of copies of a field
 * that has already moved on is latency with no information in it.
 */
export class GPUReadback {
  readonly everyFrames: number;
  #attribute: unknown;
  /** Frames observed through `request()`. The clock every other number here is measured against. */
  #frame = 0;
  /** The frame whose GPU state the landed bytes hold, or `-1` when nothing has landed. */
  #sampleFrame = -1;
  /** The frame the in-flight request was issued on, or `-1` when none is in flight. */
  #requestedFrame = -1;
  #pending = false;
  #data: Float32Array | undefined;
  #requests = 0;
  #lands = 0;
  #failures = 0;
  #released = false;

  constructor(options: IGPUReadbackOptions) {
    if (options.attribute === undefined || options.attribute === null)
      throw new Error("GPUReadback.attribute is required.");
    if (!Number.isInteger(options.everyFrames) || options.everyFrames <= 0)
      throw new Error("GPUReadback.everyFrames must be a positive integer.");
    this.#attribute = options.attribute;
    this.everyFrames = options.everyFrames;
  }

  get released(): boolean {
    return this.#released;
  }

  /** True while a copy is in flight. A game that wants to pace its own work can read it. */
  get pending(): boolean {
    return this.#pending;
  }

  /** The newest landed bytes, or `undefined` before the first copy lands. */
  get data(): Float32Array | undefined {
    return this.#data;
  }

  /**
   * How many frames old the landed bytes are.
   *
   * Before anything has landed this is the number of frames since construction, which grows
   * without bound on purpose: "no data yet" and "data from frame zero" must not read the same.
   */
  get staleFrames(): number {
    if (this.#sampleFrame < 0) return this.#frame;
    return this.#frame - this.#sampleFrame;
  }

  /** The newest bytes with their age attached, or `undefined` before the first copy lands. */
  get sample(): IGPUReadbackSample | undefined {
    if (this.#data === undefined) return undefined;
    return { data: this.#data, staleFrames: this.staleFrames };
  }

  /** Requests, landings and failures, for a report that has to say why a sample is old. */
  get stats(): { readonly requests: number; readonly lands: number; readonly failures: number } {
    return { requests: this.#requests, lands: this.#lands, failures: this.#failures };
  }

  /**
   * Advances the frame clock and starts a copy when the throttle allows one.
   *
   * Safe to call every frame. It returns before the GPU has answered — awaiting it is the one
   * thing that would turn this class into the stall it exists to avoid.
   */
  request(renderer: IRendererLike): void {
    if (this.#released) throw new Error("GPUReadback cannot request after release.");
    this.#frame += 1;
    if (this.#pending) return;
    if (this.#requestedFrame >= 0 && this.#frame - this.#requestedFrame < this.everyFrames) return;
    const issuedFrame = this.#frame;
    this.#requestedFrame = issuedFrame;
    this.#pending = true;
    this.#requests += 1;
    renderer
      .readback(this.#attribute)
      .then((bytes) => this.#land(bytes, issuedFrame))
      .catch(() => this.#fail());
  }

  #land(bytes: ArrayBuffer, issuedFrame: number): void {
    this.#pending = false;
    if (this.#released) return;
    this.#data = new Float32Array(bytes);
    this.#sampleFrame = issuedFrame;
    this.#lands += 1;
  }

  #fail(): void {
    this.#pending = false;
    if (this.#released) return;
    this.#failures += 1;
  }

  /** Drops the attribute reference and the landed bytes. Further requests throw. */
  dispose(): void {
    if (this.#released) return;
    this.#released = true;
    this.#pending = false;
    this.#attribute = undefined;
    this.#data = undefined;
  }
}
