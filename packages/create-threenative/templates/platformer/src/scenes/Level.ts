import { type Ctx, Scene, type SceneFrame } from "@threenative/core";
import { CollisionShape3D, RigidBody3D } from "@threenative/physics";
import type { PhysicsContext } from "@threenative/physics";
import { NavigationObstacle3D, NavigationRegion3D } from "@threenative/physics/navigation";
import { BoxGeometry, Mesh, type PerspectiveCamera, Vector3 } from "three";
import { Character, PLATFORMER_FEEL } from "../entities/Character.js";
import { Chaser } from "../entities/Chaser.js";
import { Patrol } from "../entities/Patrol.js";
import { Pickup, coinArc } from "../entities/Pickup.js";
import { Checkpoints } from "../level/Checkpoints.js";
import { createPlatform } from "../level/Platform.js";
import { emitPlaytestEvent } from "../playtest-events.js";
import { setupCamera } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";
export type GameCtx = Ctx<GameState, PhysicsContext>;
const SPAWN = new Vector3(0, 0.75, 0);
const KILL_PLANE = -8;
export class Level extends Scene<GameState, PhysicsContext> {
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
  override enter(ctx: GameCtx): SceneFrame<GameState, PhysicsContext> {
    setupSky(ctx.scene);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer, ctx.scene, ctx.camera);
    const camera = ctx.camera as PerspectiveCamera;
    setupCamera(camera);
    ctx.viewport.resize();
    const platforms = [
      createPlatform(ctx, new Vector3(0, 0, 0), 18, { depth: 7, seed: 3 }),
      createPlatform(ctx, new Vector3(14, 0, 0), 10, { depth: 7, seed: 7 }),
      createPlatform(ctx, new Vector3(25, 0, 0), 8, { depth: 7, seed: 11 }),
      createPlatform(ctx, new Vector3(0, 2.6, 0), 6, { depth: 5, oneWay: true, seed: 17 }),
    ];
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
    const navigation = ctx.physics.navigation;
    if (navigation === undefined)
      throw new Error("NavigationRegion3D requires a navigation context.");
    new NavigationRegion3D({
      meshes: [...platforms.map(({ visual }) => visual), blocker],
      navigation,
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
    let obstacleTime = 0;
    const avoidanceObstacle = new Mesh(new BoxGeometry(0.7, 1.4, 0.7), createMaterials().accent);
    avoidanceObstacle.position.set(5.6, 0.7, 2.35);
    avoidanceObstacle.castShadow = true;
    ctx.add(avoidanceObstacle);
    new NavigationObstacle3D({ navigation, object: avoidanceObstacle });
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
    const chaser = new Chaser(ctx, character, navigation, new Vector3(7.5, 0.66, 0));
    const avoidanceChaser = new Chaser(ctx, character, navigation, new Vector3(8.2, 0.66, 0.7));
    chaser.mesh.userData.peer = avoidanceChaser.mesh;
    avoidanceChaser.mesh.userData.peer = chaser.mesh;
    ctx.entities.add("chaser", chaser);
    ctx.entities.add("chaser.avoidance", avoidanceChaser);
    followCamera(spawn, 1);
    return (frameCtx, dt) => {
      character.update(frameCtx, dt);
      obstacleTime += dt;
      avoidanceObstacle.position.z = 2.35 + Math.sin(obstacleTime * 1.5) * 0.45;
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
