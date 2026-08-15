import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import {
  CollisionShape3D,
  type IPhysicsContext,
  type PhysicsBody3D,
  RigidBody3D,
} from "@threenative/physics";
import { Object3D, type PerspectiveCamera, Vector2 } from "three";
import { Crate, isSettled } from "../entities/Crate.js";
import { Goal } from "../entities/Goal.js";
import { Player } from "../entities/Player.js";
import { Reach } from "../entities/Reach.js";
import {
  buildLayout,
  LAYER_WORLD,
  ROOM_HALF,
  WALL_HEIGHT,
  WALL_THICKNESS,
  WORLD_SEED,
} from "../level/layout.js";
import { createIsometricView } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { buildRoom } from "../render/room.js";
import { setupSky } from "../render/sky.js";
import { digestTransforms, REPLAY_TICKS, replayAction } from "../replay/check.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

const KILL_PLANE = -6;
/** Ground speed above which a crate beside the character counts as shoved. */
const PUSH_SPEED = 0.35;

const liveMove = new Vector2();
/** The output node survives a scene rebuild, so it is installed once per session. */
let postInstalled = false;

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    bodies: 0,
    goalContacts: 0,
    phantomOverlaps: 0,
    phantomPasses: 0,
    playerX: 0,
    playerY: 0,
    playerZ: 0,
    pushes: 0,
    replayChecks: 0,
    replayHashA: "",
    replayHashB: "",
    replayMatch: false,
    replayPhase: "idle",
    replayTick: 0,
    seed: WORLD_SEED,
    settled: 0,
    solved: false,
    solvedBy: "",
  };

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    // Every entry rebuilds the identical room, which is what lets a replay run
    // start from the world the previous run started from. `ctx.random` is
    // reseeded for the same reason: a generator carrying its position across a
    // restart would quietly make the second run a different level.
    ctx.random.state = WORLD_SEED;

    const view = createIsometricView(ctx.camera as PerspectiveCamera);
    setupSky(ctx.scene);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    if (!postInstalled) {
      setupPost(ctx.renderer, ctx.scene, ctx.camera);
      postInstalled = true;
    }
    ctx.add(ctx.camera);
    view.apply();

    const materials = createMaterials();
    ctx.add(buildRoom(materials));
    buildStaticBodies(ctx);

    const crates = buildLayout().map((spec) => {
      const crate = new Crate(ctx, spec, materials);
      ctx.entities.add(crate.id, crate);
      return crate;
    });
    const player = new Player(ctx, materials, view);
    ctx.entities.add("player", player);
    const goal = new Goal(ctx, materials);
    ctx.entities.add("goal", goal);
    const reach = new Reach(ctx, player.mesh.position);
    ctx.entities.add("reach", reach);

    const crateByBody = new Map<PhysicsBody3D, Crate>(crates.map((crate) => [crate.body, crate]));
    const inside = new Set<PhysicsBody3D>();
    const touching = new Set<Crate>();

    // Contact, not proximity: a solid cannot overlap the character's capsule, so
    // anything the simulation reports inside the reach shell is against it.
    reach.area.on("bodyEntered", (body) => {
      const crate = crateByBody.get(body);
      if (crate === undefined) return;
      touching.add(crate);
      if (crate.kind !== "phantom") return;
      ctx.state.set((current) => ({ phantomPasses: current.phantomPasses + 1 }));
      ctx.state.flush();
    });
    reach.area.on("bodyExited", (body) => {
      const crate = crateByBody.get(body);
      if (crate !== undefined) touching.delete(crate);
    });

    goal.area.on("bodyEntered", (body) => inside.add(body));
    goal.area.on("bodyExited", (body) => inside.delete(body));

    /**
     * The only win path, and it has two halves that both have to hold.
     *
     * The body must be *in* the destination — an `Area3D` sensor overlap the
     * simulation reported, never a distance the game measured. And it must have
     * got there through the character: the character itself, or a crate the
     * reach volume saw the character shove. Provenance matters because the
     * initial drop throws crates several metres and one of them landing on the
     * pad by luck is not a solved puzzle.
     */
    const delivered = (): string | undefined => {
      for (const body of inside) {
        if (body === (player.body as PhysicsBody3D)) return "player";
        const crate = crateByBody.get(body);
        if (crate?.pushed === true) return crate.id;
      }
      return undefined;
    };

    ctx.state.set({
      bodies: crates.length,
      goalContacts: 0,
      phantomOverlaps: 0,
      playerX: player.mesh.position.x,
      playerY: player.mesh.position.y,
      playerZ: player.mesh.position.z,
      pushes: 0,
      seed: WORLD_SEED,
      settled: 0,
    });

    return (frameCtx, dt) => {
      const state = frameCtx.state.getState();

      if (frameCtx.input.justPressed("restart")) {
        frameCtx.state.set({ ...Play.initialState });
        frameCtx.state.flush();
        void frameCtx.goto("play");
        return;
      }

      const replaying = state.replayPhase === "run1" || state.replayPhase === "run2";
      if (!replaying && frameCtx.input.justPressed("replay")) {
        frameCtx.state.set({
          replayHashA: "",
          replayHashB: "",
          replayMatch: false,
          replayPhase: "run1",
          replayTick: 0,
        });
        frameCtx.state.flush();
        void frameCtx.goto("play");
        return;
      }

      const move = replaying
        ? replayAction(state.replayTick)
        : liveMove.copy(frameCtx.input.vector("move"));
      player.update(dt, move);
      if (player.mesh.position.y < KILL_PLANE) player.respawn();
      reach.follow(player.mesh.position);

      let settled = 0;
      let pushes = 0;
      let phantomOverlaps = 0;
      for (const crate of crates) crate.setOccupied(false);
      for (const crate of touching) {
        if (crate.kind === "phantom") {
          crate.setOccupied(true);
          phantomOverlaps += 1;
          continue;
        }
        // Touching the character and moving under its own steam: a shove.
        const velocity = crate.body.linearVelocity;
        if (Math.hypot(velocity.x, velocity.z) > PUSH_SPEED) crate.pushed = true;
      }
      for (const crate of crates) {
        if (isSettled(crate)) settled += 1;
        if (crate.pushed) pushes += 1;
      }

      const carrier = state.solved ? undefined : delivered();
      frameCtx.state.set({
        goalContacts: inside.size,
        phantomOverlaps,
        playerX: player.mesh.position.x,
        playerY: player.mesh.position.y,
        playerZ: player.mesh.position.z,
        pushes,
        settled,
        ...(carrier === undefined ? {} : { solved: true, solvedBy: carrier }),
      });
      if (carrier !== undefined || phantomOverlaps !== state.phantomOverlaps) {
        frameCtx.state.flush();
      }

      if (!replaying) return;
      const tick = state.replayTick + 1;
      if (tick < REPLAY_TICKS) {
        frameCtx.state.set({ replayTick: tick });
        return;
      }
      const digest = digestTransforms([...crates.map((crate) => crate.mesh), player.mesh]);
      if (state.replayPhase === "run1") {
        frameCtx.state.set({ replayHashA: digest, replayPhase: "run2", replayTick: 0 });
      } else {
        frameCtx.state.set({
          replayChecks: state.replayChecks + 1,
          replayHashB: digest,
          replayMatch: digest === state.replayHashA,
          replayPhase: "done",
          replayTick: 0,
        });
      }
      frameCtx.state.flush();
      void frameCtx.goto("play");
    };
  }
}

