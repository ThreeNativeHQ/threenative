import type { Ctx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import { BoxGeometry, type Material, Mesh } from "three";
import type { GameState } from "../state.js";

type GameCtx = Ctx<GameState, PhysicsContext>;

export class Player {
  readonly mesh: Mesh;
  readonly body: CharacterBody3D;
  #verticalVelocity = 0;

  constructor(ctx: GameCtx, material: Material) {
    this.mesh = new Mesh(new BoxGeometry(0.6, 1, 0.6), material);
    this.mesh.position.set(-2, 0.5, 0);
    this.mesh.castShadow = true;
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      autostep: { maxHeight: 0.4, minWidth: 0.2 },
      mesh: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
    });
  }

  update(ctx: GameCtx, dt: number): void {
    const move = ctx.input.vector("move");
    if (ctx.input.justPressed("jump") && this.body.grounded) this.#verticalVelocity = 5;
    this.#verticalVelocity -= 9.81 * dt;
    this.body.move({
      x: move.x * dt * 2,
      y: this.#verticalVelocity * dt,
      z: move.y * dt * 2,
    });
  }

  debug(): Record<string, unknown> {
    return { grounded: this.body.grounded, position: this.mesh.position.toArray() };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
