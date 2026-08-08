import { AudioBus, type Ctx, Scene, type SceneFrame } from "@threenative/core";
import { CollisionShape3D, type PhysicsContext, RigidBody3D } from "@threenative/physics";
import {
  Group,
  Mesh,
  PerspectiveCamera,
  Plane,
  Raycaster,
  RingGeometry,
  Vector2,
  Vector3,
} from "three";
import { EnemyTarget } from "../entities/Enemy.js";
import { Mission } from "../entities/Mission.js";
import { Player } from "../entities/Player.js";
import { Projectile } from "../entities/Projectile.js";
import { createSpringArm } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { block, ball, roundedBox, spike, tube } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = Ctx<GameState, PhysicsContext>;

const KILL_PLANE = -4;
const FIRE_COOLDOWN = 0.24;
const MAX_HEALTH = 100;
const ARENA_LIMIT_X = 7.45;
const ARENA_LIMIT_Z = 4.45;

type Materials = ReturnType<typeof createMaterials>;

type Pickup = {
  readonly baseY: number;
  readonly group: Group;
  readonly position: Vector3;
  collected: boolean;
};

export class Play extends Scene<GameState, PhysicsContext> {
  static override readonly initialState: GameState = {
    coyoteJumps: 0,
    cooldown: 0,
    enemiesRemaining: 3,
    gameStatus: "active",
    health: MAX_HEALTH,
    maxHealth: MAX_HEALTH,
    jumps: 0,
    levelX: 0,
    objective: "Disable 3 sentry targets / collect relay cells",
    peakRise: 0,
    playerX: 0,
    respawns: 0,
    reload: 0,
    score: 0,
    shots: 0,
    targetsRemaining: 3,
    collected: 0,
  };

  #cleanupInput: (() => void) | undefined;

  override enter(ctx: GameCtx): SceneFrame<GameState, PhysicsContext> {
    this.#cleanupInput?.();

    const audio = ctx.entities.add("audio", new AudioBus({ camera: ctx.camera }));
    const pickupAudio = ctx.assets.audio("pickup.ogg");
    void pickupAudio.catch(() => undefined);

    setupSky(ctx.scene);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer, ctx.scene, ctx.camera);

    const camera = ctx.camera as PerspectiveCamera;
    camera.fov = 56;
    camera.near = 0.1;
    camera.far = 120;
    camera.updateProjectionMatrix();
    const springArm = createSpringArm(camera, {
      damping: 0.24,
      lookAhead: new Vector3(0, 0.1, -1.5),
      offset: new Vector3(0, 11.5, 12.5),
    });

    const materials = createMaterials();
    buildArena(ctx, materials);
    const levelX = ctx.random.range(-1, 1);
    ctx.state.set({ levelX });

    const player = new Player(ctx, {
      body: materials.player,
      detail: materials.playerDetail,
      shot: materials.shot,
    });
    ctx.entities.add("player", player);
    const mission = new Mission();
    ctx.entities.add("mission", mission);

    const enemies = [
      new EnemyTarget(ctx, { x: -4.2, z: -1.6 }, {
        body: materials.enemy,
        detail: materials.enemyDetail,
        health: materials.health,
      }, 0.4),
      new EnemyTarget(ctx, { x: 4.15, z: -1.45 }, {
        body: materials.enemy,
        detail: materials.enemyDetail,
        health: materials.health,
      }, 2.1),
      new EnemyTarget(ctx, { x: 4.35, z: 2.15 }, {
        body: materials.enemy,
        detail: materials.enemyDetail,
        health: materials.health,
      }, 4.2),
    ];
    enemies.forEach((enemy, index) => ctx.entities.add(`target-${index + 1}`, enemy));

    const pickups = [
      createPickup(ctx, new Vector3(-4.6, 0.08, 1.7), materials, 0.6),
      createPickup(ctx, new Vector3(3.35, 0.08, 0.65), materials, 2.4),
      createPickup(ctx, new Vector3(-1.85, 0.08, -3.15), materials, 4.1),
    ];

    const reticle = new Mesh(new RingGeometry(0.18, 0.24, 18), materials.reticle);
    reticle.rotation.x = -Math.PI / 2;
    reticle.position.y = 0.03;
    ctx.add(reticle);

