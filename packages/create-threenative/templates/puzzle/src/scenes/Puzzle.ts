import {
  type ICtx,
  Scene,
  type SceneFrame,
  afterPhysics,
  isMobile,
  isTouchscreenAvailable,
} from "@threenative/core";
import { type PerspectiveCamera, Vector3 } from "three";
import { Ball } from "../entities/Ball.js";
import { Crate } from "../entities/Crate.js";
import { Gripper } from "../entities/Gripper.js";
import { Pendulum } from "../entities/Pendulum.js";
import type { PuzzlePhysics } from "../physics.js";
import { followGripper, setupCamera } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { setupPost } from "../render/postprocessing.js";
import { goalRing } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import { TouchControls } from "../render/touch-controls.js";
import { GOAL_POSITION, buildFloorTiles, buildRoom, collideRoom } from "../room.js";
import { FLOOR_FAIL_Y, type GameState, INITIAL_STATE } from "../state.js";

export type GameCtx = ICtx<GameState, PuzzlePhysics>;

/** Where the three crates start. Move them and the puzzle changes; that is the intent. */
const CRATE_SPAWNS = [
  // The first crate sits straight ahead of the claw's spawn, just outside grab range: walking
  // forward and pressing grab is the first thing the room teaches, and `playtests/carry` is that
  // exact walk. Move this and the scenario's hold has to move with it.
  new Vector3(-5.5, 0.6, 6.2),
  new Vector3(-1.6, 0.6, 4.4),
  new Vector3(2.8, 0.6, 5.4),
] as const;
const GRAB_RANGE = 2.1;

export class Puzzle extends Scene<GameState, PuzzlePhysics> {
  static override readonly initialState = INITIAL_STATE;

  override enter(ctx: GameCtx): SceneFrame<GameState, PuzzlePhysics> {
    setupSky(ctx.scene);
    const sun = setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    // isMobile() arrives as an argument because src/render/ imports no framework package: the
    // platform decision is made here, in portable game code.
    setupPost(ctx.renderer, ctx.scene, ctx.camera, { godraysLight: sun, mobile: isMobile() });
    const camera = ctx.camera as PerspectiveCamera;
    setupCamera(camera);
    ctx.add(camera);
    const loading = createLoadingScreen(ctx);

    const room = buildRoom();
    ctx.add(room);
    buildFloorTiles(room);
    collideRoom(ctx, room);
    const ring = goalRing();
    ring.position.set(GOAL_POSITION.x, GOAL_POSITION.y, GOAL_POSITION.z);
    ctx.add(ring);

    const showTouchControls = isMobile() && isTouchscreenAvailable();
    const touchControls = showTouchControls
      ? ctx.entities.add("touch-controls", new TouchControls(camera))
      : undefined;

    const gripper = new Gripper(ctx);
    ctx.entities.add("player", gripper);
    const ball = new Ball(ctx);
    ctx.entities.add("ball", ball);
    const pendulum = new Pendulum(ctx);
    ctx.entities.add("pendulum", pendulum);
    const crates = CRATE_SPAWNS.map((spawn, index) => {
      const crate = new Crate(ctx, spawn, String(index));
      ctx.entities.add(`crate.${index}`, crate);
      return crate;
    });

    let held: Crate | undefined;
    let cratesMoved = 0;
    let elapsed = 0;
    let status = INITIAL_STATE.status;

    const nearest = (): Crate | undefined => {
      let best: Crate | undefined;
      let bestDistance = GRAB_RANGE * GRAB_RANGE;
      for (const crate of crates) {
        const distance = crate.mesh.position.distanceToSquared(gripper.mesh.position);
        if (distance > bestDistance) continue;
        best = crate;
        bestDistance = distance;
      }
      return best;
    };
    const toggleGrab = (): void => {
      if (held !== undefined) {
        held.release();
        held = undefined;
        cratesMoved += 1;
        return;
      }
      held = nearest();
      held?.hold();
    };

    // The pointer is the other way in. `ctx.pointer` dispatches to the meshes the game
    // registered, so a tap on a crate is a grab without a raycast written here.
    for (const crate of crates) {
      ctx.pointer?.on(crate.mesh, "tapped", () => {
        if (held !== undefined) return;
        held = crate;
        crate.hold();
      });
    }

    // The camera reads a body physics has already moved this frame, so it runs after the step
    // rather than before it. Reading in the frame function instead is one step of lag, and on a
    // swinging weight one step of lag is visible.
    afterPhysics(ctx, (dt) => followGripper(camera, gripper.mesh.position, dt));

    return (frameCtx, dt) => {
      loading.update();
      if (frameCtx.input.justPressed("restart")) {
        frameCtx.state.set(INITIAL_STATE);
        frameCtx.state.flush();
        void frameCtx.goto("puzzle");
        return;
      }

      const touch = touchControls?.update(frameCtx.input.raw.pointers, frameCtx.viewport.size);
      elapsed += dt;
      gripper.update(frameCtx, dt, touch);
      if (frameCtx.input.justPressed("grab") || touch?.grabPressed === true) toggleGrab();
      if (frameCtx.input.justPressed("swing") || touch?.swingPressed === true) pendulum.swing();
      held?.carry(gripper.mesh.position, dt);
      if (ball.scored) status = "SOLVED";
      // A ball that left the room is a level bug, not a loss: say so rather than waiting forever.
      if (ball.mesh.position.y < FLOOR_FAIL_Y) ball.body.linearVelocity = { x: 0, y: 0, z: 0 };

      const previous = frameCtx.state.getState();
      const next: GameState = {
        cratesMoved,
        elapsed,
        holding: held !== undefined,
        paused: previous.paused,
        status,
        swings: pendulum.swings,
        uiReady: previous.uiReady,
      };
      if (
        next.cratesMoved !== previous.cratesMoved ||
        next.holding !== previous.holding ||
        next.status !== previous.status ||
        next.swings !== previous.swings ||
        Math.floor(next.elapsed) !== Math.floor(previous.elapsed)
      )
        frameCtx.state.set(next);
    };
  }
}
