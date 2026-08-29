import { Vector3 } from "three";

export type CameraShakeCurve = (phase: number) => number;

export interface ICameraShakeOptions {
  /** Position amplitude in world metres, supplied by the game. */
  readonly amplitude: Vector3;
  /** Rotation amplitude in radians around x/y/z, supplied by the game. */
  readonly rotationAmplitude: Vector3;
  /** Curve cycles per second, supplied by the game. */
  readonly frequency: number;
  /** Exponential envelope decay per second, supplied by the game. */
  readonly decay: number;
  /** Game-authored waveform sampled at `elapsed * frequency * 2π`. */
  readonly curve: CameraShakeCurve;
}

export interface ICameraShakeOffset {
  readonly position: Vector3;
  readonly rotation: Vector3;
}

/**
 * Produce a transient camera offset without owning or mutating a camera.
 *
 * The caller supplies the amplitudes, frequency, decay and waveform. {@link update} evaluates the
 * waveform against the caller's fixed-step delta and returns a reusable position/rotation offset;
 * a template can compose it after its own camera rig and damping.
 */
export class CameraShake {
  readonly amplitude: Vector3;
  readonly rotationAmplitude: Vector3;
  readonly frequency: number;
  readonly decay: number;
  readonly curve: CameraShakeCurve;
  readonly offset: ICameraShakeOffset = {
    position: new Vector3(),
    rotation: new Vector3(),
  };
  #active = false;
  #elapsed = 0;

  constructor(options: ICameraShakeOptions) {
    if (options === undefined || options === null || options.amplitude === undefined)
      throw new Error("CameraShake.amplitude is required.");
    if (options.rotationAmplitude === undefined)
      throw new Error("CameraShake.rotationAmplitude is required.");
    validateVector(options.amplitude, "CameraShake.amplitude");
    validateVector(options.rotationAmplitude, "CameraShake.rotationAmplitude");
    if (!Number.isFinite(options.frequency) || options.frequency <= 0)
      throw new Error("CameraShake.frequency must be positive and finite.");
    if (!Number.isFinite(options.decay) || options.decay <= 0)
      throw new Error("CameraShake.decay must be positive and finite.");
    if (typeof options.curve !== "function") throw new Error("CameraShake.curve is required.");
    this.amplitude = options.amplitude.clone();
    this.rotationAmplitude = options.rotationAmplitude.clone();
    this.frequency = options.frequency;
    this.decay = options.decay;
    this.curve = options.curve;
  }

  get active(): boolean {
    return this.#active;
  }

  get elapsed(): number {
    return this.#elapsed;
  }

  /** Start or restart the authored shake waveform. */
  trigger(): this {
    this.#elapsed = 0;
    this.#active = true;
    this.#clearOffset();
    return this;
  }

  /** Stop the effect and clear the offset. */
  stop(): this {
    this.#active = false;
    this.#elapsed = 0;
    this.#clearOffset();
    return this;
  }

  /** Evaluate the current offset and advance by one caller-supplied fixed-step delta. */
  update(dt: number): ICameraShakeOffset {
    if (!Number.isFinite(dt) || dt < 0)
      throw new Error("CameraShake.update delta must be finite and non-negative.");
    if (!this.#active) {
      this.#clearOffset();
      return this.offset;
    }

    const envelope = Math.exp(-this.decay * this.#elapsed);
    const phase = this.#elapsed * this.frequency * Math.PI * 2;
    const sample = this.curve(phase);
    if (!Number.isFinite(sample)) throw new Error("CameraShake.curve must return a finite number.");
    this.offset.position.copy(this.amplitude).multiplyScalar(sample * envelope);
    this.offset.rotation.copy(this.rotationAmplitude).multiplyScalar(sample * envelope);
    this.#elapsed += dt;
    if (!Number.isFinite(this.#elapsed)) throw new Error("CameraShake elapsed time overflowed.");
    if (Math.exp(-this.decay * this.#elapsed) <= Number.EPSILON) this.#active = false;
    return this.offset;
  }

  #clearOffset(): void {
    this.offset.position.set(0, 0, 0);
    this.offset.rotation.set(0, 0, 0);
  }
}

function validateVector(value: Vector3 | null | undefined, name: string): void {
  if (value === undefined || value === null || ![value.x, value.y, value.z].every(Number.isFinite))
    throw new Error(`${name} must contain finite components.`);
}
