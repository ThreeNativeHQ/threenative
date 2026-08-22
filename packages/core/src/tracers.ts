import {
  type BufferGeometry,
  CylinderGeometry,
  type Material,
  Mesh,
  type Object3D,
  Quaternion,
  Vector3,
} from "three";

const UP = new Vector3(0, 1, 0);
/** Below this the round stopped inside the muzzle; a streak that short reads as a flash, not a shot. */
const MIN_DISTANCE = 0.05;
/** How far in front of `from` the segment starts, so the streak clears the weapon that fired it. */
const MAX_LEAD = 0.16;

function validateSpawnOptions(options: ITracerSpawnOptions): void {
  const { lifetime, segmentLength, widthScale } = options;
  if (widthScale !== undefined && (!Number.isFinite(widthScale) || widthScale <= 0)) {
    throw new Error("TracerPool3D.spawn widthScale must be a positive finite number.");
  }
  if (segmentLength !== undefined && (!Number.isFinite(segmentLength) || segmentLength <= 0)) {
    throw new Error("TracerPool3D.spawn segmentLength must be a positive finite number.");
  }
  if (lifetime !== undefined && (!Number.isFinite(lifetime) || lifetime <= 0)) {
    throw new Error("TracerPool3D.spawn lifetime must be a positive finite number.");
  }
}

function streakGeometry(): BufferGeometry {
  // Unit-length along +Y with the base at the origin: scaling y stretches the streak forward.
  const geometry = new CylinderGeometry(0.012, 0.012, 1, 6, 1, true);
  geometry.translate(0, 0.5, 0);
  return geometry;
}

interface ITracerSlot {
  direction: Vector3;
  life: number;
  lifetime: number;
  maxTravel: number;
  mesh: Mesh;
  travel: number;
}

export interface ITracerPool3DOptions {
  /** Slots in the pool. Shots over the count recycle the oldest streak. Default 12. */
  readonly count?: number;
  /**
   * The streak's shape, supplied by the game. The default is a neutral unit-length cylinder
   * along +Y with its base at the origin — the pool stretches it along y, so any geometry laid
   * out the same way works. Override it to change the streak's cross-section or silhouette.
   */
  readonly geometry?: BufferGeometry;
  /**
   * The streak's surface, supplied by the game and cloned per slot so each can fade
   * independently. Required: pooling, travel and fading are the engine's; what the streak
   * looks like never is. Set `opacity` to the peak brightness and pass a transparent,
   * additive surface for the usual bright-fade look.
   */
  readonly material: Material;
  /** Longest streak in metres; shorter shots get a shorter streak. Default 3.2. */
  readonly segmentLength?: number;
  /** Travel speed in metres per second. Default 360. */
  readonly speed?: number;
  /** Seconds a streak lives before fading out fully. Default 0.11. */
  readonly lifetime?: number;
}

/**
 * Per-shot overrides a game passes to {@link TracerPool3D.spawn} — shot-to-shot variation
 * keeps two rounds from reading as one drawn line. The values are the game's (usually from
 * its seeded random so replays stay identical); the pool only applies them.
 */
export interface ITracerSpawnOptions {
  /** Longest streak for this shot, in metres. Defaults to the pool's `segmentLength`. */
  readonly segmentLength?: number;
  /** Seconds this streak lives before fading out fully. Defaults to the pool's `lifetime`. */
  readonly lifetime?: number;
  /** Multiplier on this streak's cross-section (x/z scale). Default 1. */
  readonly widthScale?: number;
}

/**
 * Pooled travelling bullet streaks for hitscan shots.
 *
 * A hitscan round leaves nothing to see, so a shot is only a sound and a number — you cannot tell
 * where it went or who is firing. The pool draws a short bright segment that travels from the
 * muzzle toward the point reached and fades out. Segments are stretched cylinders rather than
 * `Line`s, because line width is not portable across backends and a one-pixel line is invisible at
 * thirty metres.
 *
 * Every member starts visible at zero opacity, so the whole pool doubles as a pipeline prewarm
 * surface (`prewarm(tracers)`); nothing is created while firing. Call {@link update} once per
 * frame and {@link dispose} with the owning scene.
 */
export class TracerPool3D {
  #cursor = 0;
  readonly #direction = new Vector3();
  #disposed = false;
  readonly #geometry: BufferGeometry;
  readonly #lifetime: number;
  readonly #ownsGeometry: boolean;
  readonly #parent: Object3D;
  readonly #peakOpacity: number;
  readonly #quaternion = new Quaternion();
  readonly #segmentLength: number;
  readonly #slots: readonly ITracerSlot[];
  readonly #speed: number;

