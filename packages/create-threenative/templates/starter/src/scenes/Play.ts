import { AudioBus, type Ctx, Scene } from "@threenative/core";
import { Area3D, CollisionShape3D, type PhysicsContext, RigidBody3D } from "@threenative/physics";
import { BoxGeometry, Mesh } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { Crate } from "../entities/Crate.js";
import { Player } from "../entities/Player.js";
import { setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import type { GameState } from "../state.js";

export type GameCtx = Ctx<GameState, PhysicsContext>;

export class Play extends Scene<GameState, PhysicsContext> {
  #floor: RigidBody3D | undefined;
  #crate: Crate | undefined;
  #player: Player | undefined;
  #pickup: Area3D | undefined;
  #audio: AudioBus | undefined;
  #pickupAudio: Promise<AudioBuffer> | undefined;
  #unsubscribe: (() => void) | undefined;

  enter(ctx: GameCtx): void {
    this.#audio = new AudioBus({ camera: ctx.camera });
    const pickupAudio = ctx.assets.audio("pickup.ogg");
    this.#pickupAudio = pickupAudio;
    void pickupAudio.catch(() => undefined);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer.raw as WebGPURenderer, ctx.scene, ctx.camera);
    ctx.camera.position.set(0, 3, 9);
    ctx.camera.lookAt(0, 1, 0);

    const materials = createMaterials();
    const levelX = ctx.random.range(-1, 1);
    const floorMesh = new Mesh(new BoxGeometry(10, 0.2, 4), materials.floor);
    floorMesh.position.y = -0.1;
    floorMesh.receiveShadow = true;
    ctx.add(floorMesh);
    this.#floor = new RigidBody3D({
      mesh: floorMesh,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(floorMesh),
      type: "fixed",
    });
    this.#crate = new Crate(ctx, levelX, 4, -1.5, materials.crate);
    this.#player = new Player(ctx, materials.player);
    ctx.state.set({ levelX });
    ctx.entities.add("player", this.#player);
    this.#pickup = new Area3D({
      physics: ctx.physics,
      position: { x: 1.5, y: 0.5, z: 0 },
      shape: CollisionShape3D.box(1, 1, 1),
    });
    this.#unsubscribe = this.#pickup.on("bodyEntered", (body) => {
      if (body !== this.#player?.body) return;
      ctx.state.set((state) => ({ score: state.score + 1 }));
      void this.#pickupAudio?.then((buffer) => this.#audio?.play(buffer)).catch(() => undefined);
    });
  }

  update(ctx: GameCtx, dt: number): void {
    this.#player?.update(ctx, dt);
    ctx.state.set({ playerX: this.#player?.mesh.position.x ?? -2 });
  }

  exit(ctx: GameCtx): void {
    this.#audio?.dispose();
    this.#unsubscribe?.();
    this.#pickup?.dispose();
    ctx.entities.remove("player");
    this.#player?.dispose();
    this.#crate?.dispose();
    this.#floor?.dispose();
    this.#unsubscribe = undefined;
    this.#pickup = undefined;
    this.#player = undefined;
    this.#crate = undefined;
    this.#floor = undefined;
    this.#audio = undefined;
    this.#pickupAudio = undefined;
  }
}
