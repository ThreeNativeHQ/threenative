import { type Ctx, Scene } from "@threenative/core";
import {
  Area3D,
  CharacterBody3D,
  CollisionShape3D,
  type PhysicsContext,
  RigidBody3D,
} from "@threenative/physics";
import { Group, Mesh, type PerspectiveCamera, Vector3 } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { Player } from "../entities/Player.js";
import { type SpringArm, createSpringArm } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { ball, block, roundedBox, tube } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = Ctx<GameState, PhysicsContext>;

type Enemy = { readonly mesh: Mesh; readonly position: Vector3; alive: boolean };

const ENEMY_POSITIONS = [
  { x: -2, z: 2.5 },
  { x: 2, z: 2.5 },
  { x: 0, z: 0.3 },
] as const;
const ATTACK_RANGE = 3.4;
const RELOAD_SECONDS = 0.3;

export class Play extends Scene<GameState, PhysicsContext> {
  #floor: RigidBody3D | undefined;
  #player: Player | undefined;
  #goal: Area3D | undefined;
  #unsubscribe: (() => void) | undefined;
  #springArm: SpringArm | undefined;
  #enemies: Enemy[] = [];
  #reload = 0;
  #shots = 0;
  #hits = 0;
  #remaining: number = ENEMY_POSITIONS.length;
  #won = false;

  enter(ctx: GameCtx): void {
    setupSky(ctx.scene, { top: 0x192a46, bottom: 0x07121f });
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer.raw as WebGPURenderer, ctx.scene, ctx.camera);

    const materials = createMaterials();
    const springArm = createSpringArm(ctx.camera as PerspectiveCamera, {
      damping: 0.2,
      lookAhead: new Vector3(0, 0, -1),
      offset: new Vector3(0, 7, 8),
    });
    this.#springArm = springArm;

    const floorMesh = new Mesh(roundedBox(12, 0.2, 12, 0.08), materials.floor);
    floorMesh.position.y = -0.1;
    floorMesh.receiveShadow = true;
    ctx.add(floorMesh);
    this.#floor = new RigidBody3D({
      mesh: floorMesh,
      physics: ctx.physics,
      shape: CollisionShape3D.box(12, 0.2, 12),
      type: "fixed",
    });
    const arena = new Group();
    for (const [x, z] of [
      [-5, -2],
      [5, 0],
      [-4, 4],
      [4, 4],
    ] as const) {
      const pillar = block(0.7, 1.3, 0.7, materials.wall);
      pillar.position.set(x, 0.65, z);
      arena.add(pillar);
    }
    ctx.add(arena);

    for (const position of ENEMY_POSITIONS) {
      const mesh = block(0.8, 0.8, 0.8, materials.enemy);
      mesh.position.set(position.x, 0.5, position.z);
      ctx.add(mesh);
      this.#enemies.push({ alive: true, mesh, position: new Vector3(position.x, 0.5, position.z) });
    }

    const exit = block(3.2, 0.12, 0.7, materials.goal);
    exit.position.set(0, 0.06, -3);
    ctx.add(exit);
    const beacon = tube(0.08, 0.08, 0.8, materials.goal);
    beacon.position.set(0, 0.5, -3);
    ctx.add(beacon);
    const beaconLight = ball(0.2, materials.goal);
    beaconLight.position.set(0, 1, -3);
    ctx.add(beaconLight);

    this.#player = new Player(ctx, materials.player);
    ctx.entities.add("player", this.#player);
    this.#springArm.snap(this.#player.mesh.position);

    this.#goal = new Area3D({
      entity: "goal",
      physics: ctx.physics,
      position: { x: 0, y: 0.6, z: -3 },
      shape: CollisionShape3D.box(3.4, 1.2, 0.9),
    });
    this.#unsubscribe = this.#goal.on("bodyEntered", (body) => {
      if (body !== this.#player?.body || this.#remaining !== 0) return;
      this.#won = true;
      ctx.state.set({ objective: "Arena cleared", won: true });
    });
    ctx.state.set({ enemiesRemaining: this.#remaining, objective: "Clear the arena", won: false });
  }

  update(ctx: GameCtx, dt: number): void {
    const player = this.#player;
    if (player === undefined) return;
    this.#reload = Math.max(0, this.#reload - dt);
    player.update(ctx, dt);

    if (ctx.input.justPressed("attack") && this.#reload === 0) this.#attack(ctx);
    for (const enemy of this.#enemies) {
      if (enemy.alive) enemy.mesh.rotation.y += dt * 1.4;
    }
    this.#springArm?.follow(player.mesh.position, dt);
    ctx.state.set({
      playerX: player.mesh.position.x,
      playerZ: player.mesh.position.z,
      reload: this.#reload,
    });
  }

  #attack(ctx: GameCtx): void {
    const player = this.#player;
    if (player === undefined) return;
    this.#reload = RELOAD_SECONDS;
    this.#shots += 1;
    const target = this.#enemies
      .filter((enemy) => enemy.alive)
      .sort(
        (left, right) =>
          left.position.distanceToSquared(player.mesh.position) -
          right.position.distanceToSquared(player.mesh.position),
      )
      .find((enemy) => enemy.position.distanceTo(player.mesh.position) <= ATTACK_RANGE);
    if (target === undefined) {
      ctx.state.set({ reload: this.#reload, shots: this.#shots });
      return;
    }
    target.alive = false;
    target.mesh.removeFromParent();
    this.#hits += 1;
    this.#remaining -= 1;
    ctx.state.set({
      enemiesRemaining: this.#remaining,
      hits: this.#hits,
      objective: this.#remaining === 0 ? "Reach the exit" : "Clear the arena",
      reload: this.#reload,
      score: this.#hits * 100,
      shots: this.#shots,
    });
  }

  exit(ctx: GameCtx): void {
    this.#unsubscribe?.();
    this.#goal?.dispose();
    ctx.entities.remove("player");
    this.#player?.dispose();
    this.#floor?.dispose();
    for (const enemy of this.#enemies) enemy.mesh.removeFromParent();
    this.#unsubscribe = undefined;
    this.#goal = undefined;
    this.#player = undefined;
    this.#floor = undefined;
    this.#springArm = undefined;
    this.#enemies = [];
    this.#reload = 0;
    this.#shots = 0;
    this.#hits = 0;
    this.#remaining = ENEMY_POSITIONS.length;
    this.#won = false;
  }
}
