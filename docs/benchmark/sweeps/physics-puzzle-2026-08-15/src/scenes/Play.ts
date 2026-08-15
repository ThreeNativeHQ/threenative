import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import { Area3D, CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { Object3D, type PerspectiveCamera, Vector3 } from "three";
import { Crate } from "../entities/Crate.js";
import { PLAYER_SPAWN, Player } from "../entities/Player.js";
import { Pusher } from "../entities/push.js";
import { setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { GOAL, ROOM, buildGoalPad, buildRoom } from "../render/room.js";
import { makeRandom } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

const FIXED_STEP = 1 / 60;
/** Steps at which the run records a hash of the whole simulation. */
const CHECKPOINTS = [90, 240, 480, 900] as const;

/** Survives a restart on purpose: run two is compared against run one. */
let previousRun = new Map<number, string>();
let currentRun = new Map<number, string>();
let runCount = 0;
/** The hash of the previous run's fully-settled world, for the replay check. */
let previousRest = "";

function hashOf(values: readonly number[]): string {
  let hash = 0x811c9dc5;
  for (const value of values) {
    // Quantise to a millimetre so a hash means "the same state", not "the same
    // float noise", and still fails loudly when the sim actually diverges.
    let bits = Math.round(value * 1000) | 0;
    for (let byte = 0; byte < 4; byte += 1) {
      hash = Math.imul(hash ^ (bits & 0xff), 0x01000193) >>> 0;
      bits >>= 8;
    }
  }
  return hash.toString(16).padStart(8, "0");
}

function staticBox(
  ctx: GameCtx,
  position: Vector3,
  size: Vector3,
): { readonly body: RigidBody3D; readonly object: Object3D } {
  const object = new Object3D();
  object.position.copy(position);
  const body = new RigidBody3D({
    object,
    physics: ctx.physics,
    shape: CollisionShape3D.box(size.x, size.y, size.z),
    type: "fixed",
  });
  return { body, object };
}

export class Play extends Scene<GameState, IPhysicsContext> {
  /** Everything this scene put into the physics world, torn down on exit. */
  #teardown: (() => void)[] = [];

  override exit(): void {
    for (const dispose of this.#teardown) dispose();
    this.#teardown = [];
  }

  static override readonly initialState: GameState = {
    contacts: 0,
    crates: 0,
    goal: false,
    phantomPasses: 0,
    playerX: PLAYER_SPAWN.x,
    playerZ: PLAYER_SPAWN.z,
    replayChecked: 0,
    replayMatch: true,
    restHash: "",
    restMatch: "pending",
    runs: 0,
    settled: 0,
    shifted: 0,
    simHash: "",
    status: "push a crate onto the light",
    travelled: 0,
  };

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    runCount += 1;
    const earlierRest = previousRest;
    previousRest = "";
    previousRun = currentRun;
    currentRun = new Map();

    setupSky(ctx.scene);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer, ctx.scene, ctx.camera);

    const camera = ctx.camera as PerspectiveCamera;
    camera.fov = 32;
    camera.near = 0.5;
    camera.far = 140;
    camera.position.set(8.4, 15.4, 16.6);
    camera.lookAt(new Vector3(-0.9, 0.3, 0.7));
    camera.updateProjectionMatrix();

    const materials = createMaterials();
    ctx.add(buildRoom(materials));
    const pad = buildGoalPad(materials);
    ctx.add(pad.group);

    // Floor and four walls, so nothing the player shoves can leave the vault.
    staticBox(ctx, new Vector3(0, -0.5, 0), new Vector3(ROOM.halfX * 2 + 2, 1, ROOM.halfZ * 2 + 2));
    for (const side of [-1, 1]) {
      staticBox(
        ctx,
        new Vector3(side * (ROOM.halfX + 0.35), 1.2, 0),
        new Vector3(0.8, 4, ROOM.halfZ * 2 + 2),
      );
      staticBox(
        ctx,
        new Vector3(0, 1.2, side * (ROOM.halfZ + 0.35)),
        new Vector3(ROOM.halfX * 2 + 2, 4, 0.8),
      );
    }

    // The stack, dropped from just above its resting height so the first two
    // seconds of the game are the pile settling.
    const random = makeRandom(90210 + runCount * 0);
    const crates: Crate[] = [];
    const spawn = (x: number, y: number, z: number, tint: number, yaw = 0): void => {
      crates.push(new Crate(ctx, new Vector3(x, y, z), materials, { tint, yaw }));
    };
    let tint = 0;
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        for (let layer = 0; layer < 2; layer += 1) {
          spawn(
            -1.0 + column * 1.01,
            0.55 + row * 1.03 + layer * 0.02,
            -1.5 + layer * 1.01,
            tint % 3,
            (random() - 0.5) * 0.06,
          );
          tint += 1;
        }
      }
    }
    // A loose scatter around the room: the crates the player actually pushes.
    const scatter: readonly [number, number][] = [
      [-6.6, -3.4],
      [-4.4, -4.6],
      [-7.4, 0.6],
      [-3.2, 3.6],
      [-0.6, 4.6],
      [2.2, 4.2],
      [3.4, 1.8],
      [5.4, 1.4],
      [7.4, 1.0],
      [6.6, 3.4],
      [-2.0, -4.8],
      [1.2, -4.4],
      [2.4, -5.4],
      [7.4, 4.4],
      [-5.6, 5.2],
      [0.4, 1.6],
      [2.6, -2.6],
      [-2.8, 0.2],
    ];
    for (const [index, [x, z]] of scatter.entries()) {
      const stacked = index % 5 === 2;
      spawn(x, stacked ? 1.7 : 0.56, z, (index + 1) % 3, (random() - 0.5) * 0.9);
      if (stacked) spawn(x + 0.06, 0.55, z - 0.04, (index + 2) % 3, (random() - 0.5) * 0.5);
    }

    // The crate the puzzle is about: parked in the lane that runs into the
    // goal, so the shortest solution is a straight shove.
    spawn(1.9, 0.56, GOAL.z, 1, 0);

    // The pass-through crate: it stacks and topples like the others, but the
    // player's collision mask ignores its layer and walks straight through.
    const phantom = new Crate(ctx, new Vector3(3.2, 0.56, PLAYER_SPAWN.z), materials, { phantom: true });
    crates.push(phantom);

    const player = new Player(ctx, materials, PLAYER_SPAWN.clone());
    const pusher = new Pusher(ctx, player);
    this.#teardown = [
      () => player.dispose(),
      () => pusher.dispose(),
      ...crates.map((crate) => () => crate.dispose()),
    ];
    ctx.entities.add("player", player.object);

    const solidBodies = new Set(crates.filter((crate) => !crate.phantom).map((crate) => crate.body));

    // The goal only fires on a real contact with a body inside its volume.
    const goalArea = new Area3D({
      physics: ctx.physics,
      position: { x: GOAL.x, y: 0.6, z: GOAL.z },
      shape: CollisionShape3D.box(GOAL.half * 2, 1.4, GOAL.half * 2),
    });
    let contacts = 0;
    let won = false;
    let armed = false;
    goalArea.on("bodyEntered", (body) => {
      // The pile is still falling for the first two seconds; a crate that
      // bounces onto the pad before the player moves is not a win.
      if (!armed || !solidBodies.has(body as never)) return;
      contacts += 1;
      won = true;
      ctx.state.set({ contacts, goal: true, status: "vault opened" });
      console.info("TN_GAME_GOAL_REACHED:crate");
    });

    // A sensor riding the phantom crate, so passing through is observable.
    const phantomArea = new Area3D({
      physics: ctx.physics,
      position: { x: phantom.object.position.x, y: 0.56, z: phantom.object.position.z },
      shape: CollisionShape3D.box(0.9, 0.9, 0.9),
    });
    this.#teardown.push(() => goalArea.dispose());
    let phantomPasses = 0;
    const phantomAnchor = phantom.object.position.clone();
    phantomArea.on("bodyEntered", (body) => {
      // The character body never reaches a sensor; its push volume does.
      if (body !== (pusher.body as never)) return;
      phantomPasses += 1;
      ctx.state.set({ phantomPasses });
      console.info("TN_GAME_PHANTOM_PASS");
    });

    this.#teardown.push(() => phantomArea.dispose());
    console.info(`TN_GAME_READY:crates=${crates.length};run=${runCount}`);
    // A hook for the screenshot script: nothing in the game reads it.
    (globalThis as unknown as { __PROBE__: unknown }).__PROBE__ = {
      crates: () => crates.map((crate) => crate.object.position.toArray()),
      solids: () =>
        crates.filter((crate) => !crate.phantom).map((crate) => crate.object.position.toArray()),
      nudge: (index: number, dx: number) => {
        const crate = crates[index];
        if (crate === undefined) return null;
        const before = crate.object.position.toArray();
        crate.object.position.x += dx;
        crate.body.syncToPhysics();
        return { before, after: crate.object.position.toArray() };
      },
      player: () => player.position.toArray(),
    };

    let accumulator = 0;
    let steps = 0;
    let travelled = 0;
    let replayChecked = 0;
    let replayMatch = true;
    const previousPosition = player.position.clone();
    const scratch: number[] = [];
    let restStreak = 0;
    let restHash = "";

    const worldHash = (): string => {
      scratch.length = 0;
      for (const crate of crates) {
        scratch.push(crate.object.position.x, crate.object.position.y, crate.object.position.z);
      }
      scratch.push(player.position.x, player.position.y, player.position.z);
      return hashOf(scratch);
    };

    return (frame, dt) => {
      if (frame.input.justPressed("restart")) {
        frame.state.set(Play.initialState);
        frame.state.flush();
        void frame.goto("play");
        return;
      }

      player.update(frame, dt);
      pusher.follow(player, player.facing, crates);
      travelled += previousPosition.distanceTo(player.position);
      previousPosition.copy(player.position);
      if (phantom.object.position.distanceToSquared(phantomAnchor) > 0.0004) {
        phantomAnchor.copy(phantom.object.position);
        phantomArea.setPosition(phantomAnchor);
      }

      // Goal light breathes while the vault is shut and blazes once it opens.
      const pulse = won ? 1.6 : 0.7 + Math.sin(steps * FIXED_STEP * 2.4) * 0.18;
      pad.light.intensity = won ? 20 : 9;
      for (const ring of pad.rings) ring.material.emissiveIntensity = pulse;

      // Fixed-step bookkeeping: the hash is sampled on step counts, never on
      // wall-clock time, so two runs of the same inputs sample the same states.
      accumulator += Math.min(dt, 0.25);
      let settled = 0;
      while (accumulator >= FIXED_STEP) {
        accumulator -= FIXED_STEP;
        steps += 1;
        if (steps === 150) armed = true;
        if (!(CHECKPOINTS as readonly number[]).includes(steps)) continue;
        const hash = worldHash();
        currentRun.set(steps, hash);
        const earlier = previousRun.get(steps);
        if (earlier !== undefined) {
          replayChecked += 1;
          if (earlier !== hash) replayMatch = false;
          console.info(
            `TN_GAME_REPLAY:step=${steps};hash=${hash};previous=${earlier};match=${earlier === hash}`,
          );
        }
        frame.state.set({ replayChecked, replayMatch, simHash: hash });
      }
      let shifted = 0;
      for (const crate of crates) {
        if (crate.settled()) settled += 1;
        if (crate.displaced() > 0.3) shifted += 1;
      }

      // The claim worth making is about the state the world comes to rest in,
      // not about matching frame for frame: the plugin steps physics with the
      // frame's own dt, so two runs never sample the same intermediate states.
      if (restHash === "" && settled === crates.length) {
        restStreak += 1;
        if (restStreak > 45) {
          restHash = worldHash();
          previousRest = restHash;
          const matched = earlierRest === "" ? "run 1 — recorded" : earlierRest === restHash ? "match" : "DIVERGED";
          frame.state.set({ restHash, restMatch: matched });
          console.info(`TN_GAME_REST:hash=${restHash};previous=${earlierRest || "none"};result=${matched}`);
        }
      } else {
        restStreak = 0;
      }

      frame.state.set({
        crates: crates.length,
        playerX: player.position.x,
        playerZ: player.position.z,
        runs: runCount,
        settled,
        shifted,
        travelled,
      });
    };
  }
}
