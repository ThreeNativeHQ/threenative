import type { ICtx } from "@threenative/core";
import { Area3D, CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { Group, type Material, type Object3D } from "three";
import { block, tube } from "../render/shapes.js";
import type { GameState } from "../state.js";

/**
 * The far side of the gap: a fixed island, a flagpole, and the pennant the packaged glTF
 * proof asset is cut from. Landing anywhere on it ends the run.
 *
 * The island top sits below the ledge on purpose. A same-height landing has to be jumped
 * within a couple of frames of the edge; dropping 0.4 m widens that window to about half
 * a second, which is what makes coyote time feel generous instead of decorative.
 */
const ISLAND = { depth: 2.6, height: 0.4, top: -0.4, width: 3, x: 7.9, z: 0 } as const;
const POLE = { height: 2.4, radius: 0.05, x: 8.4, z: -0.5 } as const;
const PENNANT_SCALE = 0.55;

export interface IGoalMaterials {
  /** The island itself: the same ground the ledge is made of, across the gap. */
  readonly floor: Material;
  /** The pole. The accent role, and the only warm thing on the far side. */
  readonly goal: Material;
}

export class Goal {
  /** The whole marker, so a playtest `visibility` row can ask whether it is on screen. */
  readonly mesh: Group;
  readonly area: Area3D;
  readonly #body: RigidBody3D;

  constructor(ctx: ICtx<GameState, IPhysicsContext>, materials: IGoalMaterials, pennant: Object3D) {
    // Children carry world coordinates and the group stays at the origin: a physics body
    // reads its object's own transform, and a nested offset would silently desync them.
    this.mesh = new Group();
    const island = block(ISLAND.width, ISLAND.height, ISLAND.depth, materials.floor, {
      radius: 0.16,
    });
    island.position.set(ISLAND.x, ISLAND.top - ISLAND.height / 2, ISLAND.z);
    const pole = tube(POLE.radius, POLE.radius, POLE.height, materials.goal);
    pole.position.set(POLE.x, ISLAND.top + POLE.height / 2, POLE.z);
    // The proof triangle points +x once it is turned on its side, which is a pennant. Its
    // hoist edge lands on the pole; the rest of it flies clear.
    pennant.rotation.z = -Math.PI / 2;
    pennant.scale.setScalar(PENNANT_SCALE);
    pennant.position.set(
      POLE.x + 0.6 * PENNANT_SCALE,
      ISLAND.top + POLE.height - 0.5,
      POLE.z + POLE.radius,
    );
    this.mesh.add(island, pole, pennant);
    ctx.add(this.mesh);

    this.#body = new RigidBody3D({
      object: island,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(island),
      type: "fixed",
    });
    // Tall enough to catch a landing, shallow enough that a body still falling past the
    // island's flank in the gap is metres below it and never trips the finish.
    this.area = new Area3D({
      physics: ctx.physics,
      position: { x: ISLAND.x, y: ISLAND.top + 0.8, z: ISLAND.z },
      shape: CollisionShape3D.box(ISLAND.width, 1.6, ISLAND.depth),
    });
  }

  dispose(): void {
    this.area.dispose();
    this.#body.dispose();
    this.mesh.removeFromParent();
  }
}
