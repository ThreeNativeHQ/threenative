import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import { Area3D, CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { Object3D, type PerspectiveCamera } from "three";
import { Crate, GhostCrate } from "../entities/Crate.js";
import { PLAYER_SPAWN, Player } from "../entities/Player.js";
import { LAYER, MASK } from "../layers.js";
import { createVaultCamera } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { ROOM, createRoom } from "../render/room.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

/** Matches `step` in defineGame: the scene callback is already one fixed tick. */
const TICK = 1 / 60;
const SEED = 90210;
const REST_SPEED = 0.12;
const GHOST_AT = { x: 2.6, y: 0.55, z: 2.6 } as const;

/** The scripted sequence the determinism check replays, in fixed ticks. */
const SCRIPT: readonly { until: number; x: number; y: number }[] = [
  { until: 120, x: 0, y: 0 },
  { until: 250, x: 1, y: 0.35 },
  { until: 360, x: 1, y: -0.2 },
  { until: 430, x: 0.2, y: -1 },
  { until: 520, x: 0, y: 0 },
];
const SCRIPT_TICKS = 520;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over millimetre-quantised transforms: same layout in, same string out. */
function hashBodies(values: readonly number[]): string {
  let hash = 0x811c9dc5;
  for (const value of values) {
    const quantised = Math.round(value * 1000) | 0;
    for (let byte = 0; byte < 4; byte += 1) {
      hash ^= (quantised >>> (byte * 8)) & 0xff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, "0");
}

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    bodyCount: 0,
    settled: 0,
    pushed: 0,
    contacts: 0,
    phaseThroughs: 0,
    goalReached: false,
    goalBy: "",
    playerX: PLAYER_SPAWN.x,
    playerZ: PLAYER_SPAWN.z,
    distance: 0,
    seed: SEED,
    replayPhase: "idle",
    replayHashA: "",
    replayHashB: "",
    replayMatch: "unknown",
    score: 0,
    hovered: "",
  };

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const materials = createMaterials();
    setupSky(ctx.scene);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer, ctx.scene, ctx.camera);
    const camera = createVaultCamera(ctx.camera as PerspectiveCamera);

    const room = createRoom(materials);
    ctx.add(room.group);
    for (const collider of room.colliders) {
      const [sx, sy, sz] = collider.size;
      const [px, py, pz] = collider.position;
      const anchor = new Object3D();
      anchor.position.set(px, py, pz);
      ctx.scene.add(anchor);
      new RigidBody3D({
        collisionLayer: LAYER.world,
        collisionMask: MASK.world,
        object: anchor,
        physics: ctx.physics,
        shape: CollisionShape3D.box(sx, sy, sz),
        type: "fixed",
      });
    }

    // The stack: a 3x3x3 tower plus loose crates, dropped from just above rest
    // so the opening seconds are a real settle rather than a static diorama.
    const random = mulberry32(SEED);
    const crates: Crate[] = [];
    const dye = (index: number) => Math.floor(random() * 3 + index) % 3;
    // Each level is narrower and shifted, so the pile keeps a stepped
    // silhouette after it settles instead of fusing into one big cube.
    const levels: { columns: number; rows: number; shiftX: number; shiftZ: number }[] = [
      { columns: 3, rows: 3, shiftX: 0, shiftZ: 0 },
      { columns: 3, rows: 2, shiftX: 0.18, shiftZ: 0.42 },
      { columns: 2, rows: 2, shiftX: 0.55, shiftZ: 0.2 },
    ];
    for (const [level, shape] of levels.entries()) {
      for (let column = 0; column < shape.columns; column += 1) {
        for (let row = 0; row < shape.rows; row += 1) {
          crates.push(
            new Crate(ctx, materials, {
              dye: dye(level + column * 2 + row),
              x: -1.6 + shape.shiftX + column * 1.06 + (random() - 0.5) * 0.06,
              y: 0.55 + level * 1.12,
              yaw: (random() - 0.5) * 0.14,
              z: -1.2 + shape.shiftZ + row * 1.06 + (random() - 0.5) * 0.06,
            }),
          );
        }
      }
    }
    // Four more dropped from head height: these are the ones that topple and
    // then come to rest, which is what makes the opening read as simulated.
    for (let index = 0; index < 4; index += 1) {
      crates.push(
        new Crate(ctx, materials, {
          dye: dye(index + 1),
          x: -1.2 + index * 0.9 + (random() - 0.5) * 0.3,
          y: 4.4 + index * 0.8,
          yaw: random() * Math.PI,
          z: -0.4 + (random() - 0.5) * 1.4,
        }),
      );
    }
    const scatter: [number, number][] = [
      [-5.6, -2.4],
      [-4.1, -4.2],
      [-2.4, 3.4],
      [0.6, 4.3],
      [4.0, 2.6],
      [5.1, 0.4],
      [6.6, 2.0],
      [2.6, -4.0],
      [-6.4, 1.4],
    ];
    for (const [index, [x, z]] of scatter.entries()) {
      crates.push(
        new Crate(ctx, materials, {
          dye: dye(index),
          x,
          y: 0.52 + (index % 2) * 1.1,
          yaw: random() * Math.PI,
          z,
        }),
      );
    }
    const ghost = new GhostCrate(ctx, materials, {
      dye: 0,
      x: GHOST_AT.x,
      y: GHOST_AT.y,
      z: GHOST_AT.z,
    });

    const player = new Player(ctx, materials);
    ctx.entities.add("player", player);
    ctx.entities.add("ghost", ghost.mesh);
    camera.snap(player.position);

    // The goal only fires on simulated contact: the pad is a sensor, and either
    // the player or a crate shoved into it trips it.
    const goal = new Area3D({
      collisionLayer: LAYER.world,
      collisionMask: LAYER.player | LAYER.solid,
      entity: "goal",
      physics: ctx.physics,
      position: { x: ROOM.goal.x, y: 0.6, z: ROOM.goal.z },
      shape: CollisionShape3D.box(ROOM.goal.size, 1.4, ROOM.goal.size),
    });
    goal.on("bodyEntered", (body) => {
      const state = ctx.state.getState();
      if (state.goalReached) return;
      const by = body === player.body ? "player" : "crate";
      ctx.state.set({ goalReached: true, goalBy: by, score: state.score + 1 });
      console.info(`TN_GOAL_REACHED:${by}`);
    });

    const startPhase = ctx.state.getState().replayPhase;
    const scripted = startPhase === "run-a" || startPhase === "run-b";
    ctx.state.set({
      bodyCount: crates.length + 1,
      contacts: 0,
      distance: 0,
      goalBy: "",
      goalReached: false,
      phaseThroughs: 0,
      pushed: 0,
      settled: 0,
    });
    console.info(
      `TN_ROOM_READY:bodies=${crates.length + 1},worldBodies=${ctx.physics.numBodies()},seed=${SEED},scripted=${scripted}`,
    );

    const pushed = new Set<number>();
    const probe = CollisionShape3D.box(1.1, 1.4, 1.1);
    const ghostProbe = CollisionShape3D.box(0.9, 1.2, 0.9);
    let scriptStarted = false;
    let settleTicks = 0;
    let quietTicks = 0;
    let touchingCrate = false;
    let insideGhost = false;
    let tick = 0;
    let lastX = player.position.x;
    let lastZ = player.position.z;
    let restarting = false;

    const worldHash = (): string => {
      const values: number[] = [];
      for (const crate of crates)
        values.push(
          crate.mesh.position.x,
          crate.mesh.position.y,
          crate.mesh.position.z,
          crate.mesh.quaternion.x,
          crate.mesh.quaternion.z,
        );
      values.push(player.position.x, player.position.y, player.position.z);
      return hashBodies(values);
    };

    const finishScriptedRun = (frameCtx: GameCtx): void => {
      const hash = worldHash();
      const state = frameCtx.state.getState();
      if (state.replayPhase === "run-a") {
        frameCtx.state.set({ replayHashA: hash, replayPhase: "run-b" });
        console.info(`TN_REPLAY_RUN_A:${hash}`);
      } else {
        const matched = state.replayHashA === hash;
        frameCtx.state.set({
          replayHashB: hash,
          replayMatch: matched ? "match" : "mismatch",
          replayPhase: "done",
        });
        console.info(`TN_REPLAY_RUN_B:${hash}`);
        console.info(`TN_DETERMINISM_MATCH:${matched}`);
      }
      frameCtx.state.flush();
      restarting = true;
      void frameCtx.goto("play");
    };

    const step = (frameCtx: GameCtx): void => {
      // The replay only starts once the drop has come to rest, so both runs
      // begin from the same world instead of from wherever the settle happened
      // to be when the frame callback took over.
      if (scripted && !scriptStarted) {
        settleTicks += 1;
        const moving = crates.filter((crate) => {
          const velocity = crate.body.linearVelocity;
          return Math.hypot(velocity.x, velocity.y, velocity.z) >= REST_SPEED;
        }).length;
        // Bodies read zero velocity on the tick they are created, so "nothing
        // is moving" is only meaningful after the drop has had time to happen
        // and has then been quiet for a while.
        if (moving > 0) quietTicks = 0;
        else quietTicks += 1;
        if ((settleTicks < 240 || quietTicks < 60) && settleTicks < 900) return;
        scriptStarted = true;
        console.info(`TN_REPLAY_SETTLED:${worldHash()},ticks=${settleTicks}`);
      }
      tick += 1;
      if (scripted) {
        const segment = SCRIPT.find((entry) => tick <= entry.until) ?? SCRIPT[SCRIPT.length - 1];
        player.update(frameCtx, TICK, segment);
      } else {
        player.update(frameCtx, TICK);
      }

      // Contacts and pushes come from shape queries against the live world, not
      // from distance to a crate: a distance test would count a near miss.
      const at = player.position;
      const hits = frameCtx.physics.directSpaceState.intersectShape({
        collisionMask: LAYER.solid,
        maxResults: 8,
        position: { x: at.x, y: at.y, z: at.z },
        shape: probe,
      });
      if (hits.length > 0 && !touchingCrate)
        frameCtx.state.set((state) => ({ contacts: state.contacts + 1 }));
      touchingCrate = hits.length > 0;
      for (const hit of hits) {
        const crate = crates.find((entry) => entry.body.body.id === hit.body.id);
        if (crate === undefined) continue;
        const velocity = crate.body.linearVelocity;
        if (Math.hypot(velocity.x, velocity.y, velocity.z) > 0.35) pushed.add(hit.body.id);
      }

      const ghostHits = frameCtx.physics.directSpaceState.intersectShape({
        collisionMask: LAYER.ghost,
        maxResults: 4,
        position: { x: at.x, y: at.y, z: at.z },
        shape: ghostProbe,
      });
      if (ghostHits.length > 0 && !insideGhost)
        frameCtx.state.set((state) => ({ phaseThroughs: state.phaseThroughs + 1 }));
      insideGhost = ghostHits.length > 0;

      let settled = 0;
      for (const crate of crates) {
        const velocity = crate.body.linearVelocity;
        if (Math.hypot(velocity.x, velocity.y, velocity.z) < REST_SPEED) settled += 1;
      }
      const moved = Math.hypot(at.x - lastX, at.z - lastZ);
      lastX = at.x;
      lastZ = at.z;
      frameCtx.state.set((state) => ({
        distance: state.distance + moved,
        playerX: at.x,
        playerZ: at.z,
        pushed: pushed.size,
        settled,
      }));

      if (at.y < -4) player.respawn();
    };

    return (frameCtx, dt) => {
      if (restarting) return;
      if (frameCtx.input.justPressed("restart")) {
        restarting = true;
        frameCtx.state.set({ replayPhase: "idle", replayMatch: "unknown" });
        frameCtx.state.flush();
        void frameCtx.goto("play");
        return;
      }
      if (!scripted && frameCtx.input.justPressed("verify")) {
        restarting = true;
        frameCtx.state.set({ replayHashA: "", replayHashB: "", replayPhase: "run-a" });
        frameCtx.state.flush();
        void frameCtx.goto("play");
        return;
      }

      // One gameplay tick per fixed step. Running an accumulator on top of a
      // loop that is already fixed-step decouples the character from the
      // simulation and the replay stops matching.
      step(frameCtx);
      if (scripted && tick >= SCRIPT_TICKS) {
        finishScriptedRun(frameCtx);
        return;
      }

      camera.follow(player.position, dt);
      const pulse = 0.75 + Math.sin(performance.now() / 320) * 0.25;
      room.goalRing.scale.setScalar(frameCtx.state.getState().goalReached ? 1.15 : pulse * 0.4 + 0.9);
      ghost.mesh.rotation.y += dt * 0.6;
    };
  }
}
