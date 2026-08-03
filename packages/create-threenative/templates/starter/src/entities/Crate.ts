import type { Ctx } from "@threenative/core";
import { CollisionShape3D, type PhysicsContext, RigidBody3D } from "@threenative/physics";
import { BoxGeometry, type Material, Mesh } from "three";
import type { GameState } from "../state.js";

export class Crate {
  readonly mesh: Mesh;
  readonly body: RigidBody3D;

  constructor(
    ctx: Ctx<GameState, PhysicsContext>,
    x: number,
    y: number,
    z: number,
    material: Material,
  ) {
    this.mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
    this.mesh.position.set(x, y, z);
    this.mesh.castShadow = true;
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
