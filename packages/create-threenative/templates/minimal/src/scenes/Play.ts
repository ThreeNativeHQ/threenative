import {
  Atmosphere,
  type ICtx,
  Scene,
  type SceneFrame,
  isMobile,
  isTouchscreenAvailable,
  solarPosition,
} from "@threenative/core";
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
import { TouchControls } from "../render/touch-controls.js";
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
    const showTouchControls = isMobile() && isTouchscreenAvailable();
    const useAtmosphere = ctx.renderer.kind === "webgpu" && !showTouchControls;
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
    const solarInput = {
      dayOfYear: 172,
      // Late morning. At 6 the sun clears the horizon by a couple of degrees at this latitude and
      // the atmosphere has almost no light to scatter: the smallest template's first frame was a
      // dark slab under a black sky, which is a poor advertisement for a physically-based sky.
      // The fix is the sun, not the exposure — `sky.ts` explains why the radiance multiplier
      // cannot simply be raised, since the same radiance is also fed to aerial perspective. At
      // 11.75 the sun is around fifty degrees up and the scattering does the work it is there for.
      timeOfDay: 11.75,
      latitude: 49.28,
      longitude: -123.12,
      utcOffset: -8,
    };
    const sun = { azimuth: 0, elevation: 0 };
    solarPosition(solarInput, sun);
    atmosphere?.setSunDirection(sun);
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
    // isMobile() arrives as an argument because src/render/ imports no framework package: the
    // platform decision is made here, in portable game code, exactly like createRandom.
    setupPost(ctx.renderer, ctx.scene, ctx.camera, {
      atmosphere,
      godraysLight: lighting.key,
      mobile: isMobile(),
    });
    setupCamera(ctx.camera as PerspectiveCamera);
    const loading = createLoadingScreen(ctx);
    ctx.add(ctx.camera);
    const touchControls = showTouchControls
      ? ctx.entities.add("touch-controls", new TouchControls(ctx.camera as PerspectiveCamera))
      : undefined;
    const hud = ctx.entities.add("hud", createHud(ctx.camera as PerspectiveCamera, "SCORE"));
    const floor = new Mesh(new BoxGeometry(10, 0.2, 4), floorMaterial);
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    ctx.add(floor);
    // Two things at very different distances, so aerial perspective has something to work on:
    // a marker beside the player and a range of hills five kilometres away. Both used to be plain
    // boxes — the far one a single 12 km x 500 m slab — and the frame showed a flat blue stripe
    // ruled across the sky above a grey monolith. Same probe, same one draw call, but the near
    // one reads as a marker and the far one as a horizon.
    const marker = new BoxGeometry(0.7, 2.4, 0.7);
    marker.translate(-3, 1.2, 2.5);
    const markerCap = new BoxGeometry(1, 0.22, 1);
    markerCap.translate(-3, 2.5, 2.5);
    // Seeded, so two captures of the same build frame the same skyline.
    let seed = 20_260_906;
    const jitter = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const ridges: BoxGeometry[] = [];
    for (let index = 0; index < 14; index += 1) {
      const height = 260 + jitter() * 620;
      const width = 900 + jitter() * 1_500;
      const peak = new BoxGeometry(width, height, 260 + jitter() * 300);
      peak.translate(
        -6_000 + index * 900 + jitter() * 320,
        height / 2 - 40,
        -4_600 - jitter() * 1_400,
      );
      ridges.push(peak);
    }
    const hazeProbe = new Mesh(mergeGeometries([marker, markerCap, ...ridges]), defaultMaterial);
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
    const statePatch: Partial<GameState> = {};
    return (frameCtx, dt) => {
      loading.update();
      player.update(
        frameCtx,
        dt,
        touchControls?.update(frameCtx.input.raw.pointers, frameCtx.viewport.size),
      );
      elapsed += dt;
      solarInput.timeOfDay = (6 + elapsed * 2) % 24;
      solarPosition(solarInput, sun);
      if (atmosphere !== undefined) {
        atmosphere.setSunDirection(sun);
        lighting.updateSun(atmosphere.getSunDirection());
      }
      const state = frameCtx.state.getState();
      hud.update({
        primary: state.score,
        seconds: elapsed,
      });
      statePatch.playerX = player.mesh.position.x;
      statePatch.sunAzimuth = sun.azimuth;
      statePatch.sunElevation = sun.elevation;
      if (atmosphere !== undefined) {
        // The sun's angle is plain arithmetic and keeps moving with the atmosphere deleted, so a
        // scenario asserting only on it proves nothing. This number cannot be produced without
        // the node, which is what makes the atmosphere playtest able to go red.
        const transmittance = atmosphere.sunTransmittance(atmosphere.getSunDirection());
        if (transmittance instanceof Vector3) statePatch.sunTransmittanceRed = transmittance.x;
      }
      frameCtx.state.set(statePatch);
    };
  }
}
