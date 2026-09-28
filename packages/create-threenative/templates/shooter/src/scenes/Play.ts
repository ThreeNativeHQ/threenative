import { onAfterPhysics } from "../postPhysics.js";
import { TouchControls } from "../entities/TouchControls.js";
import { softCircleDataTexture, TracerPool3D, type ITracerSpawnOptions, type ICtx, Scene, type SceneFrame } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import type {
  AnimationClip,
  Group,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Texture,
} from "three";
import {
  AdditiveBlending,
  CylinderGeometry,
  MathUtils,
  Mesh as MeshClass,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight as PointLightClass,
  Vector3,
} from "three";
import { GameAudio, type CueName } from "../audio/GameAudio.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { beginSquadFrame, Enemy, resetSquadProfile, squadProfile } from "../entities/Enemy.js";
import { FpsPlayer } from "../entities/FpsPlayer.js";
import { MAGAZINE, RESERVE, Rifle } from "../entities/Rifle.js";
import { Target } from "../entities/Target.js";
import { BreakableField } from "../render/breakables.js";
import { bulletHoleTexture, DecalField } from "../render/decals.js";
import { BoxOccluders } from "../render/occlusion.js";
import { ImpactBursts, MuzzleFlash, MuzzleFlashPool } from "../render/gunfx.js";
import { setupLighting } from "../render/lighting.js";
import { setupPost } from "../render/postprocessing.js";
import { PooledBillboards } from "../render/pooled-billboards.js";
import { scale } from "../render/scale.js";
import { buildTown, TOWN_HALF, type Town } from "../render/town.js";
import { resolveSurface } from "../surfaces.js";
import { createTownMaterials, type TownTextures } from "../render/townMaterials.js";
import { setupSky } from "../render/sky.js";
import { FrameStats } from "../perf.js";
import { TARGET_GOAL, type GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

/** The reference HUD reads 1:45 on the round clock. */
const RUN_SECONDS = 105;
const RANGE_METRES = 70;
const ROUND_DAMAGE = 10;

/**
 * Where the breakable vessels stand. Placed against walls and in doorways rather than out in the
 * open: a pot in the middle of a lane is an obstacle, and a pot beside a doorway is a place
 * someone lives. Every one of these is on the ground deck, clear of the patrol routes.
 */
const BREAKABLE_SPOTS: readonly {
  kind: "pot" | "jar" | "bottle";
  x: number;
  z: number;
  yaw: number;
}[] = [
  { kind: "pot", x: -8.4, z: 18.6, yaw: 0.3 },
  { kind: "jar", x: -7.2, z: 18.2, yaw: 1.1 },
  { kind: "pot", x: 11.5, z: 12.4, yaw: -0.6 },
  { kind: "bottle", x: 12.3, z: 12.1, yaw: 0 },
  { kind: "jar", x: 4.2, z: -6.5, yaw: 2.2 },
  { kind: "pot", x: -14.8, z: -3.2, yaw: 0.9 },
  { kind: "bottle", x: -15.6, z: -3.6, yaw: 0 },
  { kind: "jar", x: 17.4, z: -14.2, yaw: -1.4 },
  { kind: "pot", x: -3.6, z: 27.4, yaw: 1.8 },
  { kind: "bottle", x: 8.1, z: 24.6, yaw: 0 },
];

type LoadedModel = { scene: Group; animations: AnimationClip[] };

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    aiming: false,
    ammo: MAGAZINE,
    assetsLoaded: 0,
    assetsTotal: 0,
    blips: [],
    distanceMoved: 0,
    health: 100,
    hitFlash: 0,
    phase: "playing",
    playerX: 0,
    playerYaw: 0,
    playerZ: 32,
    ready: false,
    reloads: 0,
    reserve: RESERVE,
    score: 0,
    shots: 0,
    targetsHit: 0,
    timeRemaining: RUN_SECONDS,
  };

  #assets:
    | {
        enemy: LoadedModel;
        viewmodel: LoadedModel;
        weapon: LoadedModel;
        sky: Texture;
        skyIbl: Texture;
        town: TownTextures;
      }
    | undefined;

  /** Decoded cue buffers from `load`; kept across restarts so replays stay instant. */
  #audioBuffers: ReadonlyMap<CueName, AudioBuffer> | undefined;
  /** Live bus for the current scene instance; rebuilt by every `enter`, dropped by `exit`. */
  #audio: GameAudio | undefined;

  /**
   * Boot cost, in milliseconds, by phase.
   *
   * The black canvas before a round starts is almost entirely CPU: on this machine the last byte
   * arrives at ~1.0 s and the first playable frame is at ~6.0 s. Network is not the problem, so
   * "make the assets smaller" is not the fix — knowing which phase owns the other five seconds is.
   */
  #boot: Record<string, number> = {};

  override async load(ctx: GameCtx): Promise<void> {
    const bootClock = (): number => globalThis.performance?.now() ?? 0;
    const loadStarted = bootClock();
    // Every town surface is colour + OpenGL normal + roughness. The normals are
    // what stopped the walls reading as painted cardboard: a stucco photograph
    // with no relief takes the key light perfectly evenly however good the
    // photograph is. `bayview-brick` is the one map with no PBR set of its own,
    // so it borrows the whitewash relief — both are rough lime render at the
    // same grain, and the alternative is the only flat wall in the town.
    // Boot progress is counted, not faked: each asset ticks the HUD's bar as it
    // resolves, so a slow cold load shows movement instead of a black canvas.
    let loaded = 0;
    let total = 0;
    const track = <T,>(job: Promise<T>): Promise<T> => {
      total += 1;
      return job.then((value) => {
        loaded += 1;
        ctx.state.set({ assetsLoaded: loaded, assetsTotal: total });
        return value;
      });
    };
    const texture = (file: string): Promise<Texture> =>
      track(ctx.assets.texture(`assets/${file}`));
    const [
      enemy,
      viewmodel,
      weapon,
      sky,
      skyIbl,
      plaster,
      plasterNormal,
      plasterRough,
      brick,
      floor,
      floorNormal,
      floorRough,
      floorAo,
      concrete,
      concreteNormal,
      concreteRough,
      quaystone,
      quaystoneNormal,
      quaystoneRough,
      steel,
      steelNormal,
      steelRough,
      wood,
      woodNormal,
      paving,
      pavingNormal,
      pavingRough,
      audioBuffers,
    ] = await Promise.all([
      track(ctx.assets.model<LoadedModel>("assets/enemy-terrorist.glb")),
      track(ctx.assets.model<LoadedModel>("assets/player-viewmodel.glb")),
      track(ctx.assets.model<LoadedModel>("assets/weapon-ak47.glb")),
      texture("bayview-sky.jpg"),
      texture("bayview-sky-ibl.jpg"),
      texture("bayview-whitewash.jpg"),
      texture("bayview-whitewash-normal.jpg"),
      texture("bayview-whitewash-rough.jpg"),
      texture("bayview-brick.jpg"),
      texture("bayview-flagstone.jpg"),
      texture("bayview-flagstone-normal.jpg"),
      texture("bayview-flagstone-rough.jpg"),
      texture("bayview-flagstone-ao.jpg"),
      texture("bayview-concrete.jpg"),
      texture("bayview-concrete-normal.jpg"),
      texture("bayview-concrete-rough.jpg"),
      texture("bayview-quaystone.jpg"),
      texture("bayview-quaystone-normal.jpg"),
      texture("bayview-quaystone-rough.jpg"),
      texture("bayview-steel.jpg"),
      texture("bayview-steel-normal.jpg"),
      texture("bayview-steel-rough.jpg"),
      texture("bayview-wood.jpg"),
      texture("bayview-wood-normal.jpg"),
      texture("bayview-paving.jpg"),
      texture("bayview-paving-normal.jpg"),
      texture("bayview-paving-rough.jpg"),
      // Audio decodes alongside the textures rather than after them. Thirty cues is thirty
      // `decodeAudioData` calls; running them only once every model and texture had resolved
      // added their whole cost to the end of the boot instead of overlapping it with the image
      // decodes, which are the part actually holding the main thread.
      track(GameAudio.load(ctx.assets)),
    ]);
    const town: TownTextures = {
      plaster: { map: plaster, normal: plasterNormal, rough: plasterRough },
      brick: { map: brick, normal: plasterNormal, rough: plasterRough },
      floor: { map: floor, normal: floorNormal, rough: floorRough, ao: floorAo },
      concrete: { map: concrete, normal: concreteNormal, rough: concreteRough },
      quaystone: { map: quaystone, normal: quaystoneNormal, rough: quaystoneRough },
      steel: { map: steel, normal: steelNormal, rough: steelRough },
      wood: { map: wood, normal: woodNormal },
      paving: { map: paving, normal: pavingNormal, rough: pavingRough },
    };
    this.#assets = { enemy, viewmodel, weapon, sky, skyIbl, town };
    this.#audioBuffers = audioBuffers;
    this.#boot.load = Math.round(bootClock() - loadStarted);
    console.info(
      `TN_FPS_ASSETS_LOADED:enemy(${enemy.animations.length} clips),viewmodel,sky,town textures,audio(${this.#audioBuffers.size})`,
    );
  }

  override exit(): void {
    // Every enter builds a fresh bus. Without this the old one survives a restart
    // with its window gesture listeners and its looping ambience still live.
    this.#audio?.dispose();
    this.#audio = undefined;
    // The hook closes over this scene's player. Leaving it registered means a restart keeps
    // syncing the camera to the torn-down body until `enter` happens to overwrite it.
    onAfterPhysics(undefined);
  }

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const assets = this.#assets;
    if (assets === undefined) throw new Error("Town assets did not load.");

    const bootClock = (): number => globalThis.performance?.now() ?? 0;
    const enterStarted = bootClock();
    let phaseStarted = enterStarted;
    const phase = (name: string): void => {
      const now = bootClock();
      this.#boot[name] = Math.round(now - phaseStarted);
      phaseStarted = now;
    };

    const camera = ctx.camera as PerspectiveCamera;
    setupSky(ctx.scene, assets.sky, assets.skyIbl);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer);
    ctx.add(camera);

    // The bus rides the camera's listener and registers as an entity so the dev
    // overlay and playtests can read its counters. It queues until the first
    // key/click gesture unlocks the WebAudio context, then flushes.
    const audio = new GameAudio(camera, this.#audioBuffers ?? new Map(), ctx.scene);
    this.#audio = audio;
    ctx.entities.remove("audio");
    ctx.entities.add("audio", audio);
    audio.startAmbience();

    phase("render-setup");
    const materials = createTownMaterials(assets.town, assets.skyIbl);
    const town: Town = buildTown(materials);
    ctx.add(town.group);
    // DIAGNOSTIC (temporary): GPU-attribution ablation gates, read from the
    // host's localStorage so a device arm flips them without a rebuild.
    const ablate = (key: string): boolean =>
      globalThis.localStorage?.getItem(key) === "1";
    if (ablate("TN_ABLATE_TOWN")) town.group.visible = false;
    if (ablate("TN_ABLATE_SKY")) ctx.scene.background = null;
    if (ablate("TN_ABLATE_IBL")) ctx.scene.environment = null;
    phase("town");
    // Plates are raycast targets like any solid: without them in the list a round flies
    // straight through and scores whatever soldier happens to stand behind the plate.
    const plateMeshes: Object3D[] = [];
    town.targets.forEach((spec, index) => {
      const entity = `target-${index}`;
      ctx.entities.remove(entity);
      // The spec list is data; the plates themselves are entities so playtests can read them.
      const plate = new Target(
        {
          face: materials.plateFace,
          hit: materials.plateHit,
          frame: materials.plateFrame,
          steel: materials.steel,
        },
        spec,
      );
      // Plates live inside the town group like every other prop, so scene-wide
      // audits that traverse the town find them where they belong.
      town.group.add(plate.group);
      ctx.entities.add(entity, plate);
      plateMeshes.push(plate.plate);
    });

    // One fixed body per solid so the player slides along walls properly. These
    // colliders have no visual, so they take a bare `position` and never allocate a
    // carrier Object3D to hold a transform nothing reads.
    const staticBody = (
      centreX: number,
      centreY: number,
      centreZ: number,
      sx: number,
      sy: number,
      sz: number,
    ): void => {
      new RigidBody3D({
        physics: ctx.physics,
        position: { x: centreX, y: centreY, z: centreZ },
        shape: CollisionShape3D.box(sx, sy, sz),
        type: "fixed",
      });
    };
    for (const box of town.colliders) {
      staticBody(
        (box.min[0] + box.max[0]) / 2,
        (box.min[1] + box.max[1]) / 2,
        (box.min[2] + box.max[2]) / 2,
        box.max[0] - box.min[0],
        box.max[1] - box.min[1],
        box.max[2] - box.min[2],
      );
    }
    staticBody(0, -0.5, 0, TOWN_HALF * 2 + 4, 1, TOWN_HALF * 2 + 4);

    const playerSetup = ctx.entities.get<{
      readonly isObject3D?: boolean;
      readonly position: Vector3;
      readonly quaternion?: Quaternion;
    }>("player");
    ctx.entities.remove("player");
    const player = new FpsPlayer(ctx, camera);
    if (playerSetup?.isObject3D === true && playerSetup.position.lengthSq() > 1e-6) {
      player.mesh.position.copy(playerSetup.position);
      player.body.teleport(player.mesh.position);
      // A scenario can aim the spawn through the placeholder's rotation. Only the
      // look angles are taken (the body stays upright): forward's height is the
      // pitch, its heading the yaw — identity falls out as the constructor defaults.
      if (playerSetup.quaternion !== undefined) {
        const forward = new Vector3(0, 0, -1).applyQuaternion(playerSetup.quaternion);
        player.look.pitch = Math.asin(MathUtils.clamp(forward.y, -1, 1));
        player.look.yaw = Math.atan2(-forward.x, -forward.z);
      }
      player.syncCamera();
    }
    ctx.entities.add("player", player);
    // The camera is placed here, after rapier has written the solved transform, rather than at the
    // end of `player.update` where `mesh.position` is still last step's. See `onAfterPhysics`.
    // Split the physics step out of `outsideGame`.
    //
    // `outsideGame` proved the hitch is not in game logic, but it lumps four different things
    // together: the rapier step, the projection reconcile, the draw, and whatever the browser does
    // between callbacks. This hook fires immediately after rapier's plugin update, so the gap from
    // the end of the game frame to here is the physics step and nothing else — which is the one
    // suspect that scales with a firefight's worth of shards and pursuing soldiers.
    onAfterPhysics(() => {
      const now = clock();
      if (gameFrameEndedAt > 0) frameStats.chargeSection("physics", now - gameFrameEndedAt);
      player.syncCamera();
    });
    // Thumb controls. Registered so a scenario can assert a finger actually drove the player,
    // and read every tick below before the player consumes its input.
    // Two seconds in, every pooled pipeline has been through a real draw, so the unused slots can
    // stop being submitted. Worth ~a third of the draw calls on a phone.
    ctx.after(2, () => {
      decals.settle();
      smoke.settle();
      impacts.settle();
      rifle.settlePools();
      breakables.settle();
      enemyFlashes.settle();
      playerTracers.settle();
      enemyTracers.settle();
    });

    const touch = new TouchControls();
    ctx.entities.remove("touch");
    ctx.entities.add("touch", touch);
    // Strides are distance-driven inside the player; the scene owns where they sound.
    player.onFootstep = () => audio.localStep();
    const rifle = new Rifle(
      camera,
      assets.viewmodel.scene as Object3D,
      assets.viewmodel.animations,
      ctx.scene,
    );
    ctx.entities.add("rifle", rifle);
    rifle.onMagOut = () => audio.magOut();
    rifle.onMagIn = () => audio.magIn();

    // Five soldiers patrol the ground lanes, one per route — a full T side holding
    // the town. The model asset is shared; each Enemy normalises its own copy out of
    // the cached scene only once, so later soldiers clone the prepared rig.
    const enemySetup = ctx.entities.get<{
      readonly isObject3D?: boolean;
      readonly position: Vector3;
    }>("enemy");
    ctx.entities.remove("enemy");
    // A scenario that shoots a soldier needs one who does not patrol. Placing the
    // optional "enemy-frozen" placeholder turns soldier 0 into a sentry standing at
    // that spot for the whole round: presence is the flag, position is the spawn
    // (facing +z, toward a player placed north of him). It takes precedence over the
    // plain "enemy" placement when both are present. The placeholder parks off-map
    // until placed (see game.ts), so an origin spawn is still a real placement.
    const frozenSetup = ctx.entities.get<{
      readonly isObject3D?: boolean;
      readonly position: Vector3;
    }>("enemy-frozen");
    ctx.entities.remove("enemy-frozen");
    const frozenSpawn =
      frozenSetup?.isObject3D === true && frozenSetup.position.y > -100
        ? frozenSetup.position.clone()
        : undefined;
    const navBounds = { min: -TOWN_HALF - 1, max: TOWN_HALF + 1 };
    const enemies: Enemy[] = [];
    for (let index = 0; index < town.enemyRoutes.length; index += 1) {
      // Every soldier needs its own fully retargeted rig: the class mutates scale and pose.
      const model = cloneSkeleton(assets.enemy.scene);
      const soldier = new Enemy(
        ctx,
        model,
        assets.enemy.animations,
        town.colliders,
        // The rifle is rigged too (it carries Grip_Bone), so it needs a retargeted
        // clone as well — a plain clone shares the original's skeleton and renders
        // the bind pose at authored scale, which reads as a giant floating AK.
        cloneSkeleton(assets.weapon.scene),
        index === 0 && frozenSpawn !== undefined
          ? {
              route: [frozenSpawn],
              navBounds,
              decks: town.decks,
              frozen: true,
            }
          : {
              route: town.enemyRoutes[index],
              navBounds,
              decks: town.decks,
            },
      );
      if (index === 0 && frozenSpawn !== undefined) {
        soldier.group.position.copy(frozenSpawn);
        soldier.group.updateWorldMatrix(true, true);
      } else if (
        index === 0 &&
        enemySetup?.isObject3D === true &&
        enemySetup.position.lengthSq() > 1e-6
      ) {
        soldier.group.position.copy(enemySetup.position);
        soldier.group.updateWorldMatrix(true, true);
      }
      ctx.add(soldier.group);
      if (ablate("TN_ABLATE_SOLDIERS")) soldier.group.visible = false;
      ctx.entities.add(index === 0 ? "enemy" : `enemy-${index}`, soldier);
      // Shouted callouts on spotting, hearing rounds and being hit; the audio
      // sink throttles so five men reacting never stack into a wall of shouting.
      soldier.voice = {
        spot: (at) => audio.soldierSpot(at),
        chase: (at) => audio.soldierChase(at),
        pain: (at) => audio.soldierPain(at),
        death: (at) => audio.soldierDeath(at),
      };
      enemies.push(soldier);
    }

    // Vessels standing about the town that come apart when they are shot. They are the one thing
    // in the world that answers a round with more than a mark, which is what stops the town
    // reading as a shooting gallery with scenery painted on it.
    const breakables = new BreakableField(ctx.scene, ctx.physics, () => ctx.random());
    for (const spot of BREAKABLE_SPOTS) {
      breakables.add(spot.kind, { x: spot.x, y: 0, z: spot.z }, spot.yaw);
    }
    ctx.entities.remove("breakables");
    ctx.entities.add("breakables", breakables);

    // Hitscan picks against an explicit list: the town solids, the plates and the
    // soldier proxies. Raycasting the whole scene would also hit the viewmodel welded
    // to the camera and score every shot as a miss at 0.4 m.
    phase("soldiers");
    const hittable: Object3D[] = [
      ...town.hittable,
      ...plateMeshes,
      ...breakables.hittable(),
      ...enemies.map((e) => e.hitbox),
    ];
    // Sight lines treat a standing plate like the old range did: thin dressing the
    // LOS check skips by its userData, but a solid that can still stop a round.
    // Sight lines are answered in two stages, cheap first.
    //
    // The raycast on its own cost 15.4 ms of a 16.3 ms frame across five soldiers — the whole
    // mid-round hitch, in one call. Replacing it outright with a box test against the town's
    // colliders was fast but wrong: a collider is a solid slab where the building has a doorway,
    // so soldiers went blind through openings they should see through, and
    // `enemy-reaches-walkway` started failing about half the time.
    //
    // So the box test is a pre-filter, not a replacement. Colliders are conservative — they cover
    // at least as much as the walls they stand for — which means "no box in the way" is a
    // trustworthy *clear*, and that is the common case while a firefight is in the open. Only a
    // box-blocked line needs the exact answer, and that is where the doorways are.
    const boxes = new BoxOccluders(town.colliders);
    ctx.entities.remove("occluders");
    ctx.entities.add("occluders", boxes);
    const occluders: Object3D[] = [...town.hittable, ...plateMeshes];

    const lineOfSight = (from: Vector3, to: Vector3): boolean => {
      if (boxes.clear(from, to)) return true;
      const direction = new Vector3().subVectors(to, from);
      const distance = direction.length();
      if (distance < 0.001) return true;
      for (const hit of ctx.raycastAll({
        direction: direction.multiplyScalar(1 / distance),
        far: distance - 0.2,
        origin: from,
        targets: occluders,
      })) {
        // Plates and paint are thin dressing; only solids block sight.
        if (hit.object.userData.target !== undefined) continue;
        return false;
      }
      return true;
    };

    // Impact bursts: flash, sparks, chips and dust in one pooled system keyed by
    // surface — steel sprays fast bright sparks, stone/plaster throw pale chips
    // under a dust cloud, wood spits brown splinters. One expanding circle read
    // as a decal; a burst is what makes a hit look like material answering.
    const impacts = new ImpactBursts(ctx.scene, () => ctx.random());
    // Bullet holes. They stay put: a mark that fades tells the player their rounds went nowhere.
    // What colour the crushed rim comes out is per material — steel burns bare and cold, plaster
    // and stone go pale, wood darkens. See `decals.ts` for why the pool is shaped this way.
    const decals = new DecalField(ctx.scene, {
      countPerVariant: 56,
      map: bulletHoleTexture(),
      size: 0.13,
      tints: {
        plaster: 0xf3ead8,
        stone: 0xd2cbbb,
        steel: 0xb6bcc4,
        wood: 0x8a6a44,
      },
    });
    ctx.entities.remove("decals");
    ctx.entities.add("decals", decals);
    // `hit.face.normal` is object-local; transform it into world space before any
    // spawn math, or rotated meshes send their bursts into the wall.
    const impactNormal = new Vector3();
    const impactUp = new Vector3(0, 1, 0);
    // Player rounds trail warm white; the enemy's are red so you can tell incoming from
    // outgoing at a glance, which is the whole point of seeing a trajectory at all.
    // Unit-length tapered cylinder along +Y, base at the origin: scaling y stretches it end to
    // end. Tapered — the far end is the glowing slug's head, the near end its thinning tail;
    // a uniform tube read as a chalk line.
    const tracerGeometry = new CylinderGeometry(0.009, 0.002, 1, 6, 1, true);
    tracerGeometry.translate(0, 0.5, 0);
    const tracerMaterial = (colour: number): MeshBasicMaterial =>
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: colour,
        depthWrite: false,
        // A tracer is a hot gas trail, not a painted line. At 0.9 the old 1.7 cm cylinder read
        // as chalk drawn across the frame; thin and half-transparent over the additive blend is
        // what makes it a thing that glowed rather than a thing that was drawn.
        opacity: 0.55,
        transparent: true,
      });
    const playerTracers = new TracerPool3D(ctx.scene, {
      count: 12,
      geometry: tracerGeometry,
      material: tracerMaterial(0xffe6b0),
    });
    const enemyTracers = new TracerPool3D(ctx.scene, {
      count: 16,
      geometry: tracerGeometry,
      material: tracerMaterial(0xff6a4d),
    });
    // Per-shot variation, computed here so replays stay seeded: two rounds must never read
    // as one drawn line, and a point-blank round dies faster than a far one. The pool only
    // applies these; the numbers are this game's.
    const tracerShot = (distance: number): ITracerSpawnOptions => ({
      // Long enough to see the round travel, short enough that it is gone before the next one.
      lifetime: MathUtils.clamp(distance / 400, 0.025, 0.13),
      segmentLength: 1.5 + ctx.random() * 0.8,
      widthScale: 0.7 + ctx.random() * 0.5,
    });
    /**
     * Not every round is a tracer. A real belt carries one in four or five, and that is not a
     * detail — it is the whole reason tracers read as individual rounds instead of a continuous
     * beam. Drawing one per shot at 600 rounds a minute paints a solid stripe down the lane.
     *
     * The enemy's are more frequent because they are the player's only warning of where incoming
     * fire is coming from; the player's own are sparse because they already know.
     */
    let playerTracerCursor = 0;
    let enemyTracerCursor = 0;
    const playerTracerDue = (): boolean => playerTracerCursor++ % 4 === 0;
    const enemyTracerDue = (): boolean => enemyTracerCursor++ % 2 === 0;
    // One hoisted rng closure shared by every per-shot spawn: a closure literal at a
    // call site is a fresh allocation on every trigger pull.
    const shotRng = (): number => ctx.random();

    let elapsed = 0;
    let hitFlash = 0;
    let lastPhase: GameState["phase"] = "playing";
    let lastTickSecond = Number.POSITIVE_INFINITY;
    const eye = new Vector3();

    const fire = (frameCtx: GameCtx, aimRay: { origin: Vector3; direction: Vector3 }): void => {
      if (!rifle.fire()) return;
      audio.playerShot();
      eye.copy(aimRay.origin);
      const direction = aimRay.direction.clone().normalize();
      player.recordFiringDirection(direction);
      const hit = frameCtx.raycast({
        direction,
        far: RANGE_METRES,
        origin: eye,
        targets: hittable,
      });
      // Every soldier within earshot reacts, not just the closest one.
      for (const soldier of enemies) soldier.hearShot(eye.clone());
      // The trail is drawn whether or not the round connects — a miss you cannot see is a
      // miss you cannot correct.
      const barrel = rifle.barrelRay();
      const distance = hit === undefined ? RANGE_METRES : hit.point.distanceTo(eye);
      if (playerTracerDue()) {
        playerTracers.spawn(barrel.origin, barrel.direction, distance, tracerShot(distance));
      }
      playerFlash.spawn(barrel.origin, barrel.direction, shotRng);
      if (hit === undefined) return;

      const target = hit.object.userData.target as Target | undefined;
      if (target !== undefined) {
        if (!target.scorable) return;
        const value = target.strike(frameCtx);
        if (value > 0) {
          frameCtx.state.set((state) => ({
            score: state.score + value,
            targetsHit: state.targetsHit + 1,
          }));
          hitFlash = 0.12;
          audio.plateChime(hit.point);
        }
        return;
      }
      const struck = hit.object.userData.enemy as Enemy | undefined;
      if (struck !== undefined) {
        audio.bodyImpact(hit.point);
        const multiplier =
          hit.point.y >= struck.headZoneMinY ? 4 : hit.point.y < struck.legZoneMaxY ? 0.7 : 1;
        struck.recordHit(multiplier, direction);
        const earned = struck.hurt(frameCtx, ROUND_DAMAGE * multiplier);
        if (earned > 0) {
          frameCtx.state.set((state) => ({
            score: state.score + earned,
            targetsHit: state.targetsHit + 1,
          }));
          hitFlash = 0.12;
        }
        return;
      }
      impactNormal.copy(hit.face?.normal ?? impactUp).transformDirection(hit.object.matrixWorld);
      // A vessel answers a round by coming apart, not by taking a mark. Ask first: the breakable
      // branch consumes the hit, so nothing below stamps a bullet hole into geometry that is no
      // longer there.
      if (breakables.shatter(hit.object, hit.point, direction) !== undefined) {
        impacts.spawn(hit.point, impactNormal, "stone");
        audio.shatter("stone", hit.point);
        return;
      }
      // One tag, resolved once: the builder stamped `userData.surface` on every
      // solid at construction, so audio and VFX read the same answer here
      // instead of each walking its own name rules.
      const surface = resolveSurface(hit.object);
      impacts.spawn(hit.point, impactNormal, surface);
      audio.impact(surface, hit.point);
      // The mark outlives the burst. `impactNormal` is already in world space above; handing a
      // raycast's object-local `face.normal` straight to a decal buries it in the wall.
      decals.place(hit.point, impactNormal, surface, 0.82 + ctx.random() * 0.45);
    };

    // A muzzle flash is three things at once: a bright star-silhouette card, a light
    // that touches the world, and smoke that outlives both. One round glow alone
    // reads as a lamp switching on; the uneven rays are what say "gunshot".
    //
    // One flash per shooter, never one shared between them. The squad used to share a single
    // quad and a single lifetime, so any soldier firing reset it for all of them — under
    // sustained fire from five men the lifetime never reached zero and the flash sat lit at the
    // last muzzle that fired, which is the "flash that never gets destroyed". See
    // `MuzzleFlashPool` for the whole story.
    const smokeSprite = softCircleDataTexture(64, 0.05);
    const enemyFlashes = new MuzzleFlashPool(ctx.scene, 6, {
      colour: 0xffd79a,
      forwardOffset: 0.22,
      life: 0.05,
      lightColour: 0xffb347,
      lightDistance: 11,
      // Brighter than before but over a shorter life. Peak brightness is what says "explosion at
      // the muzzle"; duration is what makes the same light read as a lamp someone switched on.
      lightIntensity: 44,
      size: scale.muzzleFlash * 1.25,
    });
    // Registered so a scenario can prove a squad's flashes retire. Sustained fire from five
    // soldiers is exactly the case that used to hold the old single shared flash open forever.
    ctx.entities.remove("enemy-flashes");
    ctx.entities.add("enemy-flashes", {
      debug: (): { peakOpacity: number } => ({ peakOpacity: enemyFlashes.peakOpacity() }),
    });

    // The player's own flash is drawn in world space at the measured muzzle tip:
    // the star card reads on camera and the light kicks the wall ahead of the
    // barrel for a frame. Rifle's suppressed cone stays as the tight forward core.
    const playerFlash = new MuzzleFlash(ctx.scene, {
      colour: 0xffd9a0,
      forwardOffset: 0.06,
      life: 0.06,
      lightColour: 0xffb347,
      lightDistance: 14,
      lightIntensity: 40,
      size: 0.34,
    });

    const smokeMaterial = new MeshBasicMaterial({
      color: 0xb9bec6,
      depthWrite: false,
      map: smokeSprite,
      opacity: 0.5,
      transparent: true,
    });
    // Enemy muzzle smoke rides the same pooled-billboard mechanism as the player's.
    // Scratch vectors keep the fire path allocation-free; the three random draws per
    // puff keep their original order so seeded replays stay identical.
    const smoke = new PooledBillboards(ctx.scene, {
      count: 10,
      geometry: new PlaneGeometry(0.4, 0.4),
      materialPrototype: smokeMaterial,
    });
    const smokeAt = new Vector3();
    const smokeDrift = new Vector3();
    const spawnSmoke = (at: Vector3, forward: Vector3, ctxFrame: GameCtx): void => {
      for (let index = 0; index < 2; index += 1) {
        const driftX = (ctxFrame.random() - 0.5) * 0.5;
        const driftY = 0.55 + ctxFrame.random() * 0.35;
        const driftZ = (ctxFrame.random() - 0.5) * 0.5;
        smoke.spawn({
          at: smokeAt.copy(at).addScaledVector(forward, 0.3 + index * 0.16),
          drift: smokeDrift.set(driftX, driftY, driftZ),
          life: 0.75,
          opacity: 0.5,
          scaleFrom: 0.35,
          scaleTo: 1.475,
        });
      }
    };

    const hooks = {
      lineOfSight,
      damagePlayer: (amount: number): void => player.hurt(amount),
      onMuzzleFlash: (at: Vector3, direction: Vector3, distance: number): void => {
        enemyFlashes.spawn(at, direction, shotRng);
        if (enemyTracerDue()) enemyTracers.spawn(at, direction, distance, tracerShot(distance));
        spawnSmoke(at, direction, ctx);
        audio.enemyShot(at);
        audio.nearMiss(distance);
      },
      onFootstep: (at: Vector3): void => audio.soldierStep(at),
    };

    // The scene is built: geometry, physics, soldiers and the viewmodel all
    // exist. Flip the boot flag here rather than when the last byte arrived,
    // because the black canvas lasts until the first frame actually draws.
    phase("effects");
    this.#boot.enterTotal = Math.round(bootClock() - enterStarted);
    // Wall clock since navigation: the number a player actually waits, as opposed to the sum of
    // the phases below it. The gap between the two is module load, renderer bring-up and the
    // first pipeline compilation, which is where the dev server's unbundled modules show up.
    this.#boot.sinceNavigation = Math.round(bootClock());
    console.info(`TN_FPS_BOOT_MS:${JSON.stringify(this.#boot)}`);
    ctx.state.set({ ready: true });

    // Nothing else in this project can see a stutter: typecheck, lint and every existing
    // scenario pass at four frames a second. This is the one thing that can fail on one.
    const frameStats = new FrameStats();
    /** Stamped when the game frame ends, so the post-physics hook can bill the step. */
    let gameFrameEndedAt = 0;
    ctx.entities.remove("frame");
    ctx.entities.add("frame", frameStats);
    // Where the squad's frame goes. "enemies cost 13 ms" is not actionable; this says which
    // stage of a soldier's update spent it.
    ctx.entities.remove("squad");
    ctx.entities.add("squad", { debug: () => squadProfile() });

    // What the renderer actually drew last frame, so a scenario can fail on an empty picture.
    //
    // Every gate in this project is blind to how the game looks, and that is not a slogan: a
    // `prewarm(ctx.scene)` call once put every material in the town at zero opacity, and the whole
    // suite stayed green. Decals still "placed", soldiers still pathfound, diagnostics were clean,
    // and the frame budget *improved*, because a level nobody draws is cheap. `survives` checks for
    // a nonblank frame and passed too — the sky and the clouds are not blank.
    //
    // Triangles are the assertion that would have caught it. A game drawing its level submits
    // hundreds of thousands of them; a game drawing only its sky submits a handful.
    const renderInfo = (): {
      drawCalls: number;
      triangles: number;
      invisibleMeshes: number;
    } => {
      // drawCalls/triangles are the totals captured inside the frame callback
      // (top of the returned frame callback below), because `renderer.info`
      // resets at the start of each render — a between-frames read sees zeros.
      // The capture lags one frame, which a settled assertion does not care about.
      const invisibleMeshes = countInvisibleMeshes();
      return {
        drawCalls: lastWorldDraws,
        triangles: lastWorldTriangles,
        invisibleMeshes,
      };
    };
    let lastWorldDraws = 0;
    let lastWorldTriangles = 0;
    const countInvisibleMeshes = (): number => {
      // Meshes the renderer is still drawing that cannot possibly show up: fully transparent.
      //
      // Counting pixels does not catch this. A scene whose materials are all at zero opacity
      // submits *more* triangles than a healthy one, because transparency pushes every mesh off
      // the projection's batched lane, and the resulting sky-only picture is neither blank nor
      // notably brighter than the real one — both a nonblank-ratio and a dark-pixel-ratio
      // assertion passed on it. The invariant that actually holds is simpler: nothing in this
      // game's level is supposed to be invisible, so any solid mesh at zero opacity is a defect.
      let invisibleMeshes = 0;
      ctx.scene.traverse((object) => {
        const mesh = object as { isMesh?: boolean; material?: unknown };
        if (mesh.isMesh !== true || mesh.material === undefined) return;
        const surfaces = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const surface of surfaces) {
          const material = surface as { opacity?: number; visible?: boolean };
          if (material.visible === false) continue;
          if ((material.opacity ?? 1) <= 0) invisibleMeshes += 1;
        }
      });
      return invisibleMeshes;
    };
    ctx.entities.remove("render");
    ctx.entities.add("render", { debug: renderInfo });
    // DIAGNOSTIC (temporary): which (geometry, material, castShadow, receiveShadow, layers)
    // groups sit below the projection's 4-member floor and on the exact lane? Prints once a
    // few seconds in, from the live scene, so draw-cut work targets real populations.
    ctx.after(6, () => {
      const groups = new Map<string, { count: number; names: Set<string> }>();
      const pathOf = (object: { name?: string; parent?: unknown }): string => {
        const parts: string[] = [];
        let node: { name?: string; parent?: unknown } | undefined = object;
        while (node !== undefined && node !== null && parts.length < 3) {
          if (node.name) parts.unshift(node.name);
          node = node.parent as { name?: string; parent?: unknown } | undefined;
        }
        return parts.join("/") || "(root)";
      };
      ctx.scene.traverse((object) => {
        const mesh = object as {
          isMesh?: boolean; geometry?: { uuid?: string }; material?: unknown;
          castShadow?: boolean; receiveShadow?: boolean; visible?: boolean; layers?: { mask: number };
          renderOrder?: number; name?: string; parent?: unknown;
        };
        if (mesh.isMesh !== true || mesh.geometry === undefined) return;
        if ((mesh as unknown as { visible?: boolean }).visible !== true) return;
        const material = mesh.material as { uuid?: string } | undefined;
        if (material === undefined || Array.isArray(mesh.material)) return;
        const key = [
          mesh.geometry?.uuid?.slice(0, 8) ?? "?",
          material.uuid?.slice(0, 8) ?? "?",
          mesh.castShadow === true ? 1 : 0,
          mesh.receiveShadow === true ? 1 : 0,
        ].join("|");
        const entry = groups.get(key) ?? { count: 0, names: new Set<string>() };
        entry.count += 1;
        const own = (mesh as unknown as { name?: string }).name;
        entry.names.add(own || `⟨${pathOf(mesh)}⟩`);
        groups.set(key, entry);
      });
      const summary = new Map<string, number>();
      for (const g of groups.values()) {
        if (g.count >= 4) continue;
        for (const name of g.names) summary.set(name, (summary.get(name) ?? 0) + g.count);
      }
      const ranked = [...summary.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
      console.info(
        `TN_DRAW_DIAG:${JSON.stringify({
          groups: groups.size,
          belowFloorMeshes: [...groups.values()].filter((g) => g.count < 4).reduce((n, g) => n + g.count, 0),
          byMeshName: Object.fromEntries(ranked),
        })}`,
      );
    });
    const clock = (): number => globalThis.performance?.now() ?? 0;
    // Startup is not gameplay: pipeline compilation and every material's first draw land in the
    // opening second and cannot hitch twice. Measuring them alongside play hides real stalls.
    let warmupLeft = 1.5;

    return (frameCtx, dt) => {
      const frameEntered = clock();
      // The totals of the frame that just finished, read before this frame's
      // render resets `renderer.info` — the `render` entity serves these to the
      // draw-budget scenario. A between-frames read would see zeros.
      const lastInfo = ctx.renderer.info as
        | { render?: { drawCalls?: number; triangles?: number } }
        | undefined;
      lastWorldDraws = lastInfo?.render?.drawCalls ?? 0;
      lastWorldTriangles = lastInfo?.render?.triangles ?? 0;
      frameStats.begin(frameEntered);
      frameStats.markFrame(frameEntered);
      if (warmupLeft > 0) {
        warmupLeft -= dt;
        if (warmupLeft <= 0) {
          frameStats.resetWindow();
          resetSquadProfile();
        }
      }
      if (frameCtx.input.justPressed("restart")) {
        frameCtx.state.set(Play.initialState);
        frameCtx.state.flush();
        void frameCtx.goto("play");
        return;
      }

      // Every shot effect decays outside the phase gate. An early return with a quad still lit
      // leaves it frozen in the world behind the end screen, which is indistinguishable from an
      // effect that failed to clean itself up.
      frameStats.mark(clock());
      enemyFlashes.update(dt, eye);
      impacts.update(dt, eye);
      playerFlash.update(dt, eye);
      breakables.update(dt);
      smoke.update(dt, eye);
      rifle.updateSmoke(dt, eye);
      playerTracers.update(dt);
      enemyTracers.update(dt);
      frameStats.measure("effects", clock());
      // Peak-voice tracking runs outside the phase gate so the end screen still samples.
      frameStats.mark(clock());
      audio.sample(dt);
      frameStats.measure("audio", clock());

      const state = frameCtx.state.getState();
      if (state.phase !== "playing") {
        // The run is over: hold the frame, keep looking around, wait for Enter.
        //
        // The viewmodel's muzzle cone and its point light still have to retire. `rifle.update` is
        // the pose-and-animation half and belongs to gameplay, but a round fired on the very frame
        // the clock expired would otherwise leave the cone and the light burning on screen for as
        // long as the end card is up.
        rifle.decay(dt);
        player.update(frameCtx, dt, false);
        return;
      }

      elapsed += dt;
      hitFlash = Math.max(0, hitFlash - dt * 2.4);
      const timeRemaining = Math.max(0, RUN_SECONDS - elapsed);

      // Any press on the surface buys the pointer, which is what makes the mouse steer.
      // This is deliberately not folded into the `fire` branch: gating it on the fire action
      // means the view stays stuck until you take a shot, and aiming or simply clicking to
      // start would leave the camera dead. Keyboard shots never reach here, so the playtests
      // never ask for a lock they did not earn.
      const pointer = frameCtx.input.raw.pointer;
      // Never on a touch screen: there is no pointer to lock, the request is refused or prompts,
      // and every thumb press would ask again. Thumb input needs no capture to steer.
      if (pointer.down && !pointer.captured && !touch.engaged) {
        frameCtx.input.captureMouse();
        // The click that buys the mouse also confirms it: the UI cue's one home,
        // since this game's only "menu" is the pointer lock itself.
        audio.uiClick();
      }

      frameStats.mark(clock());
      player.touch = touch.update(frameCtx);
      player.update(frameCtx, dt, !rifle.reloading);
      frameStats.measure("player", clock());
      const moveVector = frameCtx.input.vector("move");
      const aimRay = player.aimRay();
      rifle.converge(aimRay.origin, aimRay.direction);
      rifle.update(dt, player.aiming, Math.min(1, Math.hypot(moveVector.x, moveVector.y)));
      // Held, not tapped. The trigger is polled every frame and `Rifle` decides which of those
      // frames sends a round, so a held button fires at the weapon's cyclic rate instead of asking
      // the player to produce ten clicks a second by hand.
      if (frameCtx.input.pressed("fire") || player.touch?.fire === true) fire(frameCtx, aimRay);
      if (frameCtx.input.justPressed("reload") || player.touch?.reload === true) {
        rifle.reload(frameCtx);
      }

      eye.set(player.eye.x, player.eye.y, player.eye.z);
      frameStats.mark(clock());
      beginSquadFrame();
      for (const soldier of enemies) {
        soldier.update(frameCtx, dt, eye, 0, hooks);
      }
      frameStats.measure("enemies", clock());

      const hitCount = frameCtx.state.getState().targetsHit;
      let phase: GameState["phase"] = "playing";
      if (hitCount >= TARGET_GOAL) phase = "complete";
      else if (player.health <= 0 || timeRemaining <= 0) phase = "failed";

      // The clock's last ten seconds tick once per remaining second, and the round
      // ends on its own sting. Both fire exactly once per transition.
      const tickSecond = Math.ceil(timeRemaining);
      if (timeRemaining > 0 && timeRemaining <= 10 && tickSecond !== lastTickSecond) {
        lastTickSecond = tickSecond;
        audio.tick();
      }
      if (phase !== lastPhase) {
        if (phase === "complete") audio.roundEnd(true);
        else if (phase === "failed") audio.roundEnd(false);
        lastPhase = phase;
      }

      frameStats.mark(clock());
      frameCtx.state.set({
        aiming: player.aiming,
        ammo: rifle.ammo,
        blips: enemies.map((soldier) => ({
          alive: soldier.alive,
          x: soldier.group.position.x,
          z: soldier.group.position.z,
        })),
        distanceMoved: player.distanceMoved,
        health: player.health,
        hitFlash,
        phase,
        playerX: player.mesh.position.x,
        playerYaw: player.look.yaw,
        playerZ: player.mesh.position.z,
        reloads: rifle.reloads,
        reserve: rifle.reserve,
        score: frameCtx.state.getState().score,
        shots: rifle.shots,
        timeRemaining,
      });
      frameStats.measure("state", clock());
      if (phase !== "playing") frameCtx.state.flush();
      // Everything the game does this frame. Subtracting it from the frame delta leaves the time
      // spent outside this callback — the physics step, the scene projection and the draw — which
      // is the only way to tell "our code is slow" apart from "the engine is".
      frameStats.measure("gameFrame", clock());
      gameFrameEndedAt = clock();
    };
  }
}
