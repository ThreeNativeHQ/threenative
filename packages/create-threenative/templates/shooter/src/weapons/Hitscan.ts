import type { IPhysicsContext, IRayHit } from "@threenative/physics";
import type { Vector3 } from "three";

export class Hitscan {
  readonly range: number;
  readonly cooldown: number;
  #cooldown = 0;

  constructor(range = 24, cooldown = 0.22) {
    this.range = range;
    this.cooldown = cooldown;
  }

  update(dt: number): void {
    this.#cooldown = Math.max(0, this.#cooldown - dt);
  }

  fire(
    physics: IPhysicsContext,
    from: Vector3,
    direction: Vector3,
    collisionMask: number,
  ): IRayHit | undefined {
    if (this.#cooldown > 0) return undefined;
    this.#cooldown = this.cooldown;
    const to = from.clone().add(direction.clone().normalize().multiplyScalar(this.range));
    return physics.directSpaceState.intersectRay({
      collisionMask,
      from,
      to,
    });
  }

  probe(
    physics: IPhysicsContext,
    from: Vector3,
    to: Vector3,
    collisionMask: number,
  ): IRayHit | undefined {
    return physics.directSpaceState.intersectRay({ collisionMask, from, to });
  }
}
