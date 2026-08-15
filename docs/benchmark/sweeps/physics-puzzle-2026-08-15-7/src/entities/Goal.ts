import type { ICtx } from "@threenative/core";
import { Area3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { Group, Mesh, RingGeometry } from "three";
import { GOAL, LAYER_GOAL, LAYER_PLAYER, LAYER_SOLID } from "../level/layout.js";
import type { Materials } from "../render/materials.js";
import { block } from "../render/shapes.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

/**
 * The destination.
 *
 * The win is an `Area3D` sensor overlap reported by the simulation, so the only
 * way to trip it is for a body to actually be there — the character, or a crate
 * the character shoved in. Nothing in this game measures a distance to decide
 * whether the puzzle is solved; `state.goalDistance` exists for the HUD and is
 * never read by the win path.
 *
 * The mask deliberately omits the phantom layer: a body the character can walk
 * through must not be a body the character can win with.
 */
export class Goal {
  readonly object: Group;
  readonly area: Area3D;
  readonly tags: readonly string[] = ["goal"];

  constructor(ctx: GameCtx, materials: Materials) {
    const size = GOAL.half * 2;
    this.object = new Group();
    this.object.name = "goal";
    this.object.position.set(GOAL.x, 0, GOAL.z);

    const kerb = block(size + 0.5, 0.24, size + 0.5, materials.stone, { radius: 0.06 });
    kerb.position.y = 0.11;
    const pad = block(size, 0.12, size, materials.goalRim, { radius: 0.05 });
    pad.position.y = 0.22;
    this.object.add(kerb, pad);

    for (const [index, inner] of [0.42, 0.68, 0.9].entries()) {
      const ring = new Mesh(
        new RingGeometry(GOAL.half * inner, GOAL.half * inner + 0.09, 4, 1, Math.PI / 4),
        materials.goal,
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.29 + index * 0.001;
      this.object.add(ring);
    }
    ctx.add(this.object);

    this.area = new Area3D({
      collisionLayer: LAYER_GOAL,
      collisionMask: LAYER_SOLID | LAYER_PLAYER,
      entity: "goal",
      physics: ctx.physics,
      position: { x: GOAL.x, y: 0.6, z: GOAL.z },
      shape: CollisionShape3D.box(size, 1.4, size),
    });
  }

  debug(): Record<string, number> {
    return { x: GOAL.x, y: 0, z: GOAL.z };
  }

  dispose(): void {
    this.area.dispose();
    this.object.removeFromParent();
  }
}