    const raycaster = new Raycaster();
    const pointer = new Vector2(0, 0);
    const aimPlane = new Plane(new Vector3(0, 1, 0), -0.04);
    const aimPoint = new Vector3(0, 0.04, -1);
    const aimDirection = new Vector3(0, 0, -1);
    const shotOrigin = new Vector3();
    let pointerDown = false;
    let keyboardFire = false;
    let fireQueued = false;

    const updateAim = (event: PointerEvent): void => {
      pointer.set(
        (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1,
        -(event.clientY / Math.max(1, window.innerHeight)) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.ray.intersectPlane(aimPlane, aimPoint);
      if (hit === null) return;
      const clampedX = Math.max(-ARENA_LIMIT_X, Math.min(ARENA_LIMIT_X, aimPoint.x));
      const clampedZ = Math.max(-ARENA_LIMIT_Z, Math.min(ARENA_LIMIT_Z, aimPoint.z));
      aimPoint.set(clampedX, 0.04, clampedZ);
      aimDirection.copy(aimPoint).sub(player.mesh.position).setY(0);
      if (aimDirection.lengthSq() > 0.01) player.setAim(aimDirection);
      reticle.position.copy(aimPoint);
    };
    const handlePointerMove = (event: PointerEvent): void => updateAim(event);
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || event.target instanceof HTMLButtonElement) return;
      pointerDown = true;
      fireQueued = true;
      updateAim(event);
    };
    const handlePointerUp = (event: PointerEvent): void => {
      if (event.button === 0) pointerDown = false;
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== "KeyF" && event.code !== "Enter" && event.code !== "Space") return;
      event.preventDefault();
      keyboardFire = true;
      fireQueued = true;
    };
    const handleKeyUp = (event: KeyboardEvent): void => {
      if (event.code === "KeyF" || event.code === "Enter" || event.code === "Space") keyboardFire = false;
    };
    const handleBlur = (): void => {
      pointerDown = false;
      keyboardFire = false;
    };
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    this.#cleanupInput = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };

    player.setAim(aimDirection);
    springArm.snap(player.mesh.position);

    const initial = ctx.state.getState();
    let cooldown = 0;
    let elapsed = 0;
    let health = initial.health;
    let score = initial.score;
    let shots = initial.shots;
    let collected = initial.collected;
    let gameStatus: GameState["gameStatus"] = "active";
    let damageTimer = 0;
    const projectiles: Projectile[] = [];
    const lockedTargets = new Set<EnemyTarget>();

    return (frameCtx, dt) => {
      elapsed += dt;
      cooldown = Math.max(0, cooldown - dt);
      damageTimer = Math.max(0, damageTimer - dt);

      player.update(frameCtx, dt);
      if (player.mesh.position.y < KILL_PLANE) {
        player.respawn();
        springArm.snap(player.mesh.position);
      }
      springArm.follow(player.mesh.position, dt);

      for (const enemy of enemies) enemy.update(dt, elapsed);
      for (const pickup of pickups) {
        if (pickup.collected) continue;
        pickup.group.rotation.y += dt * 1.8;
        pickup.group.position.y = pickup.baseY + Math.sin(elapsed * 2.7 + pickup.baseY * 10) * 0.09;
        const dx = pickup.position.x - player.mesh.position.x;
        const dz = pickup.position.z - player.mesh.position.z;
        if (dx * dx + dz * dz > 0.72 * 0.72) continue;
        pickup.collected = true;
        pickup.group.visible = false;
        collected += 1;
        score += 25;
        void pickupAudio.then((buffer) => audio.play(buffer)).catch(() => undefined);
      }

      const shouldFire =
        fireQueued ||
        pointerDown ||
        keyboardFire ||
        frameCtx.input.justPressed("fire");
      if (shouldFire && cooldown <= 0 && gameStatus === "active") {
        shotOrigin.copy(player.muzzlePosition());
        const projectile = new Projectile(frameCtx, shotOrigin, player.aimDirection, {
          body: materials.shot,
          trail: materials.shotTrail,
        });
        if (projectile.target === undefined) {
          const target = resolveNearestActiveTarget(enemies, shotOrigin, lockedTargets);
          if (target !== undefined) {
            projectile.setTarget(target);
            lockedTargets.add(target);
          }
        }
        projectiles.push(projectile);
        player.triggerFire();
        shots += 1;
        cooldown = FIRE_COOLDOWN;
        fireQueued = false;
      } else if (!pointerDown && !keyboardFire) {
        fireQueued = false;
      }

      for (let index = projectiles.length - 1; index >= 0; index -= 1) {
        const projectile = projectiles[index];
        if (projectile === undefined) continue;
        let hit = false;
        const stillAlive = projectile.update(dt);
        const target = projectile.target;
        if (target !== undefined) {
          if (target.active && flatDistanceSquared(projectile.mesh.position, target.position) <= 0.7 * 0.7) {
            hit = true;
            if (target.hit(target.health)) score += 100;
          } else if (!target.active) {
            hit = true;
          }
        } else {
          for (const enemy of enemies) {
            if (!enemy.active || flatDistanceSquared(projectile.mesh.position, enemy.position) > 0.7 * 0.7) continue;
            hit = true;
            if (enemy.hit(enemy.health)) score += 100;
            break;
          }
        }
        if (!stillAlive || hit) {
          if (target !== undefined) lockedTargets.delete(target as EnemyTarget);
          projectile.dispose();
          projectiles.splice(index, 1);
        }
      }

      const targetsRemaining = enemies.filter((enemy) => enemy.active).length;
      mission.update(targetsRemaining);
      if (mission.state === "won") gameStatus = "clear";
      if (gameStatus === "clear") cooldown = Math.max(cooldown, FIRE_COOLDOWN * 0.1);

      if (damageTimer <= 0) {
        const touchingEnemy = enemies.some(
          (enemy) => enemy.active && enemy.position.distanceTo(player.mesh.position) < 0.95,
        );
        if (touchingEnemy) {
          health = Math.max(0, health - 10);
          damageTimer = 0.5;
        }
      }
      if (health <= 0) {
        health = MAX_HEALTH;
        player.respawn();
        springArm.snap(player.mesh.position);
        frameCtx.state.set((state) => ({ respawns: state.respawns + 1 }));
      }

      const debug = player.debug();
      const previous = frameCtx.state.getState();
      frameCtx.state.set({
        cooldown: cooldown / FIRE_COOLDOWN,
        enemiesRemaining: targetsRemaining,
        gameStatus,
        health,
        maxHealth: MAX_HEALTH,
        objective:
          gameStatus === "clear"
            ? "SECURE / all sentry targets disabled"
            : `Disable ${targetsRemaining} sentry targets / collect relay cells`,
        peakRise: Math.max(previous.peakRise, (debug.position[1] ?? 0) - 0.5),
        playerX: debug.position[0] ?? 0,
        reload: cooldown / FIRE_COOLDOWN,
        score,
        shots,
        targetsRemaining,
        collected,
      });
    };
  }

  override exit(): void {
    this.#cleanupInput?.();
    this.#cleanupInput = undefined;
  }
}

