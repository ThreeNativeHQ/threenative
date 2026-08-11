import type { ICtx } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { BoxGeometry, Mesh, MeshNormalMaterial } from "three";

export class Crate {
  readonly mesh: Mesh;
  readonly body: RigidBody3D;

  constructor(
    ctx: ICtx<{ playerX: number; score: number }, IPhysicsContext>,
    x: number,
    y: number,
    z = 0,
  ) {
    this.mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshNormalMaterial());
    this.mesh.position.set(x, y, z);
    ctx.add(this.mesh);
    this.body = new RigidBody3D({
      mass: 8,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(this.mesh),
    });
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
  }
}
