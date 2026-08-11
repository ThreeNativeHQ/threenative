import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import { CollisionShape3D, RigidBody3D } from "@threenative/physics";
import type { IPhysicsContext } from "@threenative/physics";
import { BoxGeometry, Mesh, type PerspectiveCamera, Vector3 } from "three";
import { Character, PLATFORMER_FEEL } from "../entities/Character.js";
import { Chaser } from "../entities/Chaser.js";
import { Patrol } from "../entities/Patrol.js";
import { Pickup, coinArc } from "../entities/Pickup.js";
import { Checkpoints } from "../level/Checkpoints.js";
import { createPlatform } from "../level/Platform.js";
import { emitPlaytestEvent } from "../playtest-events.js";
import { setupCamera } from "../render/camera.js";
import { createHud } from "../render/hud.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSky } from "../render/sky.js";
import { TouchControls } from "../render/touch-controls.js";
import type { GameState } from "../state.js";
export type GameCtx = ICtx<GameState, IPhysicsContext>;
const SPAWN = new Vector3(0, 0.75, 0);
const KILL_PLANE = -8;
export class Level extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState = {
    checkpoint: 0,
    coins: 0,
    coyoteJumps: 0,
    defeated: 0,
    dashes: 0,
    hearts: 3,
    jumps: 0,
    peakRise: 0,
    playerX: SPAWN.x,
    respawns: 0,
    topSpeed: 0,
  };
  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    setupSky(ctx.scene);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer, ctx.scene, ctx.camera);
    const camera = ctx.camera as PerspectiveCamera;
    setupCamera(camera);
    ctx.add(camera);
    const hud = ctx.entities.add("hud", createHud(camera, "HEARTS", "COINS"));
    const touchControls = ctx.entities.add("touch-controls", new TouchControls(camera));
    ctx.viewport.resize();
    createPlatform(ctx, new Vector3(0, 0, 0), 18, { depth: 7, seed: 3 });
    createPlatform(ctx, new Vector3(14, 0, 0), 10, { depth: 7, seed: 7 });
    createPlatform(ctx, new Vector3(25, 0, 0), 8, { depth: 7, seed: 11 });
    createPlatform(ctx, new Vector3(0, 2.6, 0), 6, { depth: 5, oneWay: true, seed: 17 });
    const blocker = new Mesh(new BoxGeometry(0.6, 1.6, 5.2), createMaterials().shadow);
    blocker.position.set(3.4, 0.8, 0);
    blocker.castShadow = blocker.receiveShadow = true;
    ctx.add(blocker);
    new RigidBody3D({
      collisionLayer: 4,
      object: blocker,
      physics: ctx.physics,
      shape: CollisionShape3D.box(0.6, 1.6, 5.2),
      type: "fixed",
    });
    const { playerX } = ctx.state.getState() as { playerX?: number };
    const spawn = SPAWN.clone();
    if (Number.isFinite(playerX)) spawn.x = playerX ?? SPAWN.x;
    const character = new Character(ctx, spawn);
    ctx.entities.add("player", character);
    const p = (x: number) => new Vector3(x, 0.75, 0);
    const checkpoints = new Checkpoints([SPAWN, p(14), p(25)], 3, PLATFORMER_FEEL);
    const pickups: Array<{ id: string; value: Pickup }> = [];
    const patrols: Array<{ id: string; value: Patrol }> = [];
    let coins = 0;
    let defeated = 0;
    const cameraAnchor = new Vector3();
    const addPickup = (at: Vector3): void => {
      const id = `coin.${pickups.length}`;
      const pickup = new Pickup(ctx, at, () => {
        coins += 1;
        emitPlaytestEvent({ entity: "player", name: "collected" });
      });
      pickups.push({ id, value: pickup });
      ctx.entities.add(id, pickup);
    };
    const removeCollected = (): void => {
      for (let index = pickups.length - 1; index >= 0; index -= 1) {
        const entry = pickups[index];
        if (entry?.value.collected) {
          ctx.entities.remove(entry.id);
          pickups.splice(index, 1);
        }
      }
    };
    const removeDefeated = (): void => {
      for (let index = patrols.length - 1; index >= 0; index -= 1) {
        const entry = patrols[index];
        if (entry?.value.defeated) {
          ctx.entities.remove(entry.id);
          patrols.splice(index, 1);
        }
      }
    };
    const followCamera = (target: Vector3, dt: number): void => {
      const desired = cameraAnchor.set(target.x, target.y + 4.4, target.z + 8.5);
      if (dt >= 1) camera.position.copy(desired);
      else camera.position.lerp(desired, 1 - Math.exp(-dt / 0.18));
      camera.lookAt(target.x, target.y + 0.9, target.z);
    };
    addPickup(new Vector3(2, 1.05, 0));
    addPickup(new Vector3(3.2, 1.05, 0));
    addPickup(new Vector3(4.4, 1.05, 0));
    for (const point of coinArc(new Vector3(11, 1.05, 0), 4, 3.6, 1.4)) addPickup(point);
    const patrol = new Patrol(
      ctx,
      character,
      new Vector3(5.2, 0.66, 0),
      new Vector3(7.4, 0.66, 0),
      () => {
        defeated += 1;
      },
      (fromX) => checkpoints.hurt(character, fromX),
      PLATFORMER_FEEL,
    );
    patrols.push({ id: "patrol", value: patrol });
    ctx.entities.add("patrol", patrol);
    const chaser = new Chaser(ctx, character, new Vector3(7.5, 0.66, 0));
    const avoidanceChaser = new Chaser(ctx, character, new Vector3(8.2, 0.66, 0.7));
    chaser.mesh.userData.peer = avoidanceChaser.mesh;
    avoidanceChaser.mesh.userData.peer = chaser.mesh;
    ctx.entities.add("chaser", chaser);
    ctx.entities.add("chaser.avoidance", avoidanceChaser);
    followCamera(spawn, 1);
    let elapsed = 0;
    // Built last on purpose: it hides what is in the scene when it is created, so the scene has
    // to be populated first. It reveals the world itself once startup settles and the collapsed
    // scene's shaders are built, so nothing here has to sequence that.
    const loading = createLoadingScreen(ctx);

    return (frameCtx, dt) => {
      loading.update();
      elapsed += dt;
      character.update(
        frameCtx,
        dt,
        touchControls.update(frameCtx.input.raw.pointers, frameCtx.viewport.size),
      );
      chaser.update(dt);
      avoidanceChaser.update(dt);
      for (const entry of patrols) entry.value.update(dt);
      for (const entry of pickups) entry.value.update(dt);
      checkpoints.pass(character.mesh.position);
      checkpoints.update(dt, character);
      character.health = checkpoints.hearts;
      if (character.mesh.position.y < KILL_PLANE) checkpoints.respawn(character);
      removeCollected();
      removeDefeated();
      const rise = Math.max(0, character.mesh.position.y - SPAWN.y);
      const speed = Math.hypot(character.body.velocity.x, character.body.velocity.z);
      const previous = frameCtx.state.getState();
      hud.update({ counter: coins, primary: checkpoints.hearts, seconds: elapsed });
      frameCtx.state.set({
        checkpoint: checkpoints.currentIndex,
        coins,
        coyoteJumps: character.coyoteJumps,
        defeated,
        dashes: character.dashes,
        hearts: checkpoints.hearts,
        jumps: character.jumps,
        peakRise: Math.max(previous.peakRise, rise),
        playerX: character.mesh.position.x,
        respawns: checkpoints.respawns,
        topSpeed: Math.max(previous.topSpeed, speed),
      } as Partial<GameState>);
      followCamera(character.mesh.position, dt);
    };
  }
}
