import type { Ctx } from "@threenative/core";
import { CharacterBody3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import { BoxGeometry, Mesh, MeshNormalMaterial } from "three";

type GameCtx = Ctx<{ playerX: number; score: number }, PhysicsContext>;

export class Player {
  readonly mesh: Mesh;
  readonly body: CharacterBody3D;

  constructor(ctx: GameCtx) {
    this.mesh = new Mesh(new BoxGeometry(0.6, 1, 0.6), new MeshNormalMaterial());
    this.mesh.position.set(-2, 0.5, 0);
    ctx.add(this.mesh);
    this.body = new CharacterBody3D({
      autostep: { maxHeight: 0.4, minWidth: 0.2 },
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.2, 0.3),
    });
  }

  update(ctx: GameCtx, dt: number): void {
    const move = ctx.input.vector("move");
    this.body.move({ x: move.x * dt * 2, y: 0, z: move.y * dt * 2 });
  }

  debug(): Record<string, unknown> {
    return { grounded: this.body.grounded, position: this.mesh.position.toArray() };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
