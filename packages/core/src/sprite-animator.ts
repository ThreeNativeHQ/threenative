import type { Texture } from "three";

export type SpritePlaybackMode = "loop" | "pingPong" | "once";

export interface ISpriteFrame3D {
  /** Pixels from the left edge of the atlas. */
  readonly x: number;
  /** Pixels from the top edge when `origin` is `"top-left"`. */
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Seconds this frame is held; every frame must provide its own authored timing. */
  readonly duration: number;
}

export interface ISpriteAnimator3DOptions {
  /** The game-owned atlas texture. Its filters, wrapping and surface remain untouched. */
  readonly texture: Texture;
  /** Pixel-space atlas rectangles with per-frame durations. */
  readonly frames: readonly ISpriteFrame3D[];
  readonly mode?: SpritePlaybackMode;
  /** Atlas coordinate origin; top-left is conventional for exported sprite sheets. */
  readonly origin?: "top-left" | "bottom-left";
  /** Start advancing immediately unless the game explicitly opts out. */
  readonly autoPlay?: boolean;
}

/**
 * Advance a game-owned atlas texture on the fixed step supplied by its owner.
 *
 * This helper changes only `texture.offset` and `texture.repeat`. The game still chooses the
 * texture, filters, wrapping, surface, geometry and every frame's duration. Call {@link update}
 * from the scene's fixed-step update; no wall clock or global animation loop is consulted.
 */
export class SpriteAnimator3D {
  readonly texture: Texture;
  readonly frames: readonly ISpriteFrame3D[];
  readonly mode: SpritePlaybackMode;
  readonly origin: "top-left" | "bottom-left";
  #elapsed = 0;
  #finished = false;
  #frameIndex = 0;
  #playing: boolean;
  #direction = 1;
  readonly #atlasHeight: number;
  readonly #atlasWidth: number;

  constructor(options: ISpriteAnimator3DOptions) {
    if (options === undefined || options === null || options.texture === undefined)
      throw new Error("SpriteAnimator3D.texture is required.");
    const image = options.texture.image as { height?: unknown; width?: unknown } | null | undefined;
    if (
      image === undefined ||
      image === null ||
      typeof image.width !== "number" ||
      typeof image.height !== "number" ||
      !Number.isFinite(image.width) ||
      !Number.isFinite(image.height) ||
      image.width <= 0 ||
      image.height <= 0
    )
      throw new Error("SpriteAnimator3D.texture must have a positive atlas width and height.");
    if (options.frames === undefined || options.frames === null || options.frames.length === 0)
      throw new Error("SpriteAnimator3D.frames must contain at least one frame.");
    const mode = options.mode ?? "loop";
    if (mode !== "loop" && mode !== "pingPong" && mode !== "once")
      throw new Error("SpriteAnimator3D.mode must be 'loop', 'pingPong', or 'once'.");
    const origin = options.origin ?? "top-left";
    if (origin !== "top-left" && origin !== "bottom-left")
      throw new Error("SpriteAnimator3D.origin must be 'top-left' or 'bottom-left'.");

    this.#atlasWidth = image.width;
    this.#atlasHeight = image.height;
    this.texture = options.texture;
    this.frames = options.frames.map((frame, index) => {
      if (
        frame === undefined ||
        !Number.isFinite(frame.x) ||
        !Number.isFinite(frame.y) ||
        !Number.isFinite(frame.width) ||
        !Number.isFinite(frame.height) ||
        frame.x < 0 ||
        frame.y < 0 ||
        frame.width <= 0 ||
        frame.height <= 0 ||
        frame.x + frame.width > this.#atlasWidth ||
        frame.y + frame.height > this.#atlasHeight
      )
        throw new Error(`SpriteAnimator3D frame ${index} is outside the texture atlas.`);
      if (!Number.isFinite(frame.duration) || frame.duration <= 0)
        throw new Error(`SpriteAnimator3D frame duration ${index} must be positive and finite.`);
      return { ...frame };
    });
    this.mode = mode;
    this.origin = origin;
    this.#playing = options.autoPlay ?? true;
    this.#applyFrame();
  }

