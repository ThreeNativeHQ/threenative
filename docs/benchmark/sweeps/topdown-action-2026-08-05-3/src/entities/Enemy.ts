import type { Ctx } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { Group, type Material, Mesh, Vector3 } from "three";
import { ball, spike, tube } from "../render/shapes.js";
import type { GameState } from "../state.js";

type GameCtx = Ctx<GameState, PhysicsContext>;

export class Enemy {
  readonly mesh: Group;
  readonly id: string;
  #alive = true;
  #pulse = 0;

  constructor(ctx: GameCtx, id: string, x: number, z: number, material: Material, coreMaterial: Material) {
    this.id = id;
    this.mesh = new Group();
    this.mesh.name = id;
    this.mesh.position.set(x, 0.58, z);
    const shadow = tube(0.62, 0.62, 0.12, material, { segments: 18 });
    shadow.position.y = -0.3;
    const body = ball(0.48, material, { segments: 18 });
    const eye = ball(0.19, coreMaterial, { segments: 14 });
    eye.position.set(0, 0.14, 0.38);
    const fin = spike(0.18, 0.45, coreMaterial, { segments: 6 });
    fin.position.y = 0.55;
    this.mesh.add(shadow, body, eye, fin);
    this.mesh.traverse((child) => {
      if (child instanceof Mesh) child.castShadow = true;
    });
    ctx.add(this.mesh);
  }

  get alive(): boolean {
    return this.#alive;
  }

  get state(): string {
    return this.#alive ? "alive" : "destroyed";
  }

  hit(): boolean {
    if (!this.#alive) return false;
    this.#alive = false;
    this.#pulse = 0.32;
    this.mesh.scale.setScalar(1.25);
    return true;
  }

  update(dt: number, time: number): void {
    if (!this.#alive) {
      this.#pulse = Math.max(0, this.#pulse - dt);
      this.mesh.scale.lerp(new Vector3(0.01, 0.01, 0.01), 1 - Math.exp(-dt * 8));
      this.mesh.position.y += dt * 1.4;
      if (this.#pulse <= 0) this.mesh.visible = false;
      return;
    }
    this.mesh.position.y = 0.58 + Math.sin(time * 2.4 + this.mesh.position.x) * 0.06;
    this.mesh.rotation.y += dt * 0.55;
  }

  debug(): { position: number[]; state: string; alive: boolean } {
    return { position: this.mesh.position.toArray(), state: this.#alive ? "alive" : "destroyed", alive: this.#alive };
  }

  dispose(): void {
    this.mesh.removeFromParent();
  }
}
