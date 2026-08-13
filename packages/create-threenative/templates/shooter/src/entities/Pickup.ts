import type { ICtx } from "@threenative/core";
import { Area3D, CollisionShape3D, type IPhysicsContext } from "@threenative/physics";
import type { Group, Vector3 } from "three";
import { createPickupVisual } from "../render/shapes.js";
import type { GameState } from "../state.js";
import { PLAYER_LAYER } from "./Player.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

export class Pickup {
  readonly mesh: Group;
  readonly area: Area3D;
  readonly tags = ["pickup", "health"];
  collected = false;
  #base: Vector3;
  #time = 0;
  #unsubscribe: () => void;
  #onCollect: () => void;

  constructor(
    ctx: GameCtx,
    materials: Parameters<typeof createPickupVisual>[0],
    position: Vector3,
    playerBodyId: number,
    onCollect: () => void,
  ) {
    this.#base = position.clone();
    this.#onCollect = onCollect;
    this.mesh = createPickupVisual(materials);
    this.mesh.position.copy(position);
    ctx.add(this.mesh);
    this.area = new Area3D({
      collisionMask: PLAYER_LAYER,
      entity: "health-pickup",
      physics: ctx.physics,
      position,
      shape: CollisionShape3D.sphere(0.25),
    });
    this.#unsubscribe = this.area.on("bodyEntered", (body) => {
      if (this.collected || body.body.id !== playerBodyId) return;
      this.collected = true;
      this.mesh.visible = false;
      this.area.monitoring = false;
      this.#onCollect();
    });
  }

  update(dt: number): void {
    if (this.collected) return;
    this.#time += dt;
    this.mesh.rotation.y += dt * 2.6;
    this.mesh.position.y = this.#base.y + Math.sin(this.#time * 3) * 0.12;
  }

  respawn(): void {
    this.collected = false;
    this.mesh.visible = true;
    this.area.monitoring = true;
  }

  debug(): Record<string, unknown> {
    return { collected: this.collected, position: this.mesh.position.toArray() };
  }

  dispose(): void {
    this.#unsubscribe();
    this.area.dispose();
    this.mesh.removeFromParent();
  }
}