  get frameIndex(): number {
    return this.#frameIndex;
  }

  get elapsed(): number {
    return this.#elapsed;
  }

  get finished(): boolean {
    return this.#finished;
  }

  get playing(): boolean {
    return this.#playing;
  }

  /** Advance by one caller-supplied fixed-step delta. */
  update(dt: number): this {
    if (!Number.isFinite(dt) || dt < 0)
      throw new Error("SpriteAnimator3D.update delta must be finite and non-negative.");
    if (!this.#playing || this.#finished || dt === 0) return this;
    if (this.frames.length === 1 && this.mode !== "once") {
      const frame = this.frames[0];
      if (frame === undefined) throw new Error("SpriteAnimator3D current frame is missing.");
      this.#elapsed = (this.#elapsed + dt) % frame.duration;
      return this;
    }

    let remaining = dt;
    while (remaining > 0 && this.#playing && !this.#finished) {
      const frame = this.frames[this.#frameIndex];
      if (frame === undefined) throw new Error("SpriteAnimator3D current frame is missing.");
      const untilNext = frame.duration - this.#elapsed;
      if (remaining + Number.EPSILON < untilNext) {
        this.#elapsed += remaining;
        break;
      }
      remaining = Math.max(0, remaining - untilNext);
      this.#elapsed = 0;
      this.#advanceFrame();
    }
    return this;
  }

  /** Pause fixed-step advancement while leaving the selected frame visible. */
  pause(): this {
    this.#playing = false;
    return this;
  }

  /** Resume, restarting a completed one-shot from frame zero. */
  play(): this {
    if (this.#finished) {
      this.#frameIndex = 0;
      this.#direction = 1;
      this.#elapsed = 0;
      this.#finished = false;
      this.#applyFrame();
    }
    this.#playing = true;
    return this;
  }

  /** Stop and reset to the first authored frame. */
  stop(): this {
    this.#playing = false;
    this.#finished = false;
    this.#frameIndex = 0;
    this.#direction = 1;
    this.#elapsed = 0;
    this.#applyFrame();
    return this;
  }

  /** Select a frame without advancing time. */
  setFrame(index: number): this {
    if (!Number.isInteger(index) || index < 0 || index >= this.frames.length)
      throw new Error("SpriteAnimator3D frame index must be an in-range integer.");
    this.#frameIndex = index;
    this.#direction = index === this.frames.length - 1 ? -1 : 1;
    this.#elapsed = 0;
    this.#finished = false;
    this.#applyFrame();
    return this;
  }

  #advanceFrame(): void {
    if (this.mode === "once") {
      if (this.#frameIndex === this.frames.length - 1) {
        this.#finished = true;
        this.#playing = false;
        this.#applyFrame();
        return;
      }
      this.#frameIndex += 1;
    } else if (this.mode === "loop") {
      this.#frameIndex = (this.#frameIndex + 1) % this.frames.length;
    } else if (this.frames.length > 1) {
      if (this.#direction > 0) {
        if (this.#frameIndex === this.frames.length - 1) {
          this.#direction = -1;
          this.#frameIndex -= 1;
        } else this.#frameIndex += 1;
      } else if (this.#frameIndex === 0) {
        this.#direction = 1;
        this.#frameIndex += 1;
      } else this.#frameIndex -= 1;
    }
    this.#applyFrame();
  }

  #applyFrame(): void {
    const frame = this.frames[this.#frameIndex];
    if (frame === undefined) throw new Error("SpriteAnimator3D current frame is missing.");
    this.texture.repeat.set(frame.width / this.#atlasWidth, frame.height / this.#atlasHeight);
    const y =
      this.origin === "top-left"
        ? (this.#atlasHeight - frame.y - frame.height) / this.#atlasHeight
        : frame.y / this.#atlasHeight;
    this.texture.offset.set(frame.x / this.#atlasWidth, y);
    this.texture.updateMatrix();
  }
}
