import type { ICtx } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { BoxGeometry, Group, Mesh, PlaneGeometry, type Vector3Like } from "three";
import type { RangeMaterials } from "../render/materials.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

/** A struck plate swings back up this long after it drops. */
const RESET_SECONDS = 1.4;

export type TargetSpec = {
  readonly position: Vector3Like;
  readonly value: 100 | 150 | 250 | 300;
  readonly width?: number;
  readonly height?: number;
  /** Omit the stand when the plate is bolted to a wall or a walkway rail. */
  readonly standing?: boolean;
};

export class Target {
  readonly group = new Group();
  readonly plate: Mesh;
  readonly value: number;
  #up = true;
  #restY: number;
  #faceMaterial: RangeMaterials["targetFace"];
  #hitMaterial: RangeMaterials["targetHit"];

  constructor(materials: RangeMaterials, spec: TargetSpec) {
    const width = spec.width ?? 1.3;
    const height = spec.height ?? 1.85;
    this.value = spec.value;
    this.#faceMaterial = materials.targetFace;
    this.#hitMaterial = materials.targetHit;
    this.plate = new Mesh(new PlaneGeometry(width, height), materials.targetFace);
    this.plate.castShadow = true;
    this.plate.receiveShadow = false;
    this.plate.userData.target = this;
    this.#restY = spec.position.y;
    this.plate.position.set(0, 0, 0.03);

    const carrier = new Group();
    carrier.add(this.plate);
    carrier.name = "target-carrier";
    this.group.add(carrier);
    this.group.position.set(spec.position.x, spec.position.y, spec.position.z);

    if (spec.standing !== false) {
      // Steel stand: two posts down to the deck plus a cross brace under the plate.
      const legHeight = spec.position.y - height / 2;
      for (const side of [-1, 1]) {
        const post = new Mesh(new BoxGeometry(0.05, legHeight, 0.05), materials.steel);
        post.position.set((side * width) / 2 - side * 0.04, -height / 2 - legHeight / 2, 0);
        post.castShadow = true;
        this.group.add(post);
      }
      const brace = new Mesh(new BoxGeometry(width + 0.06, 0.05, 0.05), materials.steel);
      brace.position.set(0, -height / 2 - 0.03, 0);
      brace.castShadow = true;
      this.group.add(brace);
      const foot = new Mesh(new BoxGeometry(width + 0.3, 0.06, 0.5), materials.steel);
      foot.position.set(0, -spec.position.y + 0.03, 0);
      foot.receiveShadow = true;
      this.group.add(foot);
    }
  }

  get scorable(): boolean {
    return this.#up;
  }

  /** The plate the raycast has to hit; `undefined` once it has dropped. */
  get carrier(): Group {
    return this.plate.parent as Group;
  }

  /** Drops the plate below its stand and schedules the swing back up. */
  strike(ctx: GameCtx): number {
    if (!this.#up) return 0;
    this.#up = false;
    this.plate.material = this.#hitMaterial;
    const carrier = this.carrier;
    void ctx.tween(carrier.rotation, { x: -Math.PI / 2 }, 0.12);
    void ctx.tween(carrier.position, { y: -this.#restY + 0.08 }, 0.16);
    ctx.after(RESET_SECONDS, () => {
      void ctx.tween(carrier.position, { y: 0 }, 0.22);
      void ctx.tween(carrier.rotation, { x: 0 }, 0.26);
      this.plate.material = this.#faceMaterial;
      this.#up = true;
    });
    return this.value;
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
