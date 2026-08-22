import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { type Mesh, type PerspectiveCamera, Vector3 } from "three";
import { applyDirectDamage, applyRadiusDamage } from "../combat/damage.js";
import { Pickup } from "../entities/Pickup.js";
import {
  FRIENDLY_LAYER,
  HOSTILE_LAYER,
  PLAYER_LAYER,
  Player,
  SPAWN,
  WORLD_LAYER,
} from "../entities/Player.js";
import { Target } from "../entities/Target.js";
import { SpawnPoints } from "../level/SpawnPoints.js";
import { emitPlaytestEvent } from "../playtest-events.js";
import { createArenaCamera } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { createArena, createFriendlyVisual, createWallVisual } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";
import { WaveDirector } from "../waves.js";
import { Hitscan } from "../weapons/Hitscan.js";
import { Projectile } from "../weapons/Projectile.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

const AIM = new Vector3(0, 0, -1);
const UP = new Vector3(0, 1, 0);
// Relative mouse pixels to radians. Mouse look is applied per pixel moved, not per second —
// the delta is already frame-rate independent, so no dt scaling.
const LOOK_RADIANS_PER_PIXEL = 0.005;
const DEMO_POSITION = new Vector3(0, 0.85, -4);
const WAVE_POSITION = new Vector3(0, 0.9, -9);
const SCAN_POSITION = new Vector3(3, 0.9, 0);
const BLAST_CENTRE = new Vector3(0, 0.85, -4);
const SPAWN_POINTS = new SpawnPoints([
  new Vector3(-0.4, SPAWN.y, SPAWN.z),
  SPAWN,
  new Vector3(0.4, SPAWN.y, SPAWN.z),
]);

