import { type Ctx, Scene } from "@threenative/core";
import { CollisionShape3D, type PhysicsContext, RigidBody3D } from "@threenative/physics";
import {
  Group,
  Mesh,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import type { WebGPURenderer } from "three/webgpu";
import { Enemy } from "../entities/Enemy.js";
import { PatrolSensor } from "../entities/PatrolSensor.js";
import { Player } from "../entities/Player.js";
import { type SpringArm, createSpringArm } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { ball, block, spike, tube } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = Ctx<GameState, PhysicsContext>;

const ARENA = { minX: -8.2, maxX: 8.2, minZ: -5.2, maxZ: 5.2 } as const;
const FIRE_COOLDOWN = 0.28;
const RELOAD_TIME = 1.1;

type Bolt = {
  direction: Vector3;
  life: number;
  mesh: Group;
  target: Enemy;
};

type Pickup = {
  collected: boolean;
  mesh: Group;
  position: Vector3;
};

export class Play extends Scene<GameState, PhysicsContext> {
  #player: Player | undefined;
  #enemies: Enemy[] = [];
  #bodies: RigidBody3D[] = [];
  #arenaObjects: Group[] = [];
  #pickups: Pickup[] = [];
  #patrolSensor: PatrolSensor | undefined;
  #bolts: Bolt[] = [];
  #springArm: SpringArm | undefined;
  #time = 0;
  #cooldown = 0;
  #reloadTimer = 0;
  #ammo = 6;
  #score = 0;
  #health = 100;
  #won = false;
  #mission: { state: string; debug: () => Record<string, unknown> } | undefined;
  #raycaster = new Raycaster();
  #aimPoint = new Vector3();

  enter(ctx: GameCtx): void {
    setupSky(ctx.scene, { top: 0x16294e, bottom: 0x060d1e });
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer.raw as WebGPURenderer, ctx.scene, ctx.camera);
    this.#springArm = createSpringArm(ctx.camera as PerspectiveCamera, {
      damping: 0.12,
      lookAhead: new Vector3(0, 0, 0),
      offset: new Vector3(0, 11.5, 11.5),
    });

    const materials = createMaterials();
    this.#buildArena(ctx, materials);
    this.#player = new Player(ctx, materials.player, materials.playerDark);
    this.#enemies = [
      new Enemy(ctx, "enemy-1", -1.8, -2.7, materials.enemy, materials.enemyCore),
      new Enemy(ctx, "enemy-2", 2.5, 0.3, materials.enemy, materials.enemyCore),
      new Enemy(ctx, "enemy-3", 5.2, -3.1, materials.enemy, materials.enemyCore),
    ];
    this.#makePickups(ctx, materials.pickup);
    this.#patrolSensor = new PatrolSensor(ctx, materials.sensor, materials.sensorCore);
    this.#springArm.snap(this.#player.mesh.position);

    ctx.entities.add("player", this.#player);
    ctx.entities.add("patrol-sensor", this.#patrolSensor);
    this.#enemies.forEach((enemy) => ctx.entities.add(enemy.id, enemy));
    this.#mission = {
      state: "active",
      debug: () => ({
        enemiesRemaining: this.#enemies.filter((enemy) => enemy.alive).length,
        objective: this.#won ? "ARENA SECURE" : "CLEAR THE ARENA",
        state: this.#won ? "won" : "active",
      }),
    };
    ctx.entities.add("mission", this.#mission);
    this.#syncState(ctx);
  }

  update(ctx: GameCtx, dt: number): void {
    const player = this.#player;
    if (player === undefined) return;
    this.#time += dt;
    this.#cooldown = Math.max(0, this.#cooldown - dt);
    this.#reloadTimer = Math.max(0, this.#reloadTimer - dt);
    if (this.#reloadTimer === 0 && this.#ammo === 0) this.#ammo = 6;

    this.#aimPoint.copy(this.#getPointerWorld(ctx));
    player.update(ctx, dt, this.#aimPoint);
    this.#springArm?.follow(player.mesh.position, dt);
    this.#patrolSensor?.update(dt);
    this.#updatePickups(ctx);
    this.#updateBolts(ctx, dt);
    this.#enemies.forEach((enemy) => enemy.update(dt, this.#time));

    if (!this.#won && ctx.input.pressed("fire") && this.#cooldown === 0 && this.#reloadTimer === 0) {
      this.#fire(ctx);
    }
    this.#syncState(ctx);
  }

  exit(ctx: GameCtx): void {
    this.#bolts.forEach((bolt) => bolt.mesh.removeFromParent());
    this.#pickups.forEach((pickup) => pickup.mesh.removeFromParent());
    this.#enemies.forEach((enemy) => enemy.dispose());
    this.#arenaObjects.forEach((object) => object.removeFromParent());
    this.#bodies.forEach((body) => body.dispose());
    ctx.entities.remove("player");
    ctx.entities.remove("patrol-sensor");
    ctx.entities.remove("mission");
    this.#enemies.forEach((enemy) => ctx.entities.remove(enemy.id));
    this.#player?.dispose();
    this.#patrolSensor?.dispose();
    this.#mission = undefined;
    this.#player = undefined;
    this.#patrolSensor = undefined;
    this.#enemies = [];
    this.#bodies = [];
    this.#arenaObjects = [];
    this.#pickups = [];
    this.#bolts = [];
    this.#springArm = undefined;
  }

  #buildArena(ctx: GameCtx, materials: ReturnType<typeof createMaterials>): void {
    const floor = block(18, 0.22, 12, materials.floor, { radius: 0.18 });
    floor.position.y = -0.12;
    ctx.add(floor);
    this.#arenaObjects.push(floor as unknown as Group);
    this.#bodies.push(
      new RigidBody3D({
        object: floor,
        physics: ctx.physics,
        shape: CollisionShape3D.box(18, 0.22, 12),
        type: "fixed",
      }),
    );

    const walls = [
      { x: 0, z: -5.75, width: 18, depth: 0.5 },
      { x: 0, z: 5.75, width: 18, depth: 0.5 },
      { x: -8.75, z: 0, width: 0.5, depth: 12 },
      { x: 8.75, z: 0, width: 0.5, depth: 12 },
    ];
    walls.forEach(({ depth, width, x, z }, index) => {
      const wall = block(width, 0.9, depth, index % 2 === 0 ? materials.wall : materials.wallEdge, { radius: 0.12 });
      wall.position.set(x, 0.42, z);
      ctx.add(wall);
      this.#arenaObjects.push(wall as unknown as Group);
      this.#bodies.push(
        new RigidBody3D({
          object: wall,
          physics: ctx.physics,
          shape: CollisionShape3D.box(width, 0.9, depth),
          type: "fixed",
        }),
      );
    });

    const centralSpine = block(2.1, 0.22, 7.5, materials.floorLine, { radius: 0.1 });
    centralSpine.position.set(0, 0.03, 0.2);
    ctx.add(centralSpine);
    this.#arenaObjects.push(centralSpine as unknown as Group);
    [-6.2, -3.1, 3.1, 6.2].forEach((x) => {
      const stripe = block(0.08, 0.035, 8.6, materials.wallEdge, { radius: 0.02 });
      stripe.position.set(x, 0.04, 0);
      ctx.add(stripe);
      this.#arenaObjects.push(stripe as unknown as Group);
    });
    [-4.6, 4.6].forEach((z) => {
      const stripe = block(14, 0.035, 0.08, materials.wallEdge, { radius: 0.02 });
      stripe.position.set(0, 0.04, z);
      ctx.add(stripe);
      this.#arenaObjects.push(stripe as unknown as Group);
    });

    const beacons: ReadonlyArray<readonly [number, number]> = [
      [-7.5, -4.9],
      [7.5, -4.9],
      [-7.5, 4.9],
      [7.5, 4.9],
    ];
    beacons.forEach(([x, z]) => {
      const beacon = new Group();
      const base = tube(0.28, 0.34, 0.16, materials.wallEdge, { segments: 12 });
      const stem = tube(0.07, 0.07, 0.55, materials.player, { segments: 10 });
      stem.position.y = 0.32;
      const cap = ball(0.13, materials.player, { segments: 12 });
      cap.position.y = 0.64;
      beacon.add(base, stem, cap);
      beacon.position.set(x, 0.08, z);
      ctx.add(beacon);
      this.#arenaObjects.push(beacon);
    });
  }

  #makePickups(ctx: GameCtx, material: ReturnType<typeof createMaterials>["pickup"]): void {
    const pickupPositions: ReadonlyArray<readonly [number, number]> = [[-5.8, -1.3], [0.2, 4.1], [6.6, 2.8]];
    pickupPositions.forEach(([x, z], index) => {
      const mesh = new Group();
      const base = tube(0.28, 0.28, 0.1, material, { segments: 12 });
      const crystal = spike(0.2, 0.55, material, { segments: 6 });
      crystal.position.y = 0.3;
      const ring = tube(0.34, 0.34, 0.045, material, { segments: 12 });
      ring.position.y = 0.03;
      mesh.add(base, crystal, ring);
      mesh.position.set(x, 0.2, z);
      mesh.name = `pickup-${index + 1}`;
      ctx.add(mesh);
      this.#pickups.push({ collected: false, mesh, position: new Vector3(x, 0.2, z) });
    });
  }

  #getPointerWorld(ctx: GameCtx): Vector3 {
    const canvas = ctx.renderer.domElement;
    const width = canvas.clientWidth || canvas.width || 1280;
    const height = canvas.clientHeight || canvas.height || 720;
    const pointer = ctx.input.raw.pointer.position;
    const x = pointer.x <= 1 ? pointer.x * width : pointer.x;
    const y = pointer.y <= 1 ? pointer.y * height : pointer.y;
    this.#raycaster.setFromCamera(
      new Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1),
      ctx.camera,
    );
    const point = new Vector3();
    if (this.#raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -0.55), point)) return point;
    return this.#player?.mesh.position.clone().add(new Vector3(2, 0, 0)) ?? new Vector3(2, 0.55, 0);
  }

  #pickTarget(): Enemy | undefined {
    const player = this.#player;
    if (player === undefined) return undefined;
    const candidates = this.#enemies.filter((enemy) => enemy.alive);
    const aimed = candidates
      .map((enemy) => {
        const direction = enemy.mesh.position.clone().sub(player.mesh.position);
        direction.y = 0;
        direction.normalize();
        return { angle: player.aim.dot(direction), enemy };
      })
      .filter(({ angle }) => angle > 0.72)
      .sort((a, b) => b.angle - a.angle)[0];
    if (aimed !== undefined) return aimed.enemy;
    return candidates.sort(
      (a, b) => a.mesh.position.distanceToSquared(player.mesh.position) - b.mesh.position.distanceToSquared(player.mesh.position),
    )[0];
  }

  #fire(ctx: GameCtx): void {
    const player = this.#player;
    const target = this.#pickTarget();
    if (player === undefined || target === undefined) return;
    this.#cooldown = FIRE_COOLDOWN;
    this.#ammo -= 1;
    if (this.#ammo === 0) this.#reloadTimer = RELOAD_TIME;
    const direction = target.mesh.position.clone().sub(player.muzzle);
    direction.y = 0;
    direction.normalize();
    const mesh = new Group();
    const core = ball(0.13, createMaterials().bolt, { segments: 12 });
    const tail = tube(0.045, 0.08, 0.46, createMaterials().bolt, { segments: 10 });
    tail.position.y = 0.02;
    tail.rotation.x = Math.PI / 2;
    mesh.add(core, tail);
    mesh.position.copy(player.muzzle);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, -1), direction);
    ctx.add(mesh);
    this.#bolts.push({ direction, life: 1.2, mesh, target });
    ctx.state.set((state) => ({ shots: state.shots + 1 }));
  }

  #updateBolts(ctx: GameCtx, dt: number): void {
    const remaining: Bolt[] = [];
    this.#bolts.forEach((bolt) => {
      bolt.life -= dt;
      bolt.mesh.position.addScaledVector(bolt.direction, dt * 15);
      if (bolt.target.alive && bolt.mesh.position.distanceTo(bolt.target.mesh.position) < 0.72) {
        bolt.target.hit();
        this.#score += 1;
        if (this.#score >= this.#enemies.length) this.#won = true;
        bolt.mesh.removeFromParent();
        return;
      }
      if (bolt.life <= 0) {
        bolt.mesh.removeFromParent();
        return;
      }
      remaining.push(bolt);
    });
    this.#bolts = remaining;
    void ctx;
  }

  #updatePickups(ctx: GameCtx): void {
    const player = this.#player;
    if (player === undefined) return;
    this.#pickups.forEach((pickup) => {
      if (pickup.collected) return;
      pickup.mesh.rotation.y += 0.035;
      pickup.mesh.position.y = 0.24 + Math.sin(this.#time * 2.8 + pickup.position.x) * 0.08;
      if (pickup.mesh.position.distanceTo(player.mesh.position) < 0.85) {
        pickup.collected = true;
        pickup.mesh.visible = false;
        this.#health = Math.min(100, this.#health + 20);
        ctx.state.set((state) => ({ pickups: state.pickups + 1 }));
      }
    });
  }

  #syncState(ctx: GameCtx): void {
    const player = this.#player;
    if (this.#mission !== undefined) this.#mission.state = this.#won ? "won" : "active";
    ctx.state.set({
      ammo: this.#ammo,
      cooldown: Math.max(this.#cooldown, this.#reloadTimer),
      enemiesRemaining: this.#enemies.filter((enemy) => enemy.alive).length,
      health: this.#health,
      objective: this.#won ? "ARENA SECURE" : "CLEAR THE ARENA",
      playerX: player?.mesh.position.x ?? -5,
      playerZ: player?.mesh.position.z ?? 3.4,
      score: this.#score,
      sensorTravel: this.#patrolSensor?.distanceTravelled ?? 0,
      sensorX: this.#patrolSensor?.mesh.position.x ?? -5.8,
      won: this.#won,
    });
  }
}
