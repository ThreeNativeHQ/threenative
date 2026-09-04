import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import type { AnimationClip, Group, Object3D, PerspectiveCamera, Texture } from "three";
import {
  AdditiveBlending,
  Mesh as MeshClass,
  MeshBasicMaterial,
  Object3D as Object3DClass,
  PlaneGeometry,
  Raycaster,
  Vector3,
} from "three";
import { Enemy } from "../entities/Enemy.js";
import { FpsPlayer } from "../entities/FpsPlayer.js";
import { MAGAZINE, RESERVE, Rifle } from "../entities/Rifle.js";
import type { Target } from "../entities/Target.js";
import { setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { buildRange, type Range } from "../render/range.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

const RUN_SECONDS = 60;
const TARGET_GOAL = 12;
const RANGE_METRES = 60;
const ROUND_DAMAGE = 10;
/** 4x in the top 12% of a body, 0.7x below a third of it. */
const HEAD_FRACTION = 0.88;
const LEG_FRACTION = 1 / 3;

type LoadedModel = { scene: Group; animations: AnimationClip[] };

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    ammo: MAGAZINE,
    distanceMoved: 0,
    health: 100,
    hitFlash: 0,
    phase: "playing",
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
        sky: Texture;
        surface: Texture;
        targetFace: Texture;
        targetHit: Texture;
      }
    | undefined;

  override async load(ctx: GameCtx): Promise<void> {
    const [enemy, viewmodel, sky, surface, targetFace, targetHit] = await Promise.all([
      ctx.assets.model<LoadedModel>("assets/enemy-terrorist.glb"),
      ctx.assets.model<LoadedModel>("assets/player-viewmodel.glb"),
      ctx.assets.texture("assets/sky.jpg"),
      ctx.assets.texture("assets/ue-test-surface.jpg"),
      ctx.assets.texture("assets/range-target-face.png"),
      ctx.assets.texture("assets/range-target-face-hit.png"),
    ]);
    this.#assets = { enemy, viewmodel, sky, surface, targetFace, targetHit };
    console.info(
      `TN_FPS_ASSETS_LOADED:enemy(${enemy.animations.length} clips),viewmodel,sky,3 textures`,
    );
  }

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const assets = this.#assets;
    if (assets === undefined) throw new Error("Range assets did not load.");

    const camera = ctx.camera as PerspectiveCamera;
    setupSky(ctx.scene, assets.sky);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer, ctx.scene, camera);
    ctx.add(camera);

    const materials = createMaterials({
      surface: assets.surface,
      targetFace: assets.targetFace,
      targetHit: assets.targetHit,
    });
    const range: Range = buildRange(materials);
    ctx.add(range.group);

    // One fixed body per solid so the player slides along the yard properly.
    // `RigidBody3D` has no `position` option — unlike `Area3D` — so each static
    // body needs a carrier Object3D holding the transform.
    const staticBody = (
      centreX: number,
      centreY: number,
      centreZ: number,
      sx: number,
      sy: number,
      sz: number,
    ): void => {
      const carrier = new Object3DClass();
      carrier.position.set(centreX, centreY, centreZ);
      new RigidBody3D({
        object: carrier,
        physics: ctx.physics,
        shape: CollisionShape3D.box(sx, sy, sz),
        type: "fixed",
      });
    };
    for (const box of range.colliders) {
      staticBody(
        (box.min[0] + box.max[0]) / 2,
        (box.min[1] + box.max[1]) / 2,
        (box.min[2] + box.max[2]) / 2,
        box.max[0] - box.min[0],
        box.max[1] - box.min[1],
        box.max[2] - box.min[2],
      );
    }
    staticBody(0, -0.5, 0, 40, 1, 40);

    const player = new FpsPlayer(ctx, camera);
    ctx.entities.add("player", player);
    const rifle = new Rifle(camera, assets.viewmodel.scene as Object3D, assets.viewmodel.animations);
    ctx.entities.add("rifle", rifle);

    const enemy = new Enemy(
      assets.enemy.scene as Object3D,
      assets.enemy.animations,
      range.colliders,
    );
    ctx.add(enemy.group);
    ctx.entities.add("enemy", enemy);

    // Hitscan picks against an explicit list: the yard, the plates and the enemy
    // proxy. Raycasting the whole scene would also hit the viewmodel welded to
    // the camera and score every shot as a miss at 0.4 m.
    const hittable: Object3D[] = [...range.hittable, enemy.hitbox];
    const raycaster = new Raycaster();
    raycaster.far = RANGE_METRES;
    const losCaster = new Raycaster();
    const occluders: Object3D[] = [...range.hittable];

    const lineOfSight = (from: Vector3, to: Vector3): boolean => {
      const direction = new Vector3().subVectors(to, from);
      const distance = direction.length();
      if (distance < 0.001) return true;
      losCaster.set(from, direction.multiplyScalar(1 / distance));
      losCaster.far = distance - 0.2;
      for (const hit of losCaster.intersectObjects(occluders, false)) {
        // Plates and the paint are thin dressing; only solids block sight.
        if (hit.object.userData.target !== undefined) continue;
        return false;
      }
      return true;
    };

    // Impact puffs: a small ring of additive quads reused round-robin, so a
    // shot that lands on concrete reads as a hit even at 30 m.
    const impactMaterial = new MeshBasicMaterial({
      blending: AdditiveBlending,
      color: 0xdfe4ea,
      depthWrite: false,
      opacity: 0.85,
      transparent: true,
    });
    const impacts = Array.from({ length: 8 }, () => {
      const puff = new MeshClass(new PlaneGeometry(0.26, 0.26), impactMaterial);
      puff.visible = false;
      ctx.add(puff);
      return { life: 0, mesh: puff };
    });
    let impactCursor = 0;
    const spawnImpact = (at: Vector3, normal: Vector3): void => {
      const slot = impacts[impactCursor % impacts.length];
      if (slot === undefined) return;
      impactCursor += 1;
      slot.mesh.position.copy(at).addScaledVector(normal, 0.02);
      slot.mesh.lookAt(at.clone().add(normal));
      slot.mesh.scale.setScalar(0.6);
      slot.mesh.visible = true;
      slot.life = 0.18;
    };

    let elapsed = 0;
    let hitFlash = 0;
    const eye = new Vector3();

    const fire = (frameCtx: GameCtx): void => {
      if (!rifle.fire()) return;
      const forward = player.forward;
      eye.set(player.eye.x, player.eye.y, player.eye.z);
      raycaster.set(eye, new Vector3(forward.x, forward.y, forward.z).normalize());
      raycaster.far = RANGE_METRES;
      const hits = raycaster.intersectObjects(hittable, false);
      enemy.hearShot(eye.clone());
      const hit = hits[0];
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
        }
        return;
      }
      spawnImpact(hit.point, hit.face?.normal ?? new Vector3(0, 1, 0));
      const struck = hit.object.userData.enemy as Enemy | undefined;
      if (struck !== undefined) {
        const local = (hit.point.y - struck.bodyBase) / struck.bodyHeight;
        const multiplier = local >= HEAD_FRACTION ? 4 : local < LEG_FRACTION ? 0.7 : 1;
        const earned = struck.hurt(frameCtx, ROUND_DAMAGE * multiplier);
        if (earned > 0) {
          frameCtx.state.set((state) => ({
            score: state.score + earned,
            targetsHit: state.targetsHit + 1,
          }));
          hitFlash = 0.12;
        }
      }
    };

    // A soldier firing at you has to read from the far end of a 34 m yard, so the
    // burst gets its own additive flash at chest height.
    const enemyFlash = new MeshClass(
      new PlaneGeometry(0.34, 0.34),
      new MeshBasicMaterial({
        blending: AdditiveBlending,
        color: 0xffdca8,
        depthWrite: false,
        transparent: true,
      }),
    );
    enemyFlash.visible = false;
    ctx.add(enemyFlash);
    let enemyFlashLife = 0;

    const hooks = {
      lineOfSight,
      damagePlayer: (amount: number): void => player.hurt(amount),
      onMuzzleFlash: (at: Vector3): void => {
        const forward = new Vector3(
          Math.sin(enemy.group.rotation.y),
          0,
          Math.cos(enemy.group.rotation.y),
        );
        enemyFlash.position.copy(at).addScaledVector(forward, 0.55);
        enemyFlash.visible = true;
        enemyFlashLife = 0.06;
      },
    };

    return (frameCtx, dt) => {
      if (frameCtx.input.justPressed("restart")) {
        frameCtx.state.set(Play.initialState);
        frameCtx.state.flush();
        void frameCtx.goto("play");
        return;
      }

      // The muzzle flash decays outside the phase gate: an early return with the
      // quad still visible leaves it frozen in the world behind the end screen.
      enemyFlashLife = Math.max(0, enemyFlashLife - dt);
      if (enemyFlashLife <= 0) enemyFlash.visible = false;

      const state = frameCtx.state.getState();
      if (state.phase !== "playing") {
        // The run is over: hold the frame, keep looking around, wait for Enter.
        player.update(frameCtx, dt, false);
        return;
      }

      elapsed += dt;
      hitFlash = Math.max(0, hitFlash - dt * 2.4);
      for (const slot of impacts) {
        if (slot.life <= 0) continue;
        slot.life -= dt;
        slot.mesh.scale.setScalar(0.6 + (0.18 - slot.life) * 4);
        if (slot.life <= 0) slot.mesh.visible = false;
      }
      if (enemyFlash.visible) enemyFlash.lookAt(eye.x, eye.y, eye.z);
      const timeRemaining = Math.max(0, RUN_SECONDS - elapsed);

      player.update(frameCtx, dt, !rifle.reloading);
      if (frameCtx.input.justPressed("fire")) fire(frameCtx);
      if (frameCtx.input.justPressed("reload")) rifle.reload(frameCtx);
      const moveVector = frameCtx.input.vector("move");
      rifle.update(dt, player.aiming, Math.min(1, Math.hypot(moveVector.x, moveVector.y)));

      eye.set(player.eye.x, player.eye.y, player.eye.z);
      enemy.update(frameCtx, dt, eye, hooks);

      const hitCount = frameCtx.state.getState().targetsHit;
      let phase: GameState["phase"] = "playing";
      if (hitCount >= TARGET_GOAL) phase = "complete";
      else if (player.health <= 0 || timeRemaining <= 0) phase = "failed";

      frameCtx.state.set({
        ammo: rifle.ammo,
        distanceMoved: player.distanceMoved,
        health: player.health,
        hitFlash,
        phase,
        reloads: rifle.reloads,
        reserve: rifle.reserve,
        shots: rifle.shots,
        timeRemaining,
      });
      if (phase !== "playing") frameCtx.state.flush();
    };
  }
}
