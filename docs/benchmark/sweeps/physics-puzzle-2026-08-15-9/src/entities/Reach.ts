import type { ICtx } from "@threenative/core";
import { Area3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Object3D, type Vector3 } from "three";
import { LAYER_PHANTOM, LAYER_REACH, LAYER_SOLID } from "../level/layout.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

/** The capsule's own shell, rounded out to a box. Anything inside it touches the character. */
const WIDTH = 1.14;
const HEIGHT = 1.5;

/**
 * The character's contact volume.
 *
 * A solid body cannot overlap the character's capsule, so anything the
 * simulation reports inside this slightly larger shell is a body the character
 * is actually against — the shove, or a phantom it is standing inside. It exists
 * so those interactions are *observable*: `Area3D` is the only thing the runtime
 * drains contacts from, and without one a playtest can see the crate move but
 * never see what moved it.
 *
 * It changes nothing physically. The shape is a sensor and its layer is scanned
 * by no body's mask.
 */
export class Reach {
  readonly object = new Object3D();
  readonly area: Area3D;
  readonly tags: readonly string[] = ["reach"];

  constructor(ctx: GameCtx, position: Vector3) {
    this.object.position.copy(position);
    this.area = new Area3D({
      collisionLayer: LAYER_REACH,
      collisionMask: LAYER_SOLID | LAYER_PHANTOM,
      entity: "reach",
      physics: ctx.physics,
      position,
      shape: CollisionShape3D.box(WIDTH, HEIGHT, WIDTH),
    });
  }

  follow(position: Vector3): void {
    this.object.position.copy(position);
    this.area.setPosition(position);
  }

  debug(): Record<string, number> {
    return { x: this.object.position.x, y: this.object.position.y, z: this.object.position.z };
  }

  dispose(): void {
    this.area.dispose();
  }
}
