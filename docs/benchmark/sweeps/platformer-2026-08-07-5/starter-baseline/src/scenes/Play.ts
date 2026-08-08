import { AudioBus, type Ctx, Scene } from "@threenative/core";
import { Area3D, CollisionShape3D, type PhysicsContext, RigidBody3D } from "@threenative/physics";
import { Group, Mesh, type PerspectiveCamera } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { Crate } from "../entities/Crate.js";
import { Player } from "../entities/Player.js";
import { type SpringArm, createSpringArm } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { ball, block, makeRandom, roundedBox, spike, tube } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = Ctx<GameState, PhysicsContext>;

const KILL_PLANE = -4;

export class Play extends Scene<GameState, PhysicsContext> {
  #floor: RigidBody3D | undefined;
  #crate: Crate | undefined;
  #player: Player | undefined;
  #pickup: Area3D | undefined;
  #audio: AudioBus | undefined;
  #pickupAudio: Promise<AudioBuffer> | undefined;
  #pickupVisual: Group | undefined;
  #springArm: SpringArm | undefined;
  #unsubscribe: (() => void) | undefined;

  enter(ctx: GameCtx): void {
    this.#audio = new AudioBus({ camera: ctx.camera });
    const pickupAudio = ctx.assets.audio("pickup.ogg");
    this.#pickupAudio = pickupAudio;
    void pickupAudio.catch(() => undefined);
    setupSky(ctx.scene, { top: 0x83d8f2, bottom: 0x18334d });
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer.raw as WebGPURenderer, ctx.scene, ctx.camera);
    const springArm = createSpringArm(ctx.camera as PerspectiveCamera);
    this.#springArm = springArm;

    const materials = createMaterials();
    const levelX = ctx.random.range(-1, 1);
    const pickupX = 1.2 + makeRandom(Math.round((levelX + 1) * 1000))() * 0.8;
    const floorMesh = new Mesh(roundedBox(10, 0.2, 4, 0.08), materials.floor);
    floorMesh.position.y = -0.1;
    floorMesh.receiveShadow = true;
    ctx.add(floorMesh);
    this.#floor = new RigidBody3D({
      object: floorMesh,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(floorMesh),
      type: "fixed",
    });
    this.#crate = new Crate(ctx, levelX, 4, -1.5, materials.crate);
    this.#player = new Player(ctx, materials.player);
    const pickupBase = block(0.42, 0.14, 0.42, materials.player);
    const pickupStem = tube(0.08, 0.08, 0.3, materials.player);
    const pickupOrb = ball(0.16, materials.player);
    const pickupTip = spike(0.14, 0.26, materials.player);
    pickupBase.position.y = -0.16;
    pickupStem.position.y = 0.06;
    pickupOrb.position.y = 0.32;
    pickupTip.position.y = 0.53;
    this.#pickupVisual = new Group();
    this.#pickupVisual.add(pickupBase, pickupStem, pickupOrb, pickupTip);
    this.#pickupVisual.position.set(pickupX, 0.5, 0);
    this.#pickupVisual.castShadow = true;
    ctx.add(this.#pickupVisual);
    springArm.snap(this.#player.mesh.position);
    ctx.state.set({ levelX });
    ctx.entities.add("player", this.#player);
    this.#pickup = new Area3D({
      physics: ctx.physics,
      position: { x: pickupX, y: 0.5, z: 0 },
      shape: CollisionShape3D.box(1, 1, 1),
    });
    this.#unsubscribe = this.#pickup.on("bodyEntered", (body) => {
      if (body !== this.#player?.body) return;
      ctx.state.set((state) => ({ score: state.score + 1 }));
      void this.#pickupAudio?.then((buffer) => this.#audio?.play(buffer)).catch(() => undefined);
    });
  }

  update(ctx: GameCtx, dt: number): void {
    const player = this.#player;
    if (player === undefined) return;
    player.update(ctx, dt);
    let respawned = false;
    if (player.mesh.position.y < KILL_PLANE) {
      player.respawn();
      this.#springArm?.snap(player.mesh.position);
      respawned = true;
    }
    this.#springArm?.follow(player.mesh.position, dt);
    const debug = player.debug();
    const previous = ctx.state.getState();
    ctx.state.set({
      coyoteJumps: debug.coyoteJumps,
      jumps: debug.jumps,
      peakRise: Math.max(previous.peakRise, player.mesh.position.y - 0.5),
      playerX: player.mesh.position.x,
      respawns: previous.respawns + (respawned ? 1 : 0),
    });
  }

  exit(ctx: GameCtx): void {
    this.#audio?.dispose();
    this.#unsubscribe?.();
    this.#pickup?.dispose();
    ctx.entities.remove("player");
    this.#player?.dispose();
    this.#pickupVisual?.removeFromParent();
    this.#crate?.dispose();
    this.#floor?.dispose();
    this.#unsubscribe = undefined;
    this.#pickup = undefined;
    this.#player = undefined;
    this.#pickupVisual = undefined;
    this.#crate = undefined;
    this.#floor = undefined;
    this.#springArm = undefined;
    this.#audio = undefined;
    this.#pickupAudio = undefined;
  }
}
