import {
  CameraShake,
  GPUParticles3D,
  type ICtx,
  Scene,
  type SceneFrame,
  afterPhysics,
  isMobile,
  isTouchscreenAvailable,
} from "@threenative/core";
import { type PerspectiveCamera, Vector3 } from "three";
import { Runner } from "../entities/Runner.js";
import type { RunnerPhysics } from "../physics.js";
import { chaseRunner, setupCamera } from "../render/camera.js";
import { createDustTrail } from "../render/dust.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSky } from "../render/sky.js";
import { TouchControls } from "../render/touch-controls.js";
import { type GameState, INITIAL_STATE } from "../state.js";
import { CHUNK_LENGTH, LANE_X, Track } from "../track.js";

export type GameCtx = ICtx<GameState, RunnerPhysics>;

const START_SPEED = 11;
const TOP_SPEED = 26;
/** Metres per second gained per second run. Reach top speed at about a minute. */
const ACCELERATION = 0.25;

export class Run extends Scene<GameState, RunnerPhysics> {
  static override readonly initialState = INITIAL_STATE;

  override enter(ctx: GameCtx): SceneFrame<GameState, RunnerPhysics> {
    setupSky(ctx.scene);
    const sun = setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    // isMobile() arrives as an argument because src/render/ imports no framework package: the
    // platform decision is made here, in portable game code.
    setupPost(ctx.renderer, ctx.scene, ctx.camera, { godraysLight: sun, mobile: isMobile() });
    const camera = ctx.camera as PerspectiveCamera;
    setupCamera(camera);
    ctx.add(camera);
    const loading = createLoadingScreen(ctx);

    const showTouchControls = isMobile() && isTouchscreenAvailable();
    const touchControls = showTouchControls
      ? ctx.entities.add("touch-controls", new TouchControls(camera))
      : undefined;

    // `ctx.random` is the seeded source `defineGame({ seed })` installed, so the same seed builds
    // the same track — which is what makes a runner's scenario reproducible at all.
    const chunkContext = {
      add: (object: Parameters<typeof ctx.add>[0]) => ctx.add(object),
      physics: ctx.physics,
      random: () => ctx.random(),
    };
    const track = new Track(chunkContext);
    const runner = new Runner(ctx);
    ctx.entities.add("player", runner);

    const dust = ctx.add(new GPUParticles3D(createDustTrail()));
    const shake = new CameraShake({
      amplitude: new Vector3(0.16, 0.1, 0),
      curve: (radians) => Math.sin(radians) * Math.sin(radians * 0.37),
      decay: 6.5,
      frequency: 17,
      rotationAmplitude: new Vector3(0, 0, 0.02),
    });

    let distance = 0;
    let speed = START_SPEED;
    let status = INITIAL_STATE.status;
    let nearMisses = 0;
    const scored = new Set<string>();

    // The camera reads the runner after the step, so a lane change and its shake land in the same
    // frame. Reading it in the frame function is one step of lag at 26 m/s, which is 0.4 m.
    afterPhysics(ctx, (dt) => {
      const offset = shake.update(dt);
      chaseRunner(camera, runner.mesh.position, dt, offset.position);
      dust.position.set(runner.mesh.position.x, 0.15, runner.mesh.position.z + 0.6);
    });

    return (frameCtx, dt) => {
      loading.update();
      if (frameCtx.input.justPressed("restart")) {
        frameCtx.state.set(INITIAL_STATE);
        frameCtx.state.flush();
        void frameCtx.goto("run");
        return;
      }

      const touch = touchControls?.update(frameCtx.input.raw.pointers, frameCtx.viewport.size);
      if (status === "RUNNING") {
        speed = Math.min(TOP_SPEED, speed + ACCELERATION * dt);
        distance += speed * dt;
        runner.update(frameCtx, dt, distance, touch);
        track.advance(chunkContext, distance);
        if (runner.crashed) {
          status = "CRASHED";
          shake.trigger();
        } else {
          // A near miss is an obstacle this chunk passed beside rather than through. Counting it
          // once per obstacle is what stops a single block shaking the camera for a whole second.
          for (const chunk of track.chunks) {
            const passed = distance - chunk.start;
            if (passed < 0 || passed > CHUNK_LENGTH) continue;
            for (const lane of LANE_X) {
              const key = `${chunk.start}:${lane}`;
              if (scored.has(key) || !runner.isNearMiss(lane)) continue;
              scored.add(key);
              runner.recordNearMiss();
              nearMisses = runner.nearMisses;
              shake.trigger();
            }
          }
        }
      }
      dust.visible = status === "RUNNING";

      const previous = frameCtx.state.getState();
      const next: GameState = {
        chunks: track.built,
        distance,
        lane: runner.lane,
        nearMisses,
        paused: previous.paused,
        speed,
        status,
        uiReady: previous.uiReady,
      };
      if (
        next.chunks !== previous.chunks ||
        next.lane !== previous.lane ||
        next.nearMisses !== previous.nearMisses ||
        next.status !== previous.status ||
        Math.floor(next.distance) !== Math.floor(previous.distance)
      )
        frameCtx.state.set(next);
    };
  }
}
