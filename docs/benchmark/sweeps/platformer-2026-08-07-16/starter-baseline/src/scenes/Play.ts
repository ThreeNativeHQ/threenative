import { type Ctx, Scene } from "@threenative/core";
import { Area3D, CollisionShape3D, type PhysicsContext, RigidBody3D } from "@threenative/physics";
import { BoxGeometry, Mesh, MeshStandardMaterial } from "three";
import { Player } from "../entities/Player.js";
import { setupLighting } from "../render/lighting.js";
import { setupPost } from "../render/postprocessing.js";
import type { GameState } from "../state.js";

export type GameCtx = Ctx<GameState, PhysicsContext>;

export class Play extends Scene<GameState, PhysicsContext> {
  #floor: RigidBody3D | undefined;
  #player: Player | undefined;
  #pickup: Area3D | undefined;
  #unsubscribe: (() => void) | undefined;

  enter(ctx: GameCtx): void {
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer.raw as { toneMapping?: number; toneMappingExposure?: number });
    ctx.camera.position.set(0, 3, 9);
    ctx.camera.lookAt(0, 1, 0);
    const floor = new Mesh(
      new BoxGeometry(10, 0.2, 4),
      new MeshStandardMaterial({ color: 0x12384a, roughness: 0.78, metalness: 0.12 }),
    );
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    ctx.add(floor);
    this.#floor = new RigidBody3D({
      object: floor,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(floor),
      type: "fixed",
    });
    this.#player = new Player(ctx);
    ctx.entities.add("player", this.#player);
    this.#pickup = new Area3D({
      physics: ctx.physics,
      position: { x: 1.5, y: 0.5, z: 0 },
      shape: CollisionShape3D.box(1, 1, 1),
    });
    this.#unsubscribe = this.#pickup.on("bodyEntered", (body) => {
      if (body === this.#player?.body) ctx.state.set((state) => ({ score: state.score + 1 }));
    });
  }

  update(ctx: GameCtx, dt: number): void {
    this.#player?.update(ctx, dt);
    ctx.state.set({ playerX: this.#player?.mesh.position.x ?? -2 });
  }

  exit(ctx: GameCtx): void {
    this.#unsubscribe?.();
    this.#pickup?.dispose();
    ctx.entities.remove("player");
    this.#player?.dispose();
    this.#floor?.dispose();
    this.#unsubscribe = undefined;
    this.#pickup = undefined;
    this.#player = undefined;
    this.#floor = undefined;
  }
}
