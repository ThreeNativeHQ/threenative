import type { ICtx } from "@threenative/core";
import { CollisionShape3D, Joint3D, RigidBody3D } from "@threenative/physics";
import { type Mesh, Vector3 } from "three";
import { type PuzzlePhysics, ROOM_LAYER, WEIGHT_LAYER } from "../physics.js";
import { weight as weightMesh } from "../render/shapes.js";
import { GANTRY_HEIGHT } from "../room.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, PuzzlePhysics>;

const BOB_RADIUS = 0.62;
const CABLE = 2.6;
const ANCHOR = new Vector3(0, GANTRY_HEIGHT, 3.2);
const SHOVE = 7.5;

/**
 * A weight on a hinge, and the only force in the room the player cannot supply by walking.
 *
 * The beam is a fixed body with no visual of its own — the gantry mesh is decoration, and the
 * hinge needs something on the world side to hang from. `Joint3D.hinge` takes the anchor in each
 * body's *local* space, so the beam's anchor is its origin and the bob's is the cable length
 * above its centre.
 */
export class Pendulum {
  readonly mesh: Mesh;
  readonly bob: RigidBody3D;
  readonly beam: RigidBody3D;
  readonly hinge: Joint3D;
  #swings = 0;

  constructor(ctx: GameCtx) {
    this.mesh = weightMesh(BOB_RADIUS);
    this.mesh.name = "pendulum-weight";
    this.mesh.position.set(ANCHOR.x, ANCHOR.y - CABLE, ANCHOR.z);
    ctx.add(this.mesh);

    this.beam = new RigidBody3D({
      collisionLayer: ROOM_LAYER,
      collisionMask: 0,
      entity: "pendulum.beam",
      physics: ctx.physics,
      position: { x: ANCHOR.x, y: ANCHOR.y, z: ANCHOR.z },
      shape: CollisionShape3D.box(0.3, 0.2, 0.3),
      type: "fixed",
    });
    this.bob = new RigidBody3D({
      collisionLayer: WEIGHT_LAYER,
      entity: "pendulum.bob",
      mass: 90,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.sphere(BOB_RADIUS),
    });
    this.hinge = Joint3D.hinge({
      anchorA: { x: 0, y: 0, z: 0 },
      anchorB: { x: 0, y: CABLE, z: 0 },
      axis: { x: 1, y: 0, z: 0 },
      bodyA: this.beam,
      bodyB: this.bob,
      physics: ctx.physics,
    });
  }

  get swings(): number {
    return this.#swings;
  }

  /** One shove along +z. The bob does the rest, which is the reason it is on a hinge. */
  swing(): void {
    this.#swings += 1;
    const velocity = this.bob.linearVelocity;
    this.bob.linearVelocity = { x: velocity.x, y: velocity.y, z: velocity.z + SHOVE };
  }

  debug(): Record<string, unknown> {
    return {
      position: this.mesh.position.toArray(),
      speed: Math.hypot(this.bob.linearVelocity.x, this.bob.linearVelocity.z),
      swings: this.#swings,
    };
  }

  dispose(): void {
    this.hinge.dispose();
    this.bob.dispose();
    this.beam.dispose();
    this.mesh.removeFromParent();
  }
}
