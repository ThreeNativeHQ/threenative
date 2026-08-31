import { type ICtx, Scene, type SceneFrame, WaveField, isMobile } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { Fog, Mesh, type PerspectiveCamera, PlaneGeometry } from "three";
import { Ship } from "../entities/Ship.js";
import { followShip, setupCamera } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { createMaterials } from "../render/materials.js";
import { SAILING_DOMAIN_WARP, SAILING_WAVES, palette } from "../render/palette.js";
import { setupPost } from "../render/postprocessing.js";
import { createBuoy, createIsland } from "../render/props.js";
import { setupSky } from "../render/sky.js";
import { createWaterMaterial } from "../render/water-material.js";
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
    ctx.scene.fog = new Fog(palette.skyLow, 30, 100);
    const sun = setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer, ctx.scene, ctx.camera, { godraysLight: sun, mobile: isMobile() });
    const loading = createLoadingScreen(ctx);
    const camera = ctx.camera as PerspectiveCamera;
    setupCamera(camera);

    const field = new WaveField({ waves: SAILING_WAVES, domainWarp: SAILING_DOMAIN_WARP });
    const water = new Mesh(new PlaneGeometry(80, 80, 96, 96), createWaterMaterial(field));
    water.geometry.rotateX(-Math.PI / 2);
    water.receiveShadow = true;
    water.frustumCulled = false;
    ctx.add(water);

    const materials = createMaterials();
    ctx.add(createIsland(materials));
    for (const [index, z] of COURSE_BUOYS.entries()) {
      const buoy = createBuoy(materials);
      buoy.position.set(index % 2 === 0 ? 0.6 : -0.6, 0, z);
      ctx.add(buoy);
    }

    const ship = new Ship(ctx, field);
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
      ship.update(frameCtx, deltaTime, wind);
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
      field.setTime(elapsed);
      const wind = Math.max(0, 1 - elapsed / 45);
      if (status === "sailing") advanceSailing(frameCtx, deltaTime, wind);

      const state = frameCtx.state.getState();
      frameCtx.state.set({
        buoysRounded,
        elapsed,
        paused: state.paused,
        shipZ: ship.mesh.position.z,
        status,
        submergedFraction: ship.buoyancy.submergedFraction,
        uiReady: frameCtx.state.getState().uiReady,
        wind,
      });
      followShip(camera, ship.mesh.position);
    };
  }
}
