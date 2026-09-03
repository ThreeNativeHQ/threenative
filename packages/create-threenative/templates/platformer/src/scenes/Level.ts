import {
  type ICtx,
  Scene,
  type SceneFrame,
  isMobile,
  isTouchscreenAvailable,
} from "@threenative/core";
import { CollisionShape3D, RigidBody3D } from "@threenative/physics";
import type { IPhysicsContext } from "@threenative/physics";
import { BoxGeometry, Group, Mesh, type PerspectiveCamera, Vector3 } from "three";
import { Character, PLATFORMER_FEEL } from "../entities/Character.js";
import { Chaser } from "../entities/Chaser.js";
import { Patrol } from "../entities/Patrol.js";
import { Pickup, coinArc } from "../entities/Pickup.js";
import { Checkpoints } from "../level/Checkpoints.js";
import { type IPlatform, createPlatform } from "../level/Platform.js";
import { emitPlaytestEvent } from "../playtest-events.js";
import { setupCamera } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSky } from "../render/sky.js";
import { crate as crateMesh } from "../render/terrain.js";
import { TouchControls } from "../render/touch-controls.js";
import { type GameState, TERMINAL, type TerminalState } from "../state.js";
export type GameCtx = ICtx<GameState, IPhysicsContext>;
const SPAWN = new Vector3(0, 0.75, 0);
const PATROL_FROM = new Vector3(5.2, 0.66, 0);
const PATROL_TO = new Vector3(7.4, 0.66, 0);
const KILL_PLANE = -8;
const GOAL_X = 21.5;
export class Level extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState = {
    paused: false,
    uiReady: false,
    checkpoint: 0,
    coins: 0,
    coyoteJumps: 0,
    defeated: 0,
    dashes: 0,
    hearts: 3,
    jumps: 0,
    peakRise: 0,
    playerX: SPAWN.x,
    grounded: false,
    respawns: 0,
    terminal: TERMINAL.playing,
    topSpeed: 0,
  };

  override load(ctx: GameCtx): void {
    // A runner applies setup after load() but before enter(). Keep a transform-bearing placeholder
    // for the patrol so a setup can position/freeze it before Patrol creates its authoritative
    // trigger in enter(). The placeholder is never rendered or stepped.
    const patrol = new Group();
    patrol.position.copy(PATROL_FROM);
    ctx.entities.add("patrol", patrol);
  }

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    setupSky(ctx.scene);
    const sun = setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    // isMobile() arrives as an argument because src/render/ imports no framework package: the
    // platform decision is made here, in portable game code, exactly like createRandom.
    setupPost(ctx.renderer, ctx.scene, ctx.camera, { godraysLight: sun, mobile: isMobile() });
    const camera = ctx.camera as PerspectiveCamera;
    setupCamera(camera);
    const loading = createLoadingScreen(ctx);
    ctx.add(camera);
    const showTouchControls = isMobile() && isTouchscreenAvailable();
    const touchControls = showTouchControls
      ? ctx.entities.add("touch-controls", new TouchControls(camera))
      : undefined;
    ctx.viewport.resize();
    const platforms: IPlatform[] = [
      createPlatform(ctx, new Vector3(0, 0, 0), 18, { depth: 7, seed: 3 }),
      createPlatform(ctx, new Vector3(14, 0, 0), 10, { depth: 7, seed: 7 }),
      createPlatform(ctx, new Vector3(25, 0, 0), 8, { depth: 7, seed: 11 }),
      createPlatform(ctx, new Vector3(0, 2.6, 0), 6, { depth: 5, oneWay: true, seed: 17 }),
    ];
    const supportSurfaceY = (position: Pick<Vector3, "x" | "y" | "z">): number | undefined => {
      let surfaceY: number | undefined;
      for (const platform of platforms) {
        if (!platform.contains(position) || platform.surfaceY > position.y) continue;
        if (surfaceY === undefined || platform.surfaceY > surfaceY) surfaceY = platform.surfaceY;
      }
      return surfaceY;
    };
    const crate = crateMesh();
    crate.position.set(-3, 1, 0);
    crate.castShadow = crate.receiveShadow = true;
    ctx.add(crate);
    const crateBody = new RigidBody3D({
      object: crate,
      physics: ctx.physics,
      shape: CollisionShape3D.box(0.8, 0.8, 0.8),
    });
    ctx.entities.add("crate", { body: crateBody, object: crate });
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
    let coins = 0;
    let defeated = 0;
    let nextCoin = 0;
    const cameraAnchor = new Vector3();
    const addPickup = (at: Vector3): void => {
      const id = `coin.${nextCoin}`;
      nextCoin += 1;
      const pickup = new Pickup(ctx, at, () => {
        coins += 1;
        emitPlaytestEvent({ entity: "player", name: "collected" });
      });
      ctx.entities.add(id, pickup);
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
    const patrolSetup = ctx.entities.get<Group>("patrol");
    const patrolPosition = patrolSetup?.position.clone() ?? PATROL_FROM.clone();
    const patrolQuaternion = patrolSetup?.quaternion.clone();
    const patrolScale = patrolSetup?.scale.clone();
    const patrolUserData = patrolSetup === undefined ? undefined : { ...patrolSetup.userData };
    if (patrolSetup !== undefined) ctx.entities.remove("patrol");
    const patrol = new Patrol(
      ctx,
      character,
      PATROL_FROM,
      PATROL_TO,
      () => {
        defeated += 1;
      },
      (fromX) => checkpoints.hurt(character, fromX),
      PLATFORMER_FEEL,
    );
    patrol.mesh.position.copy(patrolPosition);
    if (patrolQuaternion !== undefined) patrol.mesh.quaternion.copy(patrolQuaternion);
    if (patrolScale !== undefined) patrol.mesh.scale.copy(patrolScale);
    if (patrolUserData !== undefined) Object.assign(patrol.mesh.userData, patrolUserData);
    patrol.mesh.updateMatrix();
    patrol.area.setPosition(patrol.mesh.position);
    ctx.entities.add("patrol", patrol);
    const chaser = new Chaser(ctx, new Vector3(7.5, 0.66, 0));
    const avoidanceChaser = new Chaser(ctx, new Vector3(8.2, 0.66, 0.7));
    chaser.mesh.userData.peer = avoidanceChaser.mesh;
    avoidanceChaser.mesh.userData.peer = chaser.mesh;
    ctx.entities.add("chaser", chaser);
    ctx.entities.add("chaser.avoidance", avoidanceChaser);
    followCamera(spawn, 1);
    let elapsed = 0;
    let terminal: TerminalState = TERMINAL.playing;
    const statePatch: Partial<GameState> = {};
    const finish = (next: TerminalState): void => {
      if (terminal !== TERMINAL.playing) return;
      terminal = next;
      emitPlaytestEvent({ entity: "game", name: next === TERMINAL.won ? "won" : "lost" });
    };
    const updatePlaying = (frameCtx: GameCtx, dt: number): void => {
      elapsed += dt;
      character.update(
        frameCtx,
        dt,
        touchControls?.update(frameCtx.input.raw.pointers, frameCtx.viewport.size),
        supportSurfaceY,
      );
      // The chasers walk a measured route, and `pathLength` assertions read how much of it was
      // walked while a runner was watching. Stepping them before the world reports startup ready
      // spends part of the route where nothing can observe it, so the measurement becomes a
      // function of how long startup took — it passed on a workstation and failed in CI at
      // `4.43 of a required 6`, with `routeComplete` already true before the scenario began.
      // Everything else in this frame keeps running: only the measured routes wait.
      // `compileSettled`, not `phase === "ready"`: readiness additionally waits for a sustained
      // in-budget frame window, which a software rasteriser never meets, so gating on it froze
      // these routes for the whole scenario and measured a path length of 0.
      if (frameCtx.startup.compileSettled) {
        chaser.update(dt);
        avoidanceChaser.update(dt);
      }
      patrol.update(dt);
      checkpoints.pass(character.mesh.position);
      checkpoints.update(dt, character);
      character.health = checkpoints.hearts;
      if (character.mesh.position.y < KILL_PLANE) checkpoints.respawn(character);
    };
    return (frameCtx, dt) => {
      loading.update();
      if (terminal === TERMINAL.playing) {
        updatePlaying(frameCtx, dt);
        if (checkpoints.hearts <= 0) finish(TERMINAL.lost);
        else if (character.mesh.position.x >= GOAL_X && character.body.grounded)
          finish(TERMINAL.won);
      }
      const rise = Math.max(0, character.mesh.position.y - SPAWN.y);
      const speed = Math.hypot(character.body.velocity.x, character.body.velocity.z);
      const previous = frameCtx.state.getState();
      statePatch.checkpoint = checkpoints.currentIndex;
      statePatch.coins = coins;
      statePatch.coyoteJumps = character.coyoteJumps;
      statePatch.defeated = defeated;
      statePatch.dashes = character.dashes;
      statePatch.hearts = checkpoints.hearts;
      statePatch.jumps = character.jumps;
      statePatch.peakRise = Math.max(previous.peakRise, rise);
      statePatch.playerX = character.mesh.position.x;
      statePatch.grounded = character.body.grounded;
      statePatch.respawns = checkpoints.respawns;
      statePatch.terminal = terminal;
      statePatch.topSpeed = Math.max(previous.topSpeed, speed);
      frameCtx.state.set(statePatch);
      followCamera(character.mesh.position, dt);
    };
  }
}
