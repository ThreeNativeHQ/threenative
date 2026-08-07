import { AudioBus, type Ctx, Scene } from "@threenative/core";
import { Area3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import { Group, type PerspectiveCamera, Vector3 } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { Player } from "../entities/Player.js";
import { createLevel, type Level } from "../level.js";
import { type SpringArm, createSpringArm } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { ball, ring, tube } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = Ctx<GameState, PhysicsContext>;

const KILL_PLANE = -5.5;

interface Coin {
  readonly area: Area3D;
  readonly base: Vector3;
  readonly mesh: Group;
  readonly phase: number;
  active: boolean;
  unsubscribe?: () => void;
}

const COIN_ROUTE: readonly [number, number, number][] = [
  [0, 1.5, 1.55],
  [0.2, 1.48, 0.7],
  [-0.25, 1.48, -0.72],
  [0, 1.62, -3.55],
  [-1, 1.83, -5.15],
  [0.58, 1.84, -6.35],
  [-1.42, 2.7, -8.25],
  [-0.45, 2.7, -9.7],
  [1.35, 3.5, -11.9],
  [2.18, 3.55, -13.25],
  [0.75, 3.56, -14.35],
  [0, 4.3, -16.45],
];

export class Play extends Scene<GameState, PhysicsContext> {
  #audio: AudioBus | undefined;
  #pickupAudio: Promise<AudioBuffer> | undefined;
  #level: Level | undefined;
  #player: Player | undefined;
  #springArm: SpringArm | undefined;
  #coins: Coin[] = [];
  #hazardArea: Area3D | undefined;
  #goalArea: Area3D | undefined;
  #hazardUnsubscribe: (() => void) | undefined;
  #goalUnsubscribe: (() => void) | undefined;
  #hazardTime = 0;
  #restartHeld = false;

  enter(ctx: GameCtx): void {
    this.#audio = new AudioBus({ camera: ctx.camera });
    this.#pickupAudio = ctx.assets.audio("pickup.ogg");
    void this.#pickupAudio.catch(() => undefined);

    setupSky(ctx.scene, { top: 0x087fe1, bottom: 0x38bfe9 });
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer.raw as WebGPURenderer, ctx.scene, ctx.camera);
    const camera = ctx.camera as PerspectiveCamera;
    camera.fov = 52;
    camera.near = 0.1;
    camera.far = 120;
    camera.updateProjectionMatrix();

    const materials = createMaterials();
    const level = createLevel(ctx, materials);
    this.#level = level;
    this.#player = new Player(ctx, materials, level.spawn);
    this.#springArm = createSpringArm(camera, {
      damping: 0.14,
      lookAhead: new Vector3(0, 1.18, -2.2),
      offset: new Vector3(0, 5.35, 9.6),
    });
    this.#springArm.snap(this.#player.mesh.position);

    this.#createCoins(ctx, materials);
    this.#hazardArea = new Area3D({
      physics: ctx.physics,
      position: level.hazardPosition,
      shape: CollisionShape3D.box(1.2, 1.22, 1.15),
    });
    this.#hazardUnsubscribe = this.#hazardArea.on("bodyEntered", (body) => {
      if (body !== this.#player?.body) return;
      this.#respawn(ctx);
    });

    this.#goalArea = new Area3D({
      physics: ctx.physics,
      position: level.goalPosition,
      shape: CollisionShape3D.box(2.1, 2.2, 1.4),
    });
    this.#goalUnsubscribe = this.#goalArea.on("bodyEntered", (body) => {
      if (body !== this.#player?.body) return;
      ctx.state.set({ goalReached: true });
    });

    ctx.entities.add("player", this.#player);
    ctx.state.set({
      coins: 0,
      goalReached: false,
      levelX: 0,
      score: 0,
      totalCoins: this.#coins.length,
    });
  }

  #createCoins(ctx: GameCtx, materials: ReturnType<typeof createMaterials>): void {
    for (let index = 0; index < COIN_ROUTE.length; index += 1) {
      const position = COIN_ROUTE[index];
      if (position === undefined) continue;
      const [x, y, z] = position;
      const mesh = new Group();
      mesh.name = `sun-coin-${index + 1}`;
      const disc = tube(0.25, 0.25, 0.1, materials.coin, { segments: 20 });
      disc.rotation.x = Math.PI / 2;
      const face = tube(0.17, 0.17, 0.11, materials.coinBright, {
        castShadow: false,
        receiveShadow: false,
        segments: 20,
      });
      face.rotation.x = Math.PI / 2;
      face.position.z = -0.015;
      const center = ring(0.105, 0.022, materials.goal, {
        castShadow: false,
        receiveShadow: false,
        segments: 16,
      });
      center.rotation.x = Math.PI / 2;
      center.position.z = -0.08;
      mesh.add(disc, face, center);
      mesh.position.set(x, y, z);
      ctx.add(mesh);

      const area = new Area3D({
        physics: ctx.physics,
        position: { x, y, z },
        shape: CollisionShape3D.sphere(0.55),
      });
      const coin: Coin = {
        active: true,
        area,
        base: new Vector3(x, y, z),
        mesh,
        phase: index * 0.55,
      };
      coin.unsubscribe = area.on("bodyEntered", (body) => {
        if (body !== this.#player?.body || !coin.active) return;
        coin.active = false;
        coin.mesh.visible = false;
        ctx.state.set((state) => ({ coins: state.coins + 1, score: state.score + 1 }));
        void this.#pickupAudio
          ?.then((buffer) => this.#audio?.play(buffer, { volume: 0.55 }))
          .catch(() => undefined);
      });
      this.#coins.push(coin);
    }
  }

  #respawn(ctx: GameCtx): void {
    const player = this.#player;
    if (player === undefined) return;
    player.respawn();
    this.#springArm?.snap(player.mesh.position);
    ctx.state.set((state) => ({ respawns: state.respawns + 1 }));
  }

  #restart(ctx: GameCtx): void {
    const player = this.#player;
    if (player === undefined) return;
    player.respawn();
    this.#springArm?.snap(player.mesh.position);
    for (const coin of this.#coins) {
      coin.active = true;
      coin.mesh.visible = true;
      coin.mesh.position.copy(coin.base);
      coin.area.setPosition(coin.base);
    }
    ctx.state.set({ coins: 0, goalReached: false, respawns: 0, score: 0 });
  }

  update(ctx: GameCtx, dt: number): void {
    const player = this.#player;
    const level = this.#level;
    if (player === undefined || level === undefined) return;
    if (ctx.input.justPressed("restart")) this.#restart(ctx);
    player.update(ctx, dt);
    if (player.mesh.position.y < KILL_PLANE) this.#respawn(ctx);

    this.#hazardTime += dt;
    level.hazard.position.y = level.hazardPosition.y - 0.48 + Math.sin(this.#hazardTime * 3.2) * 0.045;
    level.hazard.rotation.y += dt * 0.7;
    this.#hazardArea?.setPosition({
      x: level.hazardPosition.x,
      y: level.hazardPosition.y + Math.sin(this.#hazardTime * 3.2) * 0.045,
      z: level.hazardPosition.z,
    });
    level.goal.rotation.y = Math.sin(this.#hazardTime * 1.6) * 0.08;
    for (const coin of this.#coins) {
      if (!coin.active) continue;
      coin.mesh.position.y = coin.base.y + Math.sin(this.#hazardTime * 3 + coin.phase) * 0.1;
      coin.mesh.rotation.y += dt * 2.6;
      coin.mesh.rotation.z = Math.sin(this.#hazardTime * 2 + coin.phase) * 0.08;
      coin.area.setPosition(coin.mesh.position);
    }

    this.#springArm?.follow(player.mesh.position, dt);
    const debug = player.debug();
    const previous = ctx.state.getState();
    ctx.state.set({
      coyoteJumps: debug.coyoteJumps,
      jumps: debug.jumps,
      peakRise: Math.max(previous.peakRise, player.mesh.position.y - level.spawn.y),
      playerX: player.mesh.position.x,
    });
  }

  exit(ctx: GameCtx): void {
    this.#audio?.dispose();
    for (const coin of this.#coins) {
      coin.unsubscribe?.();
      coin.area.dispose();
      coin.mesh.removeFromParent();
    }
    this.#hazardUnsubscribe?.();
    this.#goalUnsubscribe?.();
    this.#hazardArea?.dispose();
    this.#goalArea?.dispose();
    ctx.entities.remove("player");
    this.#player?.dispose();
    this.#level?.dispose();
    this.#coins = [];
    this.#audio = undefined;
    this.#pickupAudio = undefined;
    this.#level = undefined;
    this.#player = undefined;
    this.#springArm = undefined;
    this.#hazardArea = undefined;
    this.#goalArea = undefined;
    this.#hazardUnsubscribe = undefined;
    this.#goalUnsubscribe = undefined;
  }
}
