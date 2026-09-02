import {
  Billboard3D,
  CameraShake,
  GPUParticles3D,
  type ICtx,
  Scene,
  type SceneFrame,
  SpriteAnimator3D,
  afterPhysics,
  isMobile,
  isTouchscreenAvailable,
} from "@threenative/core";
import {
  CollisionShape3D,
  type IPhysicsContext,
  type IRayHit,
  RigidBody3D,
  buildStaticColliders,
} from "@threenative/physics";
import { Mesh, MeshBasicMaterial, type PerspectiveCamera, Quaternion, Vector3 } from "three";
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
import { createArenaShakeOptions, createFirstPersonRig } from "../render/camera.js";
import { DecalField } from "../render/decals.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import {
  PICKUP_SPRITE_FRAMES,
  createArena,
  createFriendlyVisual,
  createWallVisual,
} from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import { TouchControls } from "../render/touch-controls.js";
import type { ITouchInput } from "../render/touch-controls.js";
import { createImpactDust, createImpactSparks, createMuzzleFlash } from "../render/vfx.js";
import type { GameState } from "../state.js";
import { WaveDirector } from "../waves.js";
import { Hitscan } from "../weapons/Hitscan.js";
import { Projectile } from "../weapons/Projectile.js";
import { MAGAZINE, RESERVE, Viewmodel } from "../weapons/Viewmodel.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

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
type ProjectileEntry = {
  readonly collisionMask: number;
  readonly id: string;
  readonly value: Projectile;
};

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    paused: false,
    uiReady: false,
    aimedShots: 0,
    aiming: 0,
    ammo: MAGAZINE,
    reserve: RESERVE,
    reloading: 0,
    armor: 0,
    cameraShakes: 0,
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
    nameplateFacingCamera: 0,
    pickupFrame: 0,
    pickupFrameChanges: 0,
    pickups: 0,
    pitchDegrees: 0,
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
    const sun = setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    // isMobile() arrives as an argument because src/render/ imports no framework package: the
    // platform decision is made here, in portable game code, exactly like createRandom.
    setupPost(ctx.renderer, ctx.scene, camera, { godraysLight: sun, mobile: isMobile() });
    const loading = createLoadingScreen(ctx);
    ctx.add(camera);
    const showTouchControls = isMobile() && isTouchscreenAvailable();
    const touchControls = showTouchControls
      ? ctx.entities.add("touch-controls", new TouchControls(camera))
      : undefined;
    const shake = new CameraShake(createArenaShakeOptions());
    const rig = createFirstPersonRig(camera, shake);
    const billboards: Billboard3D[] = [];
    const billboardFront = new Vector3(0, 0, 1);
    const billboardExpected = new Vector3();
    const billboardCameraPosition = new Vector3();
    const billboardObjectPosition = new Vector3();
    const billboardUp = new Vector3(0, 1, 0);
    const billboardExpectedUp = new Vector3();
    const billboardCameraQuaternion = new Quaternion();
    const billboardWorldQuaternion = new Quaternion();
    const spriteAnimators: SpriteAnimator3D[] = [];
    ctx.viewport.resize();

    const arena = createArena(materials);
    ctx.add(arena.group);
    buildStaticColliders(ctx, arena.group, {
      collisionLayer: WORLD_LAYER,
      collisionMask: PLAYER_LAYER | HOSTILE_LAYER | FRIENDLY_LAYER,
      predicate: (object) => object.name === "arena-floor" || object.name.startsWith("arena-wall-"),
    });

    const playerRef: { value?: Player } = {};
    const getPlayer = (): Player => {
      if (playerRef.value === undefined) throw new Error("Shooter player is not initialized.");
      return playerRef.value;
    };
    const targets = new Map<number, Target>();
    const waveTargets: TargetEntry[] = [];
    const projectiles: ProjectileEntry[] = [];
    const targetScratch: Target[] = [];
    let projectileIndex = 0;
    const waveDirector = new WaveDirector();
    const hitscan = new Hitscan();
    const spawnPoints = SPAWN_POINTS;
    const elapsed = { value: 0 };
    const enemyDirection = new Vector3();
    const decalPoint = new Vector3();
    const decalNormal = new Vector3();

    const onEnemyProjectileHit = (hit: IRayHit): void => {
      if (hit.body.id === getPlayer().body.body.id) {
        getPlayer().takeDamage(20);
        burst(impactDustVfx, hit.position, "vfx-impact");
        emitPlaytestEvent({ entity: "player", name: "projectile-hit" });
      }
    };
    const onPlayerProjectileHit = (hit: IRayHit): void => {
      if (applyDirectDamage(targets, hit.body.id, 22)) {
        burst(impactVfx, hit.position, "vfx-impact");
        emitPlaytestEvent({ entity: "player", name: "projectile-defeated" });
      }
    };

    const acquireProjectile = (
      origin: Vector3,
      direction: Vector3,
      collisionMask: number,
      onHit: (hit: IRayHit) => void,
    ): void => {
      for (const entry of projectiles) {
        if (!entry.value.dead || entry.collisionMask !== collisionMask) continue;
        entry.value.reset(origin, direction, onHit);
        return;
      }
      const id = `projectile.pool.${projectileIndex++}`;
      const projectile = new Projectile(ctx, materials, origin, direction, collisionMask, onHit);
      projectiles.push({ collisionMask, id, value: projectile });
      ctx.entities.add(id, projectile);
    };

    const createEnemyProjectile = (origin: Vector3): void => {
      const direction = enemyDirection.copy(getPlayer().mesh.position).sub(origin).normalize();
      acquireProjectile(origin, direction, WORLD_LAYER | PLAYER_LAYER, onEnemyProjectileHit);
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
      const nameplate = target.mesh.getObjectByName("target-nameplate");
      if (nameplate === undefined)
        throw new Error("Shooter target visual is missing its target-nameplate.");
      billboards.push(new Billboard3D(nameplate, { camera }));
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
        targetScratch.length = 0;
        for (const entry of waveTargets) targetScratch.push(entry.target);
        const spawn = spawnPoints.furthestFrom(targetScratch);
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

    const player = new Player(ctx, camera, materials, SPAWN.clone(), onDamage, onDeath);
    playerRef.value = player;
    ctx.entities.add("player", player);
    const viewmodel = new Viewmodel(player.visual);
    ctx.entities.add("viewmodel", viewmodel);
    // Marks live on the scene root, not on what they hit: a hole is stuck to the world, and a
    // target that dies should not take the holes in the wall behind it with it.
    const decals = new DecalField(ctx.scene, { count: 24 });
    ctx.entities.add("decals", decals);
    // Two seconds in, every material this pool needs has been compiled; stop drawing the slots
    // nobody has used.
    ctx.after(2, () => decals.settle());

    const muzzleVfx = ctx.add(new GPUParticles3D(createMuzzleFlash()));
    const impactVfx = ctx.add(new GPUParticles3D(createImpactSparks()));
    const impactDustVfx = ctx.add(new GPUParticles3D(createImpactDust()));
    muzzleVfx.visible = false;
    impactVfx.visible = false;
    impactDustVfx.visible = false;
    const burst = (
      particles: GPUParticles3D,
      position: { readonly x: number; readonly y: number; readonly z: number },
      name: string,
    ): void => {
      particles.position.copy(position);
      particles.visible = true;
      particles.restart();
      ctx.after(0.45, () => {
        particles.visible = false;
      });
      emitPlaytestEvent({ entity: "player", name });
    };

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
    const pickupAnimation = pickup.mesh.getObjectByName("pickup-animation");
    if (
      !(pickupAnimation instanceof Mesh) ||
      !(pickupAnimation.material instanceof MeshBasicMaterial)
    )
      throw new Error("Shooter pickup visual is missing its animated sprite material.");
    if (pickupAnimation.material.map === null)
      throw new Error("Shooter pickup animated sprite is missing its atlas texture.");
    spriteAnimators.push(
      new SpriteAnimator3D({ frames: PICKUP_SPRITE_FRAMES, texture: pickupAnimation.material.map }),
    );

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
    rig.snap(player);
    // The eye is placed here, after the solver wrote the step, and never inside the frame
    // callback. Placing it from `update` leaves the camera one physics step behind the body.
    afterPhysics(ctx, (dt) => rig.follow(player, dt));

    const resolveHitscanImpact = (
      hit: NonNullable<ReturnType<typeof hitscan.fire>>,
      state: GameState,
    ): void => {
      const target = targets.get(hit.body.id);
      if (target !== undefined) applyDirectDamage(targets, hit.body.id, 40);
      burst(impactVfx, hit.position, "vfx-impact");
      burst(impactDustVfx, hit.position, "vfx-impact-dust");
      // A round that leaves nothing behind teaches the player their shots land nowhere.
      decalPoint.set(hit.position.x, hit.position.y, hit.position.z);
      decalNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
      decals.place(decalPoint, decalNormal, target === undefined ? 1 : 0.7);
      const demoHit = hit.body.id === demo.body.body.id;
      shake.trigger();
      ctx.state.set({
        cameraShakes: state.cameraShakes + 1,
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

    /**
     * One round.
     *
     * The ray starts at the camera and runs down the camera's own forward axis, because that is
     * where the crosshair is drawn. Starting it at the muzzle instead puts the round a hand's
     * width to the right of where the player aimed, which is invisible at range and infuriating
     * up close. The muzzle is where the *flash* goes, and the weapon leans to meet this ray.
     */
    const fireHitscan = (whileAiming: boolean): void => {
      if (!viewmodel.fire()) return;
      const state = ctx.state.getState();
      const ray = player.aimRay();
      const hit = hitscan.fire(ctx.physics, ray.origin, ray.direction, HOSTILE_LAYER | WORLD_LAYER);
      burst(muzzleVfx, viewmodel.muzzlePoint(), "vfx-muzzle");
      ctx.state.set({
        aimedShots: whileAiming ? state.aimedShots + 1 : state.aimedShots,
        ammo: viewmodel.ammo,
        shotsFired: state.shotsFired + 1,
      });
      emitPlaytestEvent({ entity: "player", name: "fired", aimed: whileAiming ? 1 : 0 });
      if (hit !== undefined) resolveHitscanImpact(hit, state);
    };

    const reload = (): void => {
      if (viewmodel.reloading || viewmodel.ammo >= MAGAZINE || viewmodel.reserve <= 0) return;
      viewmodel.reload(ctx);
      ctx.state.set({ reloading: 1 });
      emitPlaytestEvent({ entity: "player", name: "reload-started" });
    };

    const fireProjectile = (): void => {
      const ray = player.aimRay();
      burst(muzzleVfx, viewmodel.muzzlePoint(), "vfx-muzzle");
      acquireProjectile(
        ray.origin,
        ray.direction,
        HOSTILE_LAYER | WORLD_LAYER,
        onPlayerProjectileHit,
      );
    };

    const fireRadius = (): void => {
      burst(impactDustVfx, BLAST_CENTRE, "vfx-blast");
      applyRadiusDamage(ctx.physics, BLAST_CENTRE, 3.5, 80, targets);
      let insideDeaths = 0;
      if (!radiusNear.alive) insideDeaths += 1;
      if (!radiusMid.alive) insideDeaths += 1;
      ctx.state.set({
        radiusInsideDeaths: insideDeaths,
        radiusMidAlive: radiusMid.alive ? 1 : 0,
        radiusNearAlive: radiusNear.alive ? 1 : 0,
        radiusOutsideAlive: radiusOutside.alive ? 1 : 0,
      });
      emitPlaytestEvent({ entity: "player", name: "radius-damage", defeated: insideDeaths });
    };

    const probeWall = (): void => {
      const from = player.mesh.position.clone().add(new Vector3(0, player.eyeHeight, 0));
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

    const handleAimEdges = (frameCtx: GameCtx): void => {
      if (frameCtx.input.justPressed("aim")) {
        ctx.state.set({ aiming: 1 });
        emitPlaytestEvent({ entity: "player", name: "aim-engaged" });
      }
      if (frameCtx.input.justReleased("aim")) {
        ctx.state.set({ aiming: 0 });
        emitPlaytestEvent({ entity: "player", name: "aim-released" });
      }
    };

    const handleInput = (frameCtx: GameCtx, touch?: ITouchInput): void => {
      handleAimEdges(frameCtx);
      // Held, not tapped. The weapon's cyclic cooldown decides which held frames send a round,
      // so a single tap and a held trigger run exactly the same path.
      if (frameCtx.input.pressed("fire") || touch?.firePressed === true) fireHitscan(player.aiming);
      if (frameCtx.input.justPressed("reload") || touch?.reloadPressed === true) reload();
      if (frameCtx.input.justPressed("projectile")) fireProjectile();
      if (frameCtx.input.justPressed("blast")) fireRadius();
      if (frameCtx.input.justPressed("probe")) probeWall();
      if (frameCtx.input.justPressed("damage")) player.takeDamage(35);
      if (frameCtx.input.justPressed("lethal")) player.takeDamage(player.health + 1);
    };

    const updateProjectiles = (frameCtx: GameCtx, dt: number): void => {
      for (const entry of projectiles) entry.value.update(frameCtx, dt);
    };

    const updateWaves = (frameCtx: GameCtx): void => {
      let liveTargets = 0;
      for (const entry of waveTargets) if (entry.target.alive) liveTargets += 1;
      waveDirector.update(frameCtx, liveTargets, spawnWave, (wave) => {
        const state = frameCtx.state.getState();
        frameCtx.state.set({ score: state.score + 100, wavesCleared: waveDirector.cleared });
        emitPlaytestEvent({ entity: "wave", name: "cleared", wave });
      });
      if (waveDirector.won) frameCtx.state.set({ gameWon: 1, phase: "won" });
    };

    let lastAmmo = -1;
    let lastReserve = -1;
    let lastReloading = -1;
    const weaponPatch: Partial<GameState> = {};
    const publishWeapon = (frameCtx: GameCtx): void => {
      const reloading = viewmodel.reloading ? 1 : 0;
      if (
        viewmodel.ammo === lastAmmo &&
        viewmodel.reserve === lastReserve &&
        reloading === lastReloading
      )
        return;
      if (lastReloading === 1 && reloading === 0)
        emitPlaytestEvent({ entity: "player", name: "reloaded" });
      lastAmmo = viewmodel.ammo;
      lastReserve = viewmodel.reserve;
      lastReloading = reloading;
      weaponPatch.ammo = viewmodel.ammo;
      weaponPatch.reserve = viewmodel.reserve;
      weaponPatch.reloading = reloading;
      frameCtx.state.set(weaponPatch);
    };

    const hudPatch: Partial<GameState> = {};
    const lookPatch: Partial<GameState> = {};
    let lastHealth = -1;
    let lastScanCount = -1;
    let lastTargetsRemaining = -1;
    let lastWave = -1;
    let lastWavesCleared = -1;
    let lastPickupFrame = -1;
    const pickupPatch: Partial<GameState> = {};
    const nameplatePatch: Partial<GameState> = {};
    const syncNameplateFacingCamera = (frameCtx: GameCtx): void => {
      const nameplate = billboards[0]?.object;
      if (nameplate === undefined) return;
      nameplate.updateWorldMatrix(true, false);
      camera.getWorldPosition(billboardCameraPosition);
      nameplate.getWorldPosition(billboardObjectPosition);
      billboardExpected.subVectors(billboardCameraPosition, billboardObjectPosition).normalize();
      billboardFront
        .set(0, 0, 1)
        .applyQuaternion(nameplate.getWorldQuaternion(billboardWorldQuaternion));
      camera.getWorldQuaternion(billboardCameraQuaternion);
      billboardExpectedUp
        .set(0, 1, 0)
        .applyQuaternion(billboardCameraQuaternion)
        .projectOnPlane(billboardExpected)
        .normalize();
      billboardUp
        .set(0, 1, 0)
        .applyQuaternion(nameplate.getWorldQuaternion(billboardWorldQuaternion));
      const nameplateFacingCamera =
        billboardFront.dot(billboardExpected) >= 0.999 &&
        billboardUp.dot(billboardExpectedUp) >= 0.999
          ? 1
          : 0;
      if (frameCtx.state.getState().nameplateFacingCamera === nameplateFacingCamera) return;
      nameplatePatch.nameplateFacingCamera = nameplateFacingCamera;
      frameCtx.state.set(nameplatePatch);
    };
    const syncStateAndHud = (frameCtx: GameCtx): void => {
      let liveTargets = 0;
      for (const entry of waveTargets) if (entry.target.alive) liveTargets += 1;
      let currentScanCount = 0;
      for (const target of targets.values()) currentScanCount += target.scanCount;
      const previous = frameCtx.state.getState();
      const scanCount = Math.max(previous.scanCount, currentScanCount);
      const wave = waveDirector.wave;
      const wavesCleared = waveDirector.cleared;
      if (
        player.health === lastHealth &&
        scanCount === lastScanCount &&
        liveTargets === lastTargetsRemaining &&
        wave === lastWave &&
        wavesCleared === lastWavesCleared
      )
        return;
      lastHealth = player.health;
      lastScanCount = scanCount;
      lastTargetsRemaining = liveTargets;
      lastWave = wave;
      lastWavesCleared = wavesCleared;
      hudPatch.health = player.health;
      hudPatch.scanCount = scanCount;
      hudPatch.targetsRemaining = liveTargets;
      hudPatch.wave = wave;
      hudPatch.wavesCleared = wavesCleared;
      frameCtx.state.set(hudPatch);
    };

    /**
     * Publish where the player is looking.
     *
     * The player integrates the look deltas itself, inside `update`, on the same path a native
     * build takes. This only reports the result, and only when it changed — a state write every
     * frame would flush the bridge for nothing on a still mouse.
     */
    let lastYawDegrees = Number.NaN;
    let lastPitchDegrees = Number.NaN;
    const publishLook = (frameCtx: GameCtx): void => {
      const yawDegrees = Math.round(player.yawDegrees);
      const pitchDegrees = Math.round(player.pitchDegrees);
      if (yawDegrees === lastYawDegrees && pitchDegrees === lastPitchDegrees) return;
      lastYawDegrees = yawDegrees;
      lastPitchDegrees = pitchDegrees;
      lookPatch.yawDegrees = yawDegrees;
      lookPatch.pitchDegrees = pitchDegrees;
      frameCtx.state.set(lookPatch);
    };

    return (frameCtx, dt) => {
      loading.update();
      elapsed.value += dt;
      if (restart(frameCtx)) return;
      const touch = touchControls?.update(frameCtx.input.raw.pointers, frameCtx.viewport.size);
      // Look and stance first: the weapon pose and the shot both read this frame's aim, so a
      // round fired below would otherwise use last frame's crosshair.
      player.update(frameCtx, dt, touch);
      handleInput(frameCtx, touch);
      publishLook(frameCtx);

      const ray = player.aimRay();
      viewmodel.converge(ray.origin, ray.direction);
      viewmodel.update(dt, player.aiming, player.moving);
      publishWeapon(frameCtx);
      hitscan.update(dt);
      updateProjectiles(frameCtx, dt);
      for (const target of targets.values()) target.update(dt);
      for (const animator of spriteAnimators) animator.update(dt);
      const pickupFrame = spriteAnimators[0]?.frameIndex ?? 0;
      if (pickupFrame !== lastPickupFrame) {
        lastPickupFrame = pickupFrame;
        const previous = frameCtx.state.getState();
        pickupPatch.pickupFrame = pickupFrame;
        pickupPatch.pickupFrameChanges = previous.pickupFrameChanges + 1;
        frameCtx.state.set(pickupPatch);
      }
      pickup.update(dt);
      removeDeadTargets();
      updateWaves(frameCtx);
      syncStateAndHud(frameCtx);
      for (const billboard of billboards) billboard.update();
      syncNameplateFacingCamera(frameCtx);
    };
  }
}