type TargetEntry = { readonly id: string; readonly target: Target };

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    aimedShots: 0,
    aiming: 0,
    armor: 0,
    deaths: 0,
    demoDamage: 0,
    demoTargetAlive: 1,
    friendlyPassed: 0,
    gameOver: 0,
    gameWon: 0,
    health: 100,
    hitDistanceTenths: 0,
    hitNormalXPercent: -101,
    hitNormalYPercent: -101,
    hitNormalZPercent: -101,
    lives: 3,
    pickups: 0,
    radiusInsideDeaths: 0,
    radiusMidAlive: 1,
    radiusNearAlive: 1,
    radiusOutsideAlive: -1,
    respawns: 0,
    scanCount: 0,
    score: 0,
    shotsFired: 0,
    targetsRemaining: 1,
    wave: 1,
    wavesCleared: 0,
    wallBlocked: 0,
    yawDegrees: 0,
    phase: "playing",
  };

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const camera = ctx.camera as PerspectiveCamera;
    const materials = createMaterials();
    setupSky(ctx.scene);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer, ctx.scene, camera);
    const loading = createLoadingScreen(ctx);
    ctx.add(camera);
    const rig = createArenaCamera(camera);
    ctx.viewport.resize();

    const arena = createArena(materials);
    ctx.add(arena.group);
    const arenaBody = (object: Mesh, shape: CollisionShape3D): RigidBody3D =>
      new RigidBody3D({
        collisionLayer: WORLD_LAYER,
        collisionMask: PLAYER_LAYER | HOSTILE_LAYER | FRIENDLY_LAYER,
        object,
        physics: ctx.physics,
        shape,
        type: "fixed",
      });
    arenaBody(arena.floor, CollisionShape3D.box(22, 0.4, 20));
    for (const wall of arena.walls) arenaBody(wall, CollisionShape3D.fromMesh(wall));

    const playerRef: { value?: Player } = {};
    const getPlayer = (): Player => {
      if (playerRef.value === undefined) throw new Error("Shooter player is not initialized.");
      return playerRef.value;
    };
    const targets = new Map<number, Target>();
    const waveTargets: TargetEntry[] = [];
    const projectiles: Array<{ readonly id: string; readonly value: Projectile }> = [];
    let projectileIndex = 0;
    const waveDirector = new WaveDirector();
    const hitscan = new Hitscan();
    const spawnPoints = SPAWN_POINTS;
    const elapsed = { value: 0 };
    // Look state: relative mouse pixels accumulate here, the camera rig orbits by it, and the
    // aim direction rotates with it. Reported through ctx.state so a playtest can observe the
    // rotation after the real input path.
    const lookState = { yaw: 0 };
    const aimForward = (): Vector3 => AIM.clone().applyAxisAngle(UP, -lookState.yaw);

    const createEnemyProjectile = (origin: Vector3): void => {
      const direction = getPlayer().mesh.position.clone().sub(origin).normalize();
      const id = `projectile.enemy.${projectileIndex++}`;
      const projectile = new Projectile(
        ctx,
        materials,
        origin,
        direction,
        WORLD_LAYER | PLAYER_LAYER,
        (hit) => {
          if (hit.body.id === getPlayer().body.body.id) {
            getPlayer().takeDamage(20);
            emitPlaytestEvent({ entity: "player", name: "projectile-hit" });
          }
        },
      );
      projectiles.push({ id, value: projectile });
      ctx.entities.add(id, projectile);
    };

    const registerTarget = (
      id: string,
      position: Vector3,
      options: ConstructorParameters<typeof Target>[3] = {},
      scan = true,
    ): Target => {
      const target = new Target(ctx, materials, position, {
        ...options,
        onFire: options.onFire ?? createEnemyProjectile,
      });
      targets.set(target.body.body.id, target);
      ctx.entities.add(id, target);
      if (scan) target.startScanning(ctx, getPlayer().body.body.id);
      return target;
    };

    const removeEntity = (id: string): void => {
      if (ctx.entities.get(id) !== undefined) ctx.entities.remove(id);
    };

    const onDamage = (amount: number): void => {
      const previous = ctx.state.getState();
      ctx.state.set({ health: getPlayer().health, score: previous.score, armor: 0 });
      emitPlaytestEvent({ entity: "player", name: "damaged", amount });
    };

    const onDeath = (): void => {
      const previous = ctx.state.getState();
      const lives = Math.max(0, previous.lives - 1);
      const deaths = previous.deaths + 1;
      ctx.state.set({
        deaths,
        gameOver: lives === 0 ? 1 : 0,
        lives,
        phase: lives === 0 ? "lost" : "dead",
      });
      emitPlaytestEvent({ entity: "player", name: "died", lives });
      if (lives === 0) return;
      ctx.after(0.5, () => {
        waveDirector.reset();
        const spawn = spawnPoints.furthestFrom(waveTargets.map(({ target }) => target));
        getPlayer().respawn(spawn);
        const state = ctx.state.getState();
        ctx.state.set({
          health: getPlayer().health,
          phase: "playing",
          respawns: state.respawns + 1,
          wave: waveDirector.wave,
          wavesCleared: waveDirector.cleared,
        });
        emitPlaytestEvent({ entity: "player", name: "respawned" });
      });
    };

    const player = new Player(ctx, materials, SPAWN.clone(), onDamage, onDeath);
    playerRef.value = player;
    ctx.entities.add("player", player);

    const demo = registerTarget(
      "demo-target",
      DEMO_POSITION,
      { health: 20, onFire: () => undefined },
      false,
    );
    registerTarget("scan-target", SCAN_POSITION, { health: 20, onFire: () => undefined });
    const friendly = createFriendlyVisual(materials);
    friendly.name = "friendly-drone";
    friendly.position.set(0, 1, 2.2);
    ctx.add(friendly);
    const friendlyBody = new RigidBody3D({
      collisionLayer: FRIENDLY_LAYER,
      collisionMask: 0,
      object: friendly,
      physics: ctx.physics,
      shape: CollisionShape3D.box(0.9, 1.4, 0.9),
      type: "fixed",
    });

    const wall = createWallVisual(materials);
    wall.name = "probe-wall";
    wall.position.set(4, 1.4, 5);
    ctx.add(wall);
    const wallBody = new RigidBody3D({
      collisionLayer: WORLD_LAYER,
      collisionMask: PLAYER_LAYER | FRIENDLY_LAYER,
      object: wall,
      physics: ctx.physics,
      shape: CollisionShape3D.box(0.65, 2.8, 2.8),
      type: "fixed",
    });

    const radiusNear = registerTarget(
      "radius.near",
      new Vector3(0.8, 0.85, -4),
      { health: 30, onFire: () => undefined },
      false,
    );
    const radiusMid = registerTarget(
      "radius.mid",
      new Vector3(-1.8, 0.85, -4),
      { health: 30, onFire: () => undefined },
      false,
    );
    const radiusOutside = registerTarget(
      "radius.outside",
      new Vector3(6.5, 0.85, -4),
      { health: 30, onFire: () => undefined },
      false,
    );

    const pickup = new Pickup(
      ctx,
      materials,
      new Vector3(-1.2, SPAWN.y, SPAWN.z),
      player.body.body.id,
      () => {
        player.health = Math.min(player.maxHealth, player.health + 60);
        const state = ctx.state.getState();
        ctx.state.set({
          armor: state.armor + 1,
          health: player.health,
          pickups: state.pickups + 1,
        });
        emitPlaytestEvent({ entity: "player", name: "collected" });
        ctx.after(4, () => pickup.respawn());
      },
    );
    ctx.entities.add("health-pickup", pickup);

    const spawnWave = (wave: number): void => {
      const target = registerTarget(`wave.target.${wave}`, WAVE_POSITION.clone(), {
        health: 35,
        wave,
      });
      waveTargets.push({ id: `wave.target.${wave}`, target });
      ctx.state.set({ targetsRemaining: 1, wave });
      emitPlaytestEvent({ entity: "wave", name: "started", wave });
    };
    waveDirector.start(spawnWave);
    rig.snap(player.mesh.position);

    const fireHitscan = (whileAiming: boolean): void => {
      const state = ctx.state.getState();
      const originOffset = player
        .aimOrigin()
        .sub(player.mesh.position)
        .applyAxisAngle(UP, -lookState.yaw)
        .add(player.mesh.position);
      const hit = hitscan.fire(ctx.physics, originOffset, aimForward(), HOSTILE_LAYER);
      ctx.state.set({
        aimedShots: whileAiming ? state.aimedShots + 1 : state.aimedShots,
        shotsFired: state.shotsFired + 1,
      });
      emitPlaytestEvent({ entity: "player", name: "fired", aimed: whileAiming ? 1 : 0 });
      if (hit === undefined) return;
      const target = targets.get(hit.body.id);
      if (target !== undefined) applyDirectDamage(targets, hit.body.id, 40);
      const demoHit = hit.body.id === demo.body.body.id;
      ctx.state.set({
        demoTargetAlive: demo.alive ? 1 : 0,
        friendlyPassed: demoHit && friendlyBody.body.id !== hit.body.id ? 1 : state.friendlyPassed,
        ...(demoHit
          ? {
              demoDamage: state.demoDamage + 40,
              hitDistanceTenths: Math.round(hit.distance * 10),
              hitNormalXPercent: Math.round(hit.normal.x * 100),
              hitNormalYPercent: Math.round(hit.normal.y * 100),
              hitNormalZPercent: Math.round(hit.normal.z * 100),
            }
          : {}),
      });
      emitPlaytestEvent({
        entity: "player",
        name: "hit",
        distanceTenths: Math.round(hit.distance * 10),
      });
      if (target?.alive === false) emitPlaytestEvent({ entity: "target", name: "defeated" });
    };

    const fireProjectile = (): void => {
      const id = `projectile.player.${projectileIndex++}`;
      const projectile = new Projectile(
        ctx,
        materials,
        player.aimOrigin(),
        AIM,
        HOSTILE_LAYER | WORLD_LAYER,
        (hit) => {
          if (applyDirectDamage(targets, hit.body.id, 22))
            emitPlaytestEvent({ entity: "player", name: "projectile-defeated" });
        },
      );
      projectiles.push({ id, value: projectile });
      ctx.entities.add(id, projectile);
    };

    const fireRadius = (): void => {
      applyRadiusDamage(ctx.physics, BLAST_CENTRE, 3.5, 80, targets);
      const insideDeaths = [radiusNear, radiusMid].filter(
        (target) => target.alive === false,
      ).length;
      ctx.state.set({
        radiusInsideDeaths: insideDeaths,
        radiusMidAlive: radiusMid.alive ? 1 : 0,
        radiusNearAlive: radiusNear.alive ? 1 : 0,
        radiusOutsideAlive: radiusOutside.alive ? 1 : 0,
      });
      emitPlaytestEvent({ entity: "player", name: "radius-damage", defeated: insideDeaths });
    };

    const probeWall = (): void => {
      const from = player.mesh.position.clone().add(new Vector3(0, 0.75, 0));
      const to = from.clone().add(new Vector3(10, 0, 0));
      const hit = hitscan.probe(ctx.physics, from, to, WORLD_LAYER | FRIENDLY_LAYER);
      if (hit?.body.id !== wallBody.body.id) return;
      ctx.state.set({ wallBlocked: 1 });
      emitPlaytestEvent({ entity: "player", name: "wall-blocked" });
    };

    const removeDeadTargets = (): void => {
      if (!demo.alive && ctx.entities.get("demo-target") !== undefined) {
        removeEntity("demo-target");
        targets.delete(demo.body.body.id);
      }
      for (let index = waveTargets.length - 1; index >= 0; index -= 1) {
        const entry = waveTargets[index];
        if (entry?.target.alive !== false) continue;
        removeEntity(entry.id);
        targets.delete(entry.target.body.body.id);
        waveTargets.splice(index, 1);
      }
    };

    const restart = (frameCtx: GameCtx): boolean => {
      if (!frameCtx.input.justPressed("restart")) return false;
      frameCtx.state.set(Play.initialState);
      frameCtx.state.flush();
      void frameCtx.goto("play");
      return true;
    };

    const handleInput = (frameCtx: GameCtx): void => {
      if (frameCtx.input.justPressed("aim")) {
        ctx.state.set({ aiming: 1 });
        emitPlaytestEvent({ entity: "player", name: "aim-engaged" });
      }
      if (frameCtx.input.justReleased("aim")) {
        ctx.state.set({ aiming: 0 });
        emitPlaytestEvent({ entity: "player", name: "aim-released" });
      }
      if (frameCtx.input.justPressed("fire")) fireHitscan(frameCtx.input.pressed("aim"));
      if (frameCtx.input.justPressed("projectile")) fireProjectile();
      if (frameCtx.input.justPressed("blast")) fireRadius();
      if (frameCtx.input.justPressed("probe")) probeWall();
      if (frameCtx.input.justPressed("damage")) player.takeDamage(35);
      if (frameCtx.input.justPressed("lethal")) player.takeDamage(player.health + 1);
    };

    const updateProjectiles = (frameCtx: GameCtx, dt: number): void => {
      for (const entry of [...projectiles]) {
        entry.value.update(frameCtx, dt);
        if (!entry.value.dead) continue;
        removeEntity(entry.id);
        projectiles.splice(projectiles.indexOf(entry), 1);
      }
    };

    const updateWaves = (frameCtx: GameCtx): void => {
      waveDirector.update(
        frameCtx,
        waveTargets.filter(({ target }) => target.alive).length,
        spawnWave,
        (wave) => {
          const state = frameCtx.state.getState();
          frameCtx.state.set({ score: state.score + 100, wavesCleared: waveDirector.cleared });
          emitPlaytestEvent({ entity: "wave", name: "cleared", wave });
        },
      );
      if (waveDirector.won) frameCtx.state.set({ gameWon: 1, phase: "won" });
    };

    const syncStateAndHud = (frameCtx: GameCtx): void => {
      const liveTargets = waveTargets.filter(({ target }) => target.alive).length;
      const currentScanCount = [...targets.values()].reduce(
        (sum, target) => sum + target.scanCount,
        0,
      );
      const previous = frameCtx.state.getState();
      const scanCount = Math.max(previous.scanCount, currentScanCount);
      frameCtx.state.set({
        health: player.health,
        scanCount,
        targetsRemaining: liveTargets,
        wave: waveDirector.wave,
        wavesCleared: waveDirector.cleared,
      });
    };

    return (frameCtx, dt) => {
      loading.update();
      elapsed.value += dt;
      if (restart(frameCtx)) return;
      handleInput(frameCtx);

      const look = frameCtx.input.vector("look");
      if (look.x !== 0) {
        lookState.yaw += look.x * LOOK_RADIANS_PER_PIXEL;
        ctx.state.set({ yawDegrees: Math.round((lookState.yaw * 180) / Math.PI) });
      }

      player.update(frameCtx, dt);
      hitscan.update(dt);
      updateProjectiles(frameCtx, dt);
      for (const target of targets.values()) target.update(dt);
      pickup.update(dt);
      removeDeadTargets();
      updateWaves(frameCtx);
      syncStateAndHud(frameCtx);
      rig.follow(player.mesh.position, dt, lookState.yaw);
    };
  }
}
