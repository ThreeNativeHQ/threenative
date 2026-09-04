import type { Ctx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import type { Material, Mesh } from "three";
import { block } from "../render/shapes.js";
import type { GameState } from "../state.js";

type GameCtx = Ctx<GameState, PhysicsContext>;

const MOVE_SPEED = 0.45;
const SPAWN = { x: 0, y: 0.7, z: 4 } as const;

export class Player {
  readonly mesh: Mesh;
  readonly body: CharacterBody3D;

  constructor(ctx: GameCtx, material: Material) {
    this.mesh = block(0.7, 1.2, 0.7, material);
    this.mesh.position.set(SPAWN.x, SPAWN.y, SPAWN.z);
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      gravity: 0,
      mesh: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.3, 0.28),
    });
  }

  update(ctx: GameCtx, dt: number): void {
    const move = ctx.input.vector("move");
    this.body.velocity.x = move.x * MOVE_SPEED;
    this.body.velocity.z = -move.y * MOVE_SPEED;
    this.body.moveAndSlide(dt);
  }

  respawn(): void {
    this.body.velocity.set(0, 0, 0);
    this.body.body.setTranslation(SPAWN, true);
    this.mesh.position.set(SPAWN.x, SPAWN.y, SPAWN.z);
  }

  debug(): { grounded: boolean; position: number[] } {
    return {
      grounded: this.body.grounded,
      position: this.mesh.position.toArray(),
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
