import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import { Area3D, CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from "three";
import { Crate, LAYER, MASK } from "../entities/Crate.js";
import { Player, SPAWN } from "../entities/Player.js";
import { CAMERA_YAW, createRoomCamera } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { GOAL, ROOM, buildRoom, wallSlabs } from "../render/room.js";
import { makeRandom } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

/** Ticks the crates fall untouched before the player is handed control. */
const DROP_TICKS = 180;
const REST_SPEED = 0.08;
const BASELINE_KEY = "cratefall.settleHash";

const COLORS = ["amber", "rust", "teal"] as const;

let entries = 0;

/**
 * The determinism proof. Every dynamic body's transform, quantised to a
 * centimetre and a hundredth of a quaternion unit, folded into one FNV-1a
 * digest. Two runs of the same seed and the same fixed step have to agree.
 */
function hashBodies(crates: readonly Crate[]): string {
  let hash = 0x811c9dc5;
  for (const crate of crates) {
    const { position: p, quaternion: q } = crate.object;
    for (const value of [p.x, p.y, p.z, q.x, q.y, q.z, q.w]) {
      hash = Math.imul(hash ^ (Math.round(value * 100) | 0), 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function readBaseline(): string {
  try {
    return globalThis.sessionStorage?.getItem(BASELINE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeBaseline(hash: string): void {
  try {
    globalThis.sessionStorage?.setItem(BASELINE_KEY, hash);
  } catch {
    /* Storage is optional; the in-session comparison still runs on restart. */
  }
}

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    bodies: 0,
    settled: 0,
    contacts: 0,
    passthroughs: 0,
    distance: 0,
    goal: false,
    goalBy: "",
    phase: "drop",
    determinism: "pending",
    settleHash: "",
    baselineHash: "",
    tick: 0,
  };

  /**
   * Restarting with `goto("play")` builds a second Play and starts its frame
   * callback, but the previous scene's callback keeps being ticked as well:
   * without this flag the tick never resets, both callbacks write the same
   * store, and the settle hash is recomputed against a world that already has
   * two players in it. `exit` is the only hook that says "you are done".
   */
  #alive = false;

  override exit(): void {
    this.#alive = false;
  }

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    this.#alive = true;
    console.info(`TN_GAME_ENTER:${++entries}`);
    ctx.state.set(Play.initialState);
    setupSky(ctx.scene);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer, ctx.scene, ctx.camera);
    const loading = createLoadingScreen(ctx);

    const camera = ctx.camera as PerspectiveCamera;
    const rig = createRoomCamera(camera);
    ctx.viewport.onResize(() => rig.frame());

    const materials = createMaterials();
    const room = buildRoom(materials);
    ctx.add(room.root);

    new RigidBody3D({
      collisionLayer: LAYER.world,
      collisionMask: MASK.world,
      object: room.floor,
      physics: ctx.physics,
      shape: CollisionShape3D.box(ROOM.halfX * 2, 0.6, ROOM.halfZ * 2),
      type: "fixed",
    });
    for (const slab of wallSlabs()) {
      const anchor = new Mesh(new BoxGeometry(0.01, 0.01, 0.01), new MeshBasicMaterial());
      anchor.visible = false;
      anchor.position.set(slab.x, ROOM.wallHeight / 2, slab.z);
      ctx.add(anchor);
      new RigidBody3D({
        collisionLayer: LAYER.world,
        collisionMask: MASK.world,
        object: anchor,
        physics: ctx.physics,
        shape: CollisionShape3D.box(slab.width, ROOM.wallHeight, slab.depth),
        type: "fixed",
      });
    }

    // Seeded layout: the same crates in the same places on every run.
    const random = makeRandom(ctx.random.state | 0 || 90210);
    const jitter = (amount: number): number => (random() - 0.5) * amount;
    const crates: Crate[] = [];
    const addCrate = (
      x: number,
      y: number,
      z: number,
      index: number,
      kind: "solid" | "ghost" = "solid",
      yaw = 0,
    ): void => {
      crates.push(
        new Crate(ctx, materials, {
          color: COLORS[index % COLORS.length] ?? "amber",
          kind,
          position: { x, y, z },
          yaw,
        }),
      );
    };

    let index = 0;
    // The wall the puzzle is about: four wide, three tall, two deep, dropped
    // from just above its resting height so it lands, shifts and settles.
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        for (let layer = 0; layer < 2; layer += 1) {
          addCrate(
            -2.6 + column * 1.04 + jitter(0.05),
            1.15 + row * 1.06,
            -1.6 + layer * 1.04 + jitter(0.05),
            index++,
            "solid",
            jitter(0.06),
          );
        }
      }
    }
    // Loose crates around the room, two of them dropped high enough to topple.
    const loose: [number, number, number][] = [
      [-7.4, 0.55, -2.4],
      [-6.4, 0.55, 1.2],
      [-4.2, 4.2, -3.9],
      [1.4, 0.55, -4.0],
      [3.4, 5.0, -2.6],
      [5.0, 0.55, 0.6],
      [6.8, 0.55, 1.9],
      [7.6, 0.55, -1.1],
      [2.2, 0.55, 3.4],
      [4.4, 0.55, 3.9],
      [-1.2, 0.55, 3.8],
      [6.2, 1.7, 2.0],
      [-3.4, 0.55, 3.5],
      [-0.6, 0.55, 2.9],
      [2.8, 3.4, 2.4],
    ];
    for (const [x, y, z] of loose) addCrate(x, y, z, index++, "solid", jitter(1.2));
    // The two crates the player walks straight through.
    addCrate(1.9, 0.55, 0.4, index++, "ghost");
    addCrate(4.0, 0.55, -3.6, index++, "ghost");

    const player = new Player(ctx, materials.player);
    ctx.entities.add("player", player);
    ctx.state.set({ bodies: crates.length });

    // Contact reporting. Both of these are real overlap events from the
    // simulation: the solid probe can only fire on layers the player collides
    // with, the ghost probe only on the layer it passes through.
    const probeShape = (): CollisionShape3D => CollisionShape3D.box(1.1, 1.4, 1.1);
    const solidProbe = new Area3D({
      collisionLayer: LAYER.player,
      collisionMask: LAYER.solid,
      physics: ctx.physics,
      position: SPAWN,
      shape: probeShape(),
    });
    const ghostProbe = new Area3D({
      collisionLayer: LAYER.player,
      collisionMask: LAYER.ghost,
      physics: ctx.physics,
      position: SPAWN,
      shape: probeShape(),
    });
    solidProbe.on("bodyEntered", () => {
      ctx.state.set((state) => ({ contacts: state.contacts + 1 }));
    });
    ghostProbe.on("bodyEntered", () => {
      ctx.state.set((state) => ({ passthroughs: state.passthroughs + 1 }));
    });

    const goal = new Area3D({
      collisionLayer: LAYER.world,
      collisionMask: MASK.goal,
      physics: ctx.physics,
      position: { x: GOAL.x, y: 0.7, z: GOAL.z },
      shape: CollisionShape3D.box(2.6, 1.6, 2.6),
    });
    goal.on("bodyEntered", (body) => {
      if (ctx.state.getState().goal) return;
      const by = body === player.body ? "player" : "crate";
      ctx.state.set({ goal: true, goalBy: by, phase: "won" });
      console.info(`TN_GAME_GOAL_REACHED:${by}`);
    });

    let tick = 0;
    let travelled = 0;
    const last = new Vector3().copy(player.position);
    return (frame, dt) => {
      if (!this.#alive) return;
      loading.update();
      if (frame.input.justPressed("restart")) {
        void frame.goto("play");
        return;
      }

      tick += 1;
      const dropping = tick < DROP_TICKS;
      // The measured window has no player input by construction, so two runs
      // of the same seed feed the solver the same sequence.
      const move = dropping ? { x: 0, y: 0 } : frame.input.vector("move");
      player.update(move, CAMERA_YAW, dt);

      travelled += last.distanceTo(player.position);
      last.copy(player.position);
      const probeAt = {
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
      };
      solidProbe.setPosition(probeAt);
      ghostProbe.setPosition(probeAt);

      let settled = 0;
      for (const crate of crates) {
        const v = crate.body.linearVelocity;
        if (Math.hypot(v.x, v.y, v.z) < REST_SPEED) settled += 1;
      }

      const patch: Partial<GameState> = {
        distance: travelled,
        settled,
        tick,
        phase: frame.state.getState().goal ? "won" : dropping ? "drop" : "play",
      };
      if (tick === DROP_TICKS) {
        const hash = hashBodies(crates);
        const baseline = readBaseline();
        if (baseline === "") writeBaseline(hash);
        patch.settleHash = hash;
        patch.baselineHash = baseline === "" ? hash : baseline;
        patch.determinism = baseline === "" ? "pending" : baseline === hash ? "match" : "mismatch";
        console.info(
          `TN_GAME_SETTLE_HASH:${hash} baseline=${baseline || hash} settled=${settled}/${crates.length}`,
        );
      }
      frame.state.set(patch);
    };
  }
}
