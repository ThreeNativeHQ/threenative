import type { ICtx } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import type { Group, Vector3 } from "three";
import type { IEnemySpot } from "../render/level.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

/**
 * A patrolling hazard. It walks its lane, turns at both ends, and bobs.
 *
 * The player test is a distance check rather than an `Area3D`: the area would
 * have to be repositioned every frame anyway, and two lines of `hypot` cannot
 * disagree with where the mesh is drawn.
 */
export class Enemy {
  readonly mesh: Group;
  #direction = 1;
  #elapsed = 0;
  readonly #spot: IEnemySpot;

  constructor(ctx: GameCtx, spot: IEnemySpot, mesh: Group) {
    this.#spot = spot;
    this.mesh = mesh;
    this.mesh.position.set((spot.from + spot.to) / 2, spot.y, spot.z);
    ctx.add(this.mesh);
  }

  update(dt: number): void {
    this.#elapsed += dt;
    const spot = this.#spot;
    this.mesh.position.x += this.#direction * spot.speed * dt;
    if (this.mesh.position.x > spot.to) {
      this.mesh.position.x = spot.to;
      this.#direction = -1;
    } else if (this.mesh.position.x < spot.from) {
      this.mesh.position.x = spot.from;
      this.#direction = 1;
    }
    // Face the way it walks, and squash-bob so it never reads as a static prop.
    this.mesh.rotation.y = this.#direction > 0 ? Math.PI / 2 : -Math.PI / 2;
    if (this.#spot.kind === "mushroom") {
      const hop = Math.abs(Math.sin(this.#elapsed * 5));
      this.mesh.position.y = spot.y + hop * 0.16;
      this.mesh.scale.set(1 + (1 - hop) * 0.08, 1 - (1 - hop) * 0.1, 1 + (1 - hop) * 0.08);
    } else {
      this.mesh.position.y = spot.y + Math.sin(this.#elapsed * 2) * 0.03;
    }
  }

  /** True when the player's centre is inside the hazard's touch radius. */
  touches(position: Vector3): boolean {
    const dx = position.x - this.mesh.position.x;
    const dy = position.y - this.mesh.position.y;
    const dz = position.z - this.mesh.position.z;
    return Math.abs(dy) < 1.1 && Math.hypot(dx, dz) < 0.82;
  }

  /** A stomp: the player is above the hazard and falling. */
  stomped(position: Vector3, velocityY: number): boolean {
    return velocityY < -1 && position.y - this.mesh.position.y > 0.55;
  }

  debug(): { kind: string; position: number[] } {
    return { kind: this.#spot.kind, position: this.mesh.position.toArray() };
  }

  dispose(): void {
    this.mesh.removeFromParent();
  }
}
