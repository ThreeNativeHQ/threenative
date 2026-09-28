import {
  type BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
  Vector3,
} from "three";

/**
 * One pooled billboard-decay mechanism for the effects that are "a card that drifts,
 * grows and fades": muzzle smoke here, enemy smoke in the scene. Pooling, lifetime,
 * billboarding and dispatch live here once; texture, colour, size curve and timing come
 * from each caller, so an effect can change its look completely without editing this
 * file. Velocity-stretched sparks, tumbling chips and roll-driven flash cards are NOT
 * this shape and stay in their own systems.
 *
 * Every member sits in the scene from construction at zero opacity — revealing a hidden
 * mesh on first use makes WebGPU build its pipeline mid-frame, the once-per-session hitch.
 */

export interface IPooledBillboardsOptions {
  /** Slots in the pool; spawns over the count recycle the oldest. */
  readonly count: number;
  /** Card geometry. Default is a 1×1 plane scaled per spawn. */
  readonly geometry?: BufferGeometry;
  /** Cloned per slot; set the look on the prototype, never on a live clone. */
  readonly materialPrototype: MeshBasicMaterial;
  readonly renderOrder?: number;
}

export interface IBillboardSpawn {
  readonly at: Vector3;
  /** Seconds from spawn to retirement. */
  readonly life: number;
  /** World-space metres per second, held for the whole life. */
  readonly drift: Vector3;
  readonly scaleFrom: number;
  readonly scaleTo: number;
  /** Opacity at birth; decays linearly to zero. */
  readonly opacity: number;
}

interface ISlot {
  drift: Vector3;
  life: number;
  life0: number;
  mesh: Mesh;
  opacity0: number;
  scaleFrom: number;
  scaleTo: number;
}

const scratchScale = new Vector3();

export class PooledBillboards {
  readonly #slots: ISlot[];
  #cursor = 0;
  /** Dead slots stop being submitted once their pipeline exists. See `settle`. */
  #settled = false;

  constructor(
    parent: Object3D,
    { count, geometry, materialPrototype, renderOrder }: IPooledBillboardsOptions,
  ) {
    const card = geometry ?? new PlaneGeometry(1, 1);
    this.#slots = Array.from({ length: count }, () => {
      const mesh = new Mesh(card, materialPrototype.clone());
      mesh.renderOrder = renderOrder ?? 0;
      mesh.visible = true;
      (mesh.material as MeshBasicMaterial).opacity = 0;
      parent.add(mesh);
      return { drift: new Vector3(), life: 0, life0: 1, mesh, opacity0: 0, scaleFrom: 1, scaleTo: 1 };
    });
  }

  /**
   * Stop drawing the cards that are not alive.
   *
   * Same trade as the decal field: every slot is resident from frame one so its pipeline compiles
   * during loading, and the cost is a draw call per dead card, every frame, forever. A phone pays
   * for the call rather than the pixels, so parking an invisible quad is not free there the way it
   * is on a desktop. Once compiled the pipeline is cached, so `spawn` re-showing a slot is free.
   */
  settle(): void {
    this.#settled = true;
    for (const slot of this.#slots) {
      if (slot.life <= 0) slot.mesh.visible = false;
    }
  }

  /** Birth one card on the next recycled slot. */
  spawn({
    at,
    life,
    drift,
    scaleFrom,
    scaleTo,
    opacity,
  }: IBillboardSpawn): void {
    const slot = this.#slots[this.#cursor % this.#slots.length];
    this.#cursor += 1;
    if (slot === undefined || life <= 0) return;
    slot.life = life;
    slot.life0 = life;
    slot.drift.copy(drift);
    slot.opacity0 = opacity;
    slot.scaleFrom = scaleFrom;
    slot.scaleTo = scaleTo;
    slot.mesh.position.copy(at);
    slot.mesh.scale.setScalar(scaleFrom);
    slot.mesh.visible = true;
    (slot.mesh.material as MeshBasicMaterial).opacity = opacity;
  }

  /** Advance every live card; `eye` is the point the billboards face. */
  update(dt: number, eye: Vector3): void {
    for (const slot of this.#slots) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      const material = slot.mesh.material as MeshBasicMaterial;
      if (slot.life <= 0) {
        material.opacity = 0;
        if (this.#settled) slot.mesh.visible = false;
        continue;
      }
      const age = 1 - slot.life / slot.life0;
      slot.mesh.position.addScaledVector(slot.drift, dt);
      slot.mesh.scale.copy(scratchScale.setScalar(slot.scaleFrom + (slot.scaleTo - slot.scaleFrom) * age));
      material.opacity = slot.opacity0 * (slot.life / slot.life0);
      slot.mesh.lookAt(eye);
    }
  }

  dispose(): void {
    for (const slot of this.#slots) {
      slot.mesh.removeFromParent();
      (slot.mesh.material as MeshBasicMaterial).dispose();
    }
  }
}
