import type { Ctx } from "@threenative/core";
import { CollisionShape3D, type PhysicsContext, RigidBody3D } from "@threenative/physics";
import { BoxGeometry, Mesh, MeshNormalMaterial } from "three";
import type { GameState } from "../state.js";

export class Crate {
  readonly mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshNormalMaterial());
  readonly body: RigidBody3D;

  constructor(ctx: Ctx<GameState, PhysicsContext>, x: number, y: number, z = 0) {
    this.mesh.position.set(x, y, z);
    ctx.add(this.mesh);
    this.body = new RigidBody3D({
      mass: 8,
      mesh: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(this.mesh),
    });
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
