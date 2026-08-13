import type { ICtx } from "@threenative/core";
import { Area3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import { CylinderGeometry, Group, Mesh, Vector3 } from "three";
import { createMaterials } from "../render/materials.js";
import type { GameState } from "../state.js";
import { PLAYER_LAYER } from "./Character.js";
type GameCtx = ICtx<GameState, IPhysicsContext>;
export class Pickup {
  readonly mesh: Group;
  readonly area: Area3D;
  readonly tags = ["pickup", "coin"];
  collected = false;
  #base: Vector3;
  #time = 0;
  #unsubscribe: () => void;
  #updateHandle!: ReturnType<GameCtx["every"]>;

  constructor(ctx: GameCtx, at: Vector3, onCollect: () => void) {
    this.#base = at.clone();
    this.mesh = new Group();
    const materials = createMaterials();
    const coin = new Mesh(
      new CylinderGeometry(0.28, 0.28, 0.12, 18).rotateX(Math.PI / 2),
      materials.accent,
    );
    coin.castShadow = true;
    this.mesh.add(coin);
    this.mesh.position.copy(at);
    ctx.add(this.mesh);
    this.area = new Area3D({
      collisionMask: PLAYER_LAYER,
      entity: "coin",
      physics: ctx.physics,
      position: at,
      shape: CollisionShape3D.sphere(0.68),
    });
    this.#unsubscribe = this.area.on("bodyEntered", () => {
      if (this.collected) return;
      this.collected = true;
      this.mesh.visible = false;
      onCollect();
      ctx.entities.queueFree(this);
    });
    this.#updateHandle = ctx.every((dt) => this.update(dt));
  }

  update(dt: number): void {
    if (this.collected) return;
    this.#time += dt;
    this.mesh.rotation.y += dt * 4;
    this.mesh.position.y = this.#base.y + Math.sin(this.#time * 3 + this.#base.x) * 0.12;
  }

  debug(): Record<string, unknown> {
    return { collected: this.collected, position: this.mesh.position.toArray() };
  }

  dispose(): void {
    this.#updateHandle.cancel();
    this.#unsubscribe();
    this.area.dispose();
    this.mesh.removeFromParent();
  }
}

export function coinArc(start: Vector3, count: number, span: number, rise: number): Vector3[] {
  if (!Number.isInteger(count) || count <= 0) throw new Error("coinArc requires a positive count.");
  return Array.from({ length: count }, (_, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    return new Vector3(start.x + t * span, start.y + Math.sin(t * Math.PI) * rise, start.z);
  });
}