  constructor(parent: Object3D, options: ITracerPool3DOptions) {
    const { count = 12, lifetime = 0.11, segmentLength = 3.2, speed = 360 } = options;
    if (!Number.isInteger(count) || count <= 0)
      throw new Error("TracerPool3D.count must be a positive integer.");
    if (options.material === undefined) throw new Error("TracerPool3D.material is required.");
    if (!Number.isFinite(segmentLength) || segmentLength <= 0)
      throw new Error("TracerPool3D.segmentLength must be a positive finite number.");
    if (!Number.isFinite(speed) || speed <= 0)
      throw new Error("TracerPool3D.speed must be a positive finite number.");
    if (!Number.isFinite(lifetime) || lifetime <= 0)
      throw new Error("TracerPool3D.lifetime must be a positive finite number.");

    this.#parent = parent;
    this.#lifetime = lifetime;
    this.#segmentLength = segmentLength;
    this.#speed = speed;
    // Fading animates `opacity`, which only renders on a transparent surface.
    options.material.transparent = true;
    this.#peakOpacity = options.material.opacity;
    this.#ownsGeometry = options.geometry === undefined;
    this.#geometry = options.geometry ?? streakGeometry();
    this.#slots = Array.from({ length: count }, () => {
      const mesh = new Mesh(this.#geometry, options.material.clone());
      // Zero-opacity members ride along in render passes from load time, warming the backend's
      // pipeline cache so the first real shot costs no compile stall (see `prewarm`).
      (mesh.material as Material).opacity = 0;
      mesh.visible = true;
      mesh.frustumCulled = false;
      parent.add(mesh);
      return {
        direction: new Vector3(),
        life: 0,
        lifetime,
        maxTravel: 0,
        mesh,
        travel: 0,
      };
    });
  }

  /**
   * Draw one round travelling from `from` along `direction` for `distance` metres.
   * `options` carries the game's per-shot variation; omit it for the pool defaults.
   */
  spawn(
    from: Vector3,
    direction: Vector3,
    distance: number,
    options: ITracerSpawnOptions = {},
  ): void {
    if (this.#disposed) throw new Error("TracerPool3D cannot spawn after dispose.");
    const squaredLength = direction.lengthSq();
    if (!Number.isFinite(squaredLength) || squaredLength <= 0)
      throw new Error("TracerPool3D.spawn direction must be a non-zero finite vector.");
    if (!Number.isFinite(distance))
      throw new Error("TracerPool3D.spawn distance must be a finite number.");
    validateSpawnOptions(options);
    const shotLifetime = options.lifetime ?? this.#lifetime;
    const shotSegmentLength = options.segmentLength ?? this.#segmentLength;
    const widthScale = options.widthScale ?? 1;
    const slot = this.#slots[this.#cursor % this.#slots.length];
    this.#cursor += 1;
    if (slot === undefined || distance < MIN_DISTANCE) return;

    this.#direction.copy(direction).normalize();
    this.#quaternion.setFromUnitVectors(UP, this.#direction);
    const segmentLength = Math.min(shotSegmentLength, distance);
    const lead = Math.min(MAX_LEAD, Math.max(0, distance - segmentLength));
    slot.direction.copy(this.#direction);
    slot.travel = lead;
    slot.maxTravel = Math.max(lead, distance - segmentLength);
    slot.mesh.position.copy(from).addScaledVector(this.#direction, lead);
    slot.mesh.quaternion.copy(this.#quaternion);
    slot.mesh.scale.set(widthScale, segmentLength, widthScale);
    (slot.mesh.material as Material).opacity = this.#peakOpacity;
    slot.life = shotLifetime;
    slot.lifetime = shotLifetime;
  }

  /** Advance every live streak; call once per frame with the frame's delta seconds. */
  update(dt: number): void {
    for (const slot of this.#slots) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      const movement = Math.min(dt * this.#speed, slot.maxTravel - slot.travel);
      slot.travel += movement;
      slot.mesh.position.addScaledVector(slot.direction, movement);
      if (slot.life <= 0 || slot.travel >= slot.maxTravel) {
        slot.life = 0;
        (slot.mesh.material as Material).opacity = 0;
        continue;
      }
      (slot.mesh.material as Material).opacity =
        this.#peakOpacity * Math.min(1, slot.life / slot.lifetime);
    }
  }

  /** Remove every mesh from the parent and release pooled surfaces. Game-owned geometry survives. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const slot of this.#slots) {
      this.#parent.remove(slot.mesh);
      (slot.mesh.material as Material).dispose();
    }
    if (this.#ownsGeometry) this.#geometry.dispose();
  }
}
