import {
  type ICtx,
  Scene,
  type SceneFrame,
  isMobile,
  isTouchscreenAvailable,
} from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { Fog, type PerspectiveCamera } from "three";
import { Ship } from "../entities/Ship.js";
import { followShip, setupCamera } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { createMaterials } from "../render/materials.js";
import { createOcean, createWaterMesh } from "../render/ocean.js";
import { palette } from "../render/palette.js";
import { setupPost } from "../render/postprocessing.js";
import { createBuoy, createIsland } from "../render/props.js";
import { setupSky } from "../render/sky.js";
import { TouchControls } from "../render/touch-controls.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

const COURSE_BUOYS = [5, 3, 1, -1] as const;

export class Sailing extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    buoysRounded: 0,
    elapsed: 0,
    paused: false,
    shipZ: 7,
    status: "sailing",
    submergedFraction: 0,
    uiReady: false,
    wind: 1,
  };

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    setupSky(ctx.scene);
    // Fog to the horizon colour, and starting far enough out that the island is not eaten. At
    // 30..100 against a dark navy the sea went to slate a boat-length away.
    ctx.scene.fog = new Fog(palette.skyLow, 95, 330);
    const sun = setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer, ctx.scene, ctx.camera, { godraysLight: sun, mobile: isMobile() });
    const loading = createLoadingScreen(ctx);
    const camera = ctx.camera as PerspectiveCamera;
    setupCamera(camera);
    ctx.add(camera);
    const showTouchControls = isMobile() && isTouchscreenAvailable();
    const touchControls = showTouchControls
      ? ctx.entities.add("touch-controls", new TouchControls(camera))
      : undefined;

    // `SpectralOcean` is a compute-driven node: `ctx.add` hands it the renderer and puts its
    // passes in the warmup set. It draws nothing — the mesh and its material are this game's, and
    // both live in `src/render/ocean.ts`.
    const ocean = ctx.add(createOcean());
    ctx.add(createWaterMesh(ocean));

    const materials = createMaterials();
    ctx.add(createIsland(materials));
    for (const [index, z] of COURSE_BUOYS.entries()) {
      const buoy = createBuoy(materials);
      buoy.position.set(index % 2 === 0 ? 0.6 : -0.6, 0, z);
      ctx.add(buoy);
    }

    const ship = new Ship(ctx, ocean);
    ctx.entities.add("player", ship);
    let elapsed = 0;
    let buoysRounded = 0;
    let status: GameState["status"] = "sailing";
    const advanceSailing = (frameCtx: GameCtx, deltaTime: number, wind: number): void => {
      if (frameCtx.input.justPressed("capsize")) {
        ship.capsize();
        status = "lost";
        return;
      }
      ship.update(
        frameCtx,
        deltaTime,
        wind,
        touchControls?.update(frameCtx.input.raw.pointers, frameCtx.viewport.size),
      );
      const nextBuoy = COURSE_BUOYS[buoysRounded];
      if (nextBuoy === undefined || ship.mesh.position.z > nextBuoy) {
        if (wind <= 0) status = "lost";
        return;
      }
      buoysRounded += 1;
      if (buoysRounded === COURSE_BUOYS.length) status = "won";
      else if (wind <= 0) status = "lost";
    };

    return (frameCtx, deltaTime) => {
      loading.update();
      if (frameCtx.input.justPressed("restart")) {
        frameCtx.state.set(Sailing.initialState);
        frameCtx.state.flush();
        void frameCtx.goto("sailing");
        return;
      }

      elapsed += deltaTime;
      const wind = Math.max(0, 1 - elapsed / 45);
      ocean.advance(elapsed);
      if (status === "sailing") advanceSailing(frameCtx, deltaTime, wind);
      // Outside the gameplay gate on purpose. Steering and buoy counting stop when the run ends;
      // the hull still has to be placed on a sea that never stops moving, or the boat freezes
      // mid-wave while the water rolls past underneath it.
      ship.updateVisual(deltaTime);

      const state = frameCtx.state.getState();
      frameCtx.state.set({
        buoysRounded,
        elapsed,
        paused: state.paused,
        shipZ: ship.mesh.position.z,
        status,
        submergedFraction: ship.immersion,
        uiReady: frameCtx.state.getState().uiReady,
        wind,
      });
      // The **visual**, not the body. `Ship` draws the hull from `ship.visual`, whose y is the sea
      // surface; `ship.mesh` is the physics body, whose y wanders on a throttled height copy and
      // is no longer what anything is drawn at. Following the body pointed the camera somewhere
      // the ship was not: the horizon slid up and down behind a hull that was itself steady, so
      // the ship read as bobbing out of the water and back into it.
      followShip(camera, ship.visual.position);
    };
  }
}