function resolveNearestActiveTarget(
  enemies: readonly EnemyTarget[],
  origin: Vector3,
  lockedTargets: ReadonlySet<EnemyTarget>,
): EnemyTarget | undefined {
  const available = enemies.filter((enemy) => enemy.active && !lockedTargets.has(enemy));
  const candidates = available.length > 0 ? available : enemies.filter((enemy) => enemy.active);
  let nearest: EnemyTarget | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const enemy of candidates) {
    const distance = flatDistanceSquared(origin, enemy.position);
    if (distance >= nearestDistance) continue;
    nearest = enemy;
    nearestDistance = distance;
  }
  return nearest;
}

function flatDistanceSquared(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function addStaticBlock(
  ctx: GameCtx,
  dimensions: { readonly width: number; readonly height: number; readonly depth: number },
  position: { readonly x: number; readonly y: number; readonly z: number },
  material: Parameters<typeof block>[3],
  radius = 0.12,
): Mesh {
  const mesh = block(dimensions.width, dimensions.height, dimensions.depth, material, { radius });
  mesh.position.set(position.x, position.y, position.z);
  ctx.add(mesh);
  new RigidBody3D({
    object: mesh,
    physics: ctx.physics,
    shape: CollisionShape3D.fromMesh(mesh),
    type: "fixed",
  });
  return mesh;
}

function addVisualBlock(
  ctx: GameCtx,
  dimensions: { readonly width: number; readonly height: number; readonly depth: number },
  position: { readonly x: number; readonly y: number; readonly z: number },
  material: Parameters<typeof block>[3],
  radius = 0.04,
): Mesh {
  const mesh = block(dimensions.width, dimensions.height, dimensions.depth, material, { radius });
  mesh.position.set(position.x, position.y, position.z);
  ctx.add(mesh);
  return mesh;
}

function buildArena(ctx: GameCtx, materials: Materials): void {
  const floor = addStaticBlock(
    ctx,
    { width: 16, height: 0.2, depth: 10 },
    { x: 0, y: -0.12, z: 0 },
    materials.floor,
    0.18,
  );
  floor.receiveShadow = true;
  addVisualBlock(ctx, { width: 15.4, height: 0.035, depth: 9.4 }, { x: 0, y: 0.005, z: 0 }, materials.floorInset, 0.12);

  addStaticBlock(ctx, { width: 16.5, height: 0.75, depth: 0.35 }, { x: 0, y: 0.37, z: -4.82 }, materials.wall);
  addStaticBlock(ctx, { width: 16.5, height: 0.75, depth: 0.35 }, { x: 0, y: 0.37, z: 4.82 }, materials.wall);
  addStaticBlock(ctx, { width: 0.35, height: 0.75, depth: 10 }, { x: -7.82, y: 0.37, z: 0 }, materials.wall);
  addStaticBlock(ctx, { width: 0.35, height: 0.75, depth: 10 }, { x: 7.82, y: 0.37, z: 0 }, materials.wall);

  addStaticBlock(ctx, { width: 1.35, height: 0.82, depth: 5.85 }, { x: 0, y: 0.41, z: -0.35 }, materials.wall, 0.16);
  addVisualBlock(ctx, { width: 0.18, height: 0.06, depth: 5.25 }, { x: -0.2, y: 0.85, z: -0.35 }, materials.stripe, 0.04);
  addVisualBlock(ctx, { width: 0.18, height: 0.06, depth: 5.25 }, { x: 0.2, y: 0.85, z: -0.35 }, materials.stripe, 0.04);

  const coverPositions = [
    { x: -4.75, z: -3.15 },
    { x: -4.75, z: 3.15 },
    { x: 4.75, z: -3.15 },
    { x: 4.75, z: 3.15 },
  ];
  for (const position of coverPositions) {
    addStaticBlock(ctx, { width: 3.35, height: 0.55, depth: 0.62 }, { ...position, y: 0.275 }, materials.cover, 0.14);
    addVisualBlock(ctx, { width: 2.65, height: 0.045, depth: 0.08 }, { x: position.x, y: 0.57, z: position.z }, materials.stripe, 0.03);
  }

  addVisualBlock(ctx, { width: 0.05, height: 0.025, depth: 8.45 }, { x: -2.1, y: 0.03, z: 0 }, materials.stripe, 0.02);
  addVisualBlock(ctx, { width: 0.05, height: 0.025, depth: 8.45 }, { x: 2.1, y: 0.03, z: 0 }, materials.stripe, 0.02);
  addVisualBlock(ctx, { width: 9.2, height: 0.025, depth: 0.05 }, { x: 0, y: 0.03, z: 0.7 }, materials.stripe, 0.02);

  const beaconPositions = [
    { x: -6.7, z: -4.1 },
    { x: 6.7, z: -4.1 },
    { x: -6.7, z: 4.1 },
    { x: 6.7, z: 4.1 },
  ];
  for (const position of beaconPositions) {
    const beacon = new Group();
    const base = block(0.35, 0.08, 0.35, materials.cover, { radius: 0.08 });
    const stem = tube(0.045, 0.06, 0.3, materials.stripe, { segments: 12 });
    const light = ball(0.1, materials.reticle, { segments: 4 });
    stem.position.y = 0.18;
    light.position.y = 0.39;
    beacon.add(base, stem, light);
    beacon.position.set(position.x, 0, position.z);
    ctx.add(beacon);
  }
}

function createPickup(ctx: GameCtx, position: Vector3, materials: Materials, phase: number): Pickup {
  const group = new Group();
  const base = block(0.5, 0.1, 0.5, materials.pickupDetail, { radius: 0.08 });
  const stem = tube(0.05, 0.07, 0.32, materials.pickup, { segments: 12 });
  const orb = ball(0.16, materials.pickup, { segments: 14 });
  const tip = spike(0.14, 0.25, materials.pickupDetail, { segments: 12 });
  stem.position.y = 0.2;
  orb.position.y = 0.43;
  tip.position.y = 0.68;
  group.add(base, stem, orb, tip);
  group.position.copy(position);
  group.position.y += Math.sin(phase) * 0.03;
  group.traverse((object) => {
    object.userData.pickup = true;
  });
  ctx.add(group);
  return { baseY: group.position.y, collected: false, group, position: group.position, };
}
