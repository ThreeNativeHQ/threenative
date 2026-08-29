import { Atmosphere, type ICtx, Scene, type SceneFrame, solarPosition } from "@threenative/core";
import { Area3D, CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { BoxGeometry, Mesh, type PerspectiveCamera, Vector3 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Player } from "../entities/Player.js";
import { setupCamera } from "../render/camera.js";
import { createHud } from "../render/hud.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import { defaultMaterial, floorMaterial } from "../render/materials.js";
import { setupPost } from "../render/postprocessing.js";
import { setupSky } from "../render/sky.js";
import type { GameState } from "../state.js";

export type GameCtx = ICtx<GameState, IPhysicsContext>;

export class Play extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    playerX: -2,
    score: 0,
    sunAzimuth: 0,
    sunElevation: 0,
    sunTransmittanceRed: 0,
  };

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    const useAtmosphere = ctx.renderer.kind === "webgpu";
    const atmosphere = useAtmosphere
      ? new Atmosphere({
          rayleigh: [0.005802, 0.013558, 0.0331],
          mie: [0.00444, 0.00444, 0.00444],
          ozone: [0.00065, 0.001881, 0.000085],
          planetRadius: 6360,
          atmosphereRadius: 6460,
          resolutions: {
            transmittance: { width: 128, height: 32 },
            multiScattering: { width: 16, height: 16 },
            skyView: { width: 128, height: 72 },
          },
        })
      : undefined;
    const initialSun = solarPosition({
      dayOfYear: 172,
      timeOfDay: 6,
      latitude: 49.28,
      longitude: -123.12,
      utcOffset: -8,
    });
    atmosphere?.setSunDirection(initialSun);
    if (atmosphere !== undefined) {
      ctx.add(atmosphere);
      // Idempotent with the PRD-242 registry when that contract is present; required by the
      // current renderer seam while this template is also usable on WebGL.
      atmosphere.attachRenderer(ctx.renderer);
    }
    setupSky(ctx.scene, atmosphere);
    const lighting = setupLighting(
      ctx.scene,
      ctx.renderer.raw as Parameters<typeof setupLighting>[1],
      atmosphere,
    );
    setupPost(ctx.renderer, ctx.scene, ctx.camera, atmosphere);
    setupCamera(ctx.camera as PerspectiveCamera);
    const loading = createLoadingScreen(ctx);
    ctx.add(ctx.camera);
    const hud = ctx.entities.add("hud", createHud(ctx.camera as PerspectiveCamera, "SCORE"));
    const floor = new Mesh(new BoxGeometry(10, 0.2, 4), floorMaterial);
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    ctx.add(floor);
    const nearWallGeometry = new BoxGeometry(1.4, 2.8, 0.6);
    nearWallGeometry.translate(-3, 1.4, 2.5);
    const distantRidgeGeometry = new BoxGeometry(12_000, 500, 100);
    distantRidgeGeometry.translate(0, 230, -5_000);
    const hazeProbe = new Mesh(
      mergeGeometries([nearWallGeometry, distantRidgeGeometry]),
      defaultMaterial,
    );
    hazeProbe.castShadow = true;
    ctx.add(hazeProbe);
    new RigidBody3D({
      object: floor,
      physics: ctx.physics,
      shape: CollisionShape3D.fromMesh(floor),
      type: "fixed",
    });
    const player = new Player(ctx);
    ctx.entities.add("player", player);
    const pickup = new Area3D({
      physics: ctx.physics,
      position: { x: 1.5, y: 0.5, z: 0 },
      shape: CollisionShape3D.box(1, 1, 1),
    });
    pickup.on("bodyEntered", (body) => {
      if (body === player.body) ctx.state.set((state) => ({ score: state.score + 1 }));
    });

    let elapsed = 0;
    return (frameCtx, dt) => {
      loading.update();
      player.update(frameCtx, dt);
      elapsed += dt;
      const sun = solarPosition({
        dayOfYear: 172,
        timeOfDay: (6 + elapsed * 2) % 24,
        latitude: 49.28,
        longitude: -123.12,
        utcOffset: -8,
      });
      if (atmosphere !== undefined) {
        atmosphere.setSunDirection(sun);
        lighting.updateSun(atmosphere.getSunDirection());
      }
      const state = frameCtx.state.getState();
      hud.update({
        primary: state.score,
        seconds: elapsed,
      });
      frameCtx.state.set({
        playerX: player.mesh.position.x,
        sunAzimuth: sun.azimuth,
        sunElevation: sun.elevation,
      });
      if (atmosphere !== undefined) {
        // The sun's angle is plain arithmetic and keeps moving with the atmosphere deleted, so a
        // scenario asserting only on it proves nothing. This number cannot be produced without
        // the node, which is what makes the atmosphere playtest able to go red.
        const transmittance = atmosphere.sunTransmittance(atmosphere.getSunDirection());
        if (transmittance instanceof Vector3)
          frameCtx.state.set({ sunTransmittanceRed: transmittance.x });
      }
    };
  }
}
