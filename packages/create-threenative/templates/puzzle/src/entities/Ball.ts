import type { ICtx } from "@threenative/core";
import { Area3D, CollisionShape3D, RigidBody3D } from "@threenative/physics";
import type { Mesh } from "three";
import { BALL_LAYER, BALL_MASK, type PuzzlePhysics } from "../physics.js";
import { BALL_RADIUS, GOAL_RADIUS, ball as ballMesh } from "../render/shapes.js";
import { BALL_START, GOAL_POSITION } from "../room.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, PuzzlePhysics>;

/**
 * The thing that has to reach the goal, and the goal that notices when it does.
 *
 * The goal is an `Area3D`: an overlap volume that reports what is inside it without becoming
 * something the ball can bounce off. A win condition written as a distance check instead would
 * pass through walls and fire on a ball that flew over the ring.
 */
export class Ball {
  readonly mesh: Mesh;
  readonly body: RigidBody3D;
  readonly goal: Area3D;
  #scored = false;

  constructor(ctx: GameCtx) {
    this.mesh = ballMesh();
    this.mesh.position.set(BALL_START.x, BALL_START.y, BALL_START.z);
    ctx.add(this.mesh);
    this.body = new RigidBody3D({
      collisionLayer: BALL_LAYER,
      collisionMask: BALL_MASK,
      entity: "ball",
      mass: 3.2,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.sphere(BALL_RADIUS),
    });
    this.goal = new Area3D({
      collisionLayer: 0,
      collisionMask: BALL_LAYER,
      entity: "goal",
      physics: ctx.physics,
      position: { x: GOAL_POSITION.x, y: GOAL_POSITION.y + 0.5, z: GOAL_POSITION.z },
      shape: CollisionShape3D.sphere(GOAL_RADIUS),
    });
    // Godot's `Area3D.body_entered`, unchanged. The mask above means only the ball can raise it.
    this.goal.on("bodyEntered", () => {
      this.#scored = true;
    });
  }

  /** True once the ball has entered the goal volume, and every frame after. */
  get scored(): boolean {
    return this.#scored;
  }

  debug(): Record<string, unknown> {
    const velocity = this.body.linearVelocity;
    return {
      position: this.mesh.position.toArray(),
      scored: this.scored,
      speed: Math.hypot(velocity.x, velocity.y, velocity.z),
    };
  }

  dispose(): void {
    this.goal.dispose();
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
