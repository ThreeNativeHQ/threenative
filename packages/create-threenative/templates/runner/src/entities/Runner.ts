import type { ICtx } from "@threenative/core";
import { Area3D, CollisionShape3D } from "@threenative/physics";
import { type Group, MathUtils } from "three";
import { type IRunnerConventions, prepareRunnerConventions } from "../conventions.js";
import { OBSTACLE_LAYER, type RunnerPhysics } from "../physics.js";
import { runner as runnerMesh } from "../render/shapes.js";
import type { ITouchInput } from "../render/touch-controls.js";
import type { GameState } from "../state.js";
import { LANE_X } from "../track.js";

type GameCtx = ICtx<GameState, RunnerPhysics>;

const LANE_BLEND = 12;
const JUMP_SPEED = 7.2;
const GRAVITY = -19;
/** Within this many metres of an obstacle's centre and still alive: a near miss. */
const NEAR_MISS = 1.5;

/**
 * The player.
 *
 * Not a rigid body: a runner's feel is a lane snap and a fixed jump arc, and handing either to a
 * solver makes both worse. What *is* physics is the collision — the runner carries an `Area3D`
 * that scans the obstacle layer, so a hit is an overlap the engine reports rather than a distance
 * check this file would have to keep in sync with the obstacle geometry.
 */
export class Runner {
  readonly mesh: Group;
  readonly tags = ["player", "runner"];
  readonly hitbox: Area3D;
  #conventions: IRunnerConventions;
  #lane = 1;
  #height = 0;
  #vertical = 0;
  #crashed = false;
  #nearMisses = 0;

  constructor(ctx: GameCtx) {
    this.mesh = runnerMesh();
    this.mesh.name = "player";
    this.#conventions = prepareRunnerConventions(this.mesh);
    ctx.add(this.mesh);
    this.hitbox = new Area3D({
      collisionLayer: 0,
      collisionMask: OBSTACLE_LAYER,
      entity: "runner-hitbox",
      physics: ctx.physics,
      position: { x: 0, y: 0.7, z: 0 },
      shape: CollisionShape3D.box(0.7, 1.3, 0.7),
    });
    this.hitbox.on("bodyEntered", () => {
      this.#crashed = true;
    });
  }

  get lane(): number {
    return this.#lane;
  }

  get crashed(): boolean {
    return this.#crashed;
  }

  get airborne(): boolean {
    return this.#height > 0.01;
  }

  get nearMisses(): number {
    return this.#nearMisses;
  }

  /** Counts one near miss. The scene owns *what* counts as near; this owns the tally. */
  recordNearMiss(): void {
    this.#nearMisses += 1;
  }

  update(ctx: GameCtx, dt: number, distance: number, touch?: ITouchInput): void {
    if (this.#crashed) return;
    const move = ctx.input.vector("move");
    // The stick is a lane *change*, not an axis: holding right must move one lane, not slide
    // continuously across three. `#steering` is that edge, and it is why a held thumb behaves
    // like a tapped key.
    const steer = move.x + (touch?.move.x ?? 0);
    if (touch?.leftPressed === true) this.#lane -= 1;
    if (touch?.rightPressed === true) this.#lane += 1;
    if (Math.abs(steer) > 0.6 && !this.#steering) {
      this.#lane += steer > 0 ? 1 : -1;
      this.#steering = true;
    }
    if (Math.abs(steer) <= 0.4) this.#steering = false;
    this.#lane = MathUtils.clamp(this.#lane, 0, LANE_X.length - 1);

    const stickJump = (touch?.move.y ?? 0) > 0.65;
    if ((ctx.input.justPressed("jump") || stickJump) && !this.airborne) this.#vertical = JUMP_SPEED;
    this.#height = Math.max(0, this.#height + this.#vertical * dt);
    this.#vertical = this.#height > 0 ? this.#vertical + GRAVITY * dt : 0;

    const targetX = LANE_X[this.#lane] ?? 0;
    const blend = Math.min(1, Math.max(0, dt) * LANE_BLEND);
    this.mesh.position.x += (targetX - this.mesh.position.x) * blend;
    this.mesh.position.z = -distance;
    this.mesh.rotation.z = (targetX - this.mesh.position.x) * 0.35;
    this.#conventions.applyGrounding(this.#height, dt);
    this.hitbox.setPosition({
      x: this.mesh.position.x,
      y: this.#height + 0.7,
      z: this.mesh.position.z,
    });
  }

  /** True when the runner is beside, rather than on top of, an obstacle at `x` on this stretch. */
  isNearMiss(obstacleX: number): boolean {
    const gap = Math.abs(obstacleX - this.mesh.position.x);
    return gap > 0.85 && gap < NEAR_MISS;
  }

  debug(): Record<string, unknown> {
    return {
      airborne: this.airborne,
      crashed: this.#crashed,
      groundClearance: this.#conventions.groundSnap.clearance,
      lane: this.#lane,
      nearMisses: this.#nearMisses,
      normaliseFactor: this.#conventions.normaliseFactor,
      position: this.mesh.position.toArray(),
    };
  }

  dispose(): void {
    this.hitbox.dispose();
    this.mesh.removeFromParent();
  }

  #steering = false;
}
