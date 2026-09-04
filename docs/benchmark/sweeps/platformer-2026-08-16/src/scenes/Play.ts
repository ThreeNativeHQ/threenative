import { AudioBus, type ICtx, Scene, type SceneFrame } from "@threenative/core";
import { Area3D, CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { type Group, Object3D, type PerspectiveCamera, Vector3 } from "three";
import { Enemy } from "../entities/Enemy.js";
import { Player } from "../entities/Player.js";
import { createSpringArm } from "../render/camera.js";
import { buildLevel } from "../render/level.js";
import { setupLighting } from "../render/lighting.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    coins: 0,
    coinsTotal: 0,
    coyoteJumps: 0,
    entityCount: 0,
    goalReached: false,
    jumps: 0,
    peakRise: 0,
    playerX: -4.5,
    respawns: 0,
    score: 0,
  };

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const level = buildLevel();
    const materials = level.materials;
    const clouds = setupSky(ctx.scene, materials.cloud);
    const sun = setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer, ctx.scene, ctx.camera);
    ctx.add(ctx.camera);
    ctx.add(level.root);

    const audio = ctx.entities.add("audio", new AudioBus({ camera: ctx.camera }));
    const pickupAudio = ctx.assets.audio("pickup.ogg");
    void pickupAudio.catch(() => undefined);

    // Every walkable surface becomes one fixed box. The collider is an empty
    // Object3D rather than the island mesh: the visual island is a group of
    // twenty rounded pieces, and a convex hull of all of them would swallow the
    // gaps the level is made of.
    for (const surface of level.surfaces) {
      const anchor = new Object3D();
      anchor.position.set(surface.x, surface.y - surface.thickness / 2, surface.z);
      ctx.add(anchor);
      new RigidBody3D({
        object: anchor,
        physics: ctx.physics,
        shape: CollisionShape3D.box(surface.width, surface.thickness, surface.depth),
        type: "fixed",
      });
    }

    const player = new Player(ctx, materials, level.spawn);
    ctx.entities.add("player", player);
    const springArm = createSpringArm(ctx.camera as PerspectiveCamera);
    springArm.snap(player.mesh.position);

    // ── Coins ──────────────────────────────────────────────────────────────
    const coins: { mesh: Group; area: Area3D; taken: boolean; spin: number }[] = [];
    level.coins.forEach((position, index) => {
      const mesh = level.coinMesh();
      mesh.position.copy(position);
      ctx.add(mesh);
      const area = new Area3D({
        physics: ctx.physics,
        position,
        shape: CollisionShape3D.box(1.1, 1.3, 1.1),
      });
      const record = { area, mesh, spin: index * 0.4, taken: false };
      area.on("bodyEntered", (body) => {
        if (body !== player.body || record.taken) return;
        record.taken = true;
        record.mesh.visible = false;
        area.monitoring = false;
        ctx.state.set((state) => ({ coins: state.coins + 1, score: state.coins + 1 }));
        void pickupAudio.then((buffer) => audio.play(buffer)).catch(() => undefined);
      });
      coins.push(record);
    });
    ctx.state.set({ coinsTotal: coins.length });

    // ── Hazards ────────────────────────────────────────────────────────────
    const enemies = level.enemies.map((spot, index) => {
      const enemy = new Enemy(ctx, spot, level.enemyMesh(spot.kind));
      ctx.entities.add(`enemy${index}`, enemy);
      return enemy;
    });

    // ── Goal ───────────────────────────────────────────────────────────────
    const goalArea = new Area3D({
      physics: ctx.physics,
      position: { x: level.goal.x, y: level.goal.y + 1, z: level.goal.z },
      shape: CollisionShape3D.box(2.4, 3, 2.4),
    });
    goalArea.on("bodyEntered", (body) => {
      if (body !== player.body) return;
      ctx.state.set({ goalReached: true });
      ctx.state.flush();
    });

    ctx.state.set({ entityCount: Object.keys(ctx.entities.snapshot()).length });

    // The startup collapse bakes the static scene into a handful of merged
    // meshes, and the merged result comes back with `castShadow` false: a level
    // built from 500 shadow-casting props ends up with two casters and a scene
    // with no shadows at all. Re-flagging after `whenReady()` restores them.
    void ctx.startup.whenReady().then(() => {
      ctx.scene.traverse((object) => {
        const mesh = object as { isMesh?: boolean; castShadow?: boolean; receiveShadow?: boolean };
        if (mesh.isMesh !== true || object.name === "sky-dome") return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      });
    });

    const focus = new Vector3();
    let elapsed = 0;
    let checkpoint = 0;

    return (frameCtx, dt) => {
      // Restart resets the store before clearing entities and scheduled callbacks.
      if (frameCtx.input.justPressed("restart")) {
        frameCtx.state.set(Play.initialState);
        frameCtx.state.flush();
        void frameCtx.goto("play");
        return;
      }
      elapsed += dt;
      player.update(frameCtx, dt);

      for (const coin of coins) {
        if (coin.taken) continue;
        coin.mesh.rotation.y += dt * 2.6;
        coin.mesh.position.y += Math.sin(elapsed * 2.4 + coin.spin) * dt * 0.35;
      }

      if (player.body.grounded && checkpoint + 1 < level.checkpoints.length) {
        const next = level.checkpoints[checkpoint + 1];
        if (next !== undefined && player.mesh.position.x >= next.x) {
          checkpoint += 1;
          player.reachCheckpoint(next);
        }
      }

      let respawned = false;
      for (const enemy of enemies) {
        enemy.update(dt);
        if (!player.vulnerable || !enemy.touches(player.mesh.position)) continue;
        if (enemy.stomped(player.mesh.position, player.body.velocity.y)) {
          player.bounce();
          continue;
        }
        player.respawn();
        respawned = true;
      }

      if (player.mesh.position.y < level.killPlane) {
        player.respawn();
        springArm.snap(player.mesh.position);
        respawned = true;
      }

      springArm.follow(player.mesh.position, dt);
      focus.copy(player.mesh.position);
      sun.track(focus.x, focus.y, focus.z);
      clouds.position.x = Math.sin(elapsed * 0.02) * 6;

      const debug = player.debug();
      const previous = frameCtx.state.getState();
      frameCtx.state.set({
        coyoteJumps: debug.coyoteJumps,
        entityCount: Object.keys(frameCtx.entities.snapshot()).length,
        jumps: debug.jumps,
        peakRise: Math.max(previous.peakRise, player.mesh.position.y - level.spawn.y),
        playerX: player.mesh.position.x,
        respawns: previous.respawns + (respawned ? 1 : 0),
      });
      if (respawned) frameCtx.state.flush();
    };
  }
}
