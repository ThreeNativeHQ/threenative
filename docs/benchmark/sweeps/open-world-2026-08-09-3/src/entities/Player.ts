import type { Ctx } from "@threenative/core";
import {
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  type MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { terrainHeight } from "../render/world.js";
import type { GameState } from "../state.js";

type GameCtx = Ctx<GameState>;
const MOVE_SPEED = 44;
const WORLD_EDGE = 248;

export class Player {
  readonly mesh = new Group();
  readonly velocity = new Vector3();
  #distance = 0;

  constructor(
    ctx: GameCtx,
    materials: {
      readonly coat: MeshStandardMaterial;
      readonly dark: MeshStandardMaterial;
      readonly skin: MeshStandardMaterial;
    },
  ) {
    this.mesh.name = "player";
    const legs = [-0.2, 0.2].map((z) => {
      const leg = new Mesh(new CylinderGeometry(0.11, 0.13, 0.72, 8), materials.dark);
      leg.position.set(0, 0.42, z);
      return leg;
    });
    const body = new Mesh(new CapsuleGeometry(0.34, 0.62, 4, 10), materials.coat);
    body.position.y = 1.18;
    const head = new Mesh(new SphereGeometry(0.28, 12, 8), materials.skin);
    head.position.y = 1.92;
    const hat = new Mesh(new ConeGeometry(0.48, 0.38, 12), materials.dark);
    hat.position.y = 2.25;
    const pack = new Mesh(new CapsuleGeometry(0.25, 0.32, 3, 8), materials.dark);
    pack.rotation.z = Math.PI / 2;
    pack.position.set(-0.3, 1.2, 0);
    for (const part of [...legs, body, head, hat, pack]) {
      part.castShadow = true;
      part.receiveShadow = true;
      this.mesh.add(part);
    }
    this.mesh.position.set(0, terrainHeight(0, 0), 0);
    ctx.add(this.mesh);
  }

  update(ctx: GameCtx, dt: number): void {
    const move = ctx.input.vector("move");
    this.velocity.set(move.x, 0, -move.y);
    if (this.velocity.lengthSq() > 1) this.velocity.normalize();
    if (this.velocity.lengthSq() > 0) {
      const step = this.velocity.clone().multiplyScalar(MOVE_SPEED * dt);
      this.mesh.position.add(step);
      this.mesh.position.z = Math.max(-WORLD_EDGE, Math.min(WORLD_EDGE, this.mesh.position.z));
      this.mesh.rotation.y = Math.atan2(-this.velocity.z, this.velocity.x);
      this.#distance += step.length();
    }
    const ground = terrainHeight(this.mesh.position.x, this.mesh.position.z);
    this.mesh.position.y += (ground - this.mesh.position.y) * Math.min(1, dt * 14);
  }

  debug(): { distance: number; position: number[]; velocity: number[] } {
    return {
      distance: this.#distance,
      position: this.mesh.position.toArray(),
      velocity: this.velocity.toArray(),
    };
  }

  dispose(): void {
    this.mesh.removeFromParent();
  }
}