/** Floor and four walls as fixed bodies, so the room bounds are simulated, not drawn. */
function buildStaticBodies(ctx: GameCtx): void {
  const span = ROOM_HALF * 2;
  const edge = ROOM_HALF + WALL_THICKNESS / 2;
  type Slab = readonly [
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
  ];
  const slabs: readonly Slab[] = [
    [span, 0.6, span, 0, -0.3, 0],
    [span + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS, 0, WALL_HEIGHT / 2, -edge],
    [span + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS, 0, WALL_HEIGHT / 2, edge],
    [WALL_THICKNESS, WALL_HEIGHT, span + WALL_THICKNESS * 2, -edge, WALL_HEIGHT / 2, 0],
    [WALL_THICKNESS, WALL_HEIGHT, span + WALL_THICKNESS * 2, edge, WALL_HEIGHT / 2, 0],
  ];
  for (const [index, [width, height, depth, x, y, z]] of slabs.entries()) {
    // The visible room is drawn by `render/room.ts`; this proxy only carries a
    // transform for the collider, which is why it is never added to the scene.
    const proxy = new Object3D();
    proxy.position.set(x, y, z);
    proxy.name = `static-${index}`;
    new RigidBody3D({
      collisionLayer: LAYER_WORLD,
      entity: `static:${index}`,
      object: proxy,
      physics: ctx.physics,
      shape: CollisionShape3D.box(width, height, depth),
      type: "fixed",
    });
  }
}
