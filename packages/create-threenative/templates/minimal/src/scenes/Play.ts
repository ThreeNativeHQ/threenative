import {
  Atmosphere,
  GPUSceneBVH,
  type ICtx,
  Scene,
  type SceneFrame,
  SurfelGI,
  isMobile,
  solarPosition,
} from "@threenative/core";
import { Area3D, CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { BoxGeometry, Mesh, type PerspectiveCamera, Vector3 } from "three";
import { Player } from "../entities/Player.js";
import { setupCamera } from "../render/camera.js";
import { createHud } from "../render/hud.js";
import { setupLighting } from "../render/lighting.js";
import { createLoadingScreen } from "../render/loading.js";
import {
  defaultMaterial,
  floorMaterial,
  giReceiverMaterial,
  setWallColour,
  wallMaterial,
} from "../render/materials.js";
import { createIndirectLighting, setupPost } from "../render/postprocessing.js";
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
    giCoverage: 0,
    giBounceRed: 0,
    giBounceDeltaRed: 0,
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
    const solarInput = {
      dayOfYear: 172,
      timeOfDay: 6,
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
    setupCamera(ctx.camera as PerspectiveCamera);
    const loading = createLoadingScreen(ctx);
    ctx.add(ctx.camera);
    const hud = ctx.entities.add("hud", createHud(ctx.camera as PerspectiveCamera, "SCORE"));
    const floor = new Mesh(new BoxGeometry(10, 0.2, 4), floorMaterial);
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    floor.userData.traceable = true;
    ctx.add(floor);
    const nearWallGeometry = new BoxGeometry(1.4, 2.8, 0.6);
    nearWallGeometry.translate(-3, 1.4, 2.5);
    const distantRidgeGeometry = new BoxGeometry(12_000, 500, 100);
    distantRidgeGeometry.translate(0, 230, -5_000);
    const wall = new Mesh(nearWallGeometry, wallMaterial);
    setWallColour(false);
    const indirectLighting = createIndirectLighting(lighting.key);
    wall.castShadow = true;
    wall.userData.traceable = true;
    ctx.add(wall);
    // Keep the receiver in the wall's near hash cell so the bounded gather can show its bounce.
    const giReceiver = new Mesh(new BoxGeometry(1.1, 0.7, 0.04), giReceiverMaterial);
    giReceiver.position.set(-3.35, 0.35, 2.85);
    ctx.add(giReceiver);
    const hazeProbe = new Mesh(distantRidgeGeometry, defaultMaterial);
    hazeProbe.castShadow = true;
    ctx.add(hazeProbe);
    let gi: SurfelGI | undefined;
    let wallColourChanged = false;
    const createIndirectLight =
      ctx.renderer.kind === "webgpu"
        ? () => {
            if (gi !== undefined) return gi;
            const sceneBvh = ctx.add(
              new GPUSceneBVH(ctx.scene, {
                include: (object) => object.userData.traceable === true,
              }),
            );
            gi = ctx.add(
              new SurfelGI({
                camera: ctx.camera,
                hashCellCount: 64,
                hashCellSize: 3,
                maxAge: 600,
                rayBudget: 64,
                sampleRadius: 0.5,
                scene: ctx.scene,
                sceneBvh,
                surfelBudget: 256,
                updateCadence: 30,
                lighting: indirectLighting,
                originBias: 0.001,
              }),
            );
            return gi;
          }
        : undefined;
    setupPost(ctx.renderer, ctx.scene, ctx.camera, {
      atmosphere,
      createIndirectLight,
      godraysLight: lighting.key,
      mobile: isMobile(),
    });
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
    let freezeLighting = false;
    let giBounceBaseline: number | undefined;
    let giBounceAfterRecolour: number | undefined;
    let giReadbackInFlight = false;
    let giReadbackEpoch = 0;
    let giObservationFrame = 0;
    let giRecolourFrame = -1;
    const requestGiObservation = (): void => {
      giObservationFrame += 1;
      if (
        gi === undefined ||
        ctx.renderer.kind !== "webgpu" ||
        giReadbackInFlight ||
        (wallColourChanged && giBounceAfterRecolour !== undefined) ||
        (!wallColourChanged && giBounceBaseline !== undefined) ||
        (wallColourChanged && giObservationFrame - giRecolourFrame < gi.updateCadence) ||
        giObservationFrame % 4 !== 0
      )
        return;
      giReadbackInFlight = true;
      const epoch = giReadbackEpoch;
      // `process()` dispatches after this scene frame. Deferring the copy to the microtask queue
      // makes its command follow that dispatch even when the playtest advances many fixed ticks
      // without presenting a browser frame; a synchronous copy can legally observe the previous
      // colour while the changed compute is still queued.
      void Promise.resolve().then(() => {
        if (epoch !== giReadbackEpoch || gi === undefined) {
          giReadbackInFlight = false;
          return;
        }
        return ctx.renderer
          .readback(gi.pool.radiance.value)
          .then((bytes) => {
            if (epoch !== giReadbackEpoch || gi === undefined) return;
            const data = new Float32Array(bytes);
            const laneCount = Math.min(gi.pool.capacity, Math.floor(data.length / 4));
            let red = 0;
            let activeLanes = 0;
            for (let index = 0; index < laneCount; index += 1) {
              if ((gi.pool.active.value.array[index] as number | undefined) === 0) continue;
              activeLanes += 1;
              red += data[index * 4] ?? 0;
            }
            const observedRed = activeLanes === 0 ? 0 : red / activeLanes;
            if (wallColourChanged) {
              if (giBounceBaseline === undefined) return;
              giBounceAfterRecolour = observedRed;
            } else if (observedRed > 0) {
              giBounceBaseline = observedRed;
            } else {
              return;
            }
            ctx.state.set({
              giBounceRed: observedRed,
              giBounceDeltaRed:
                wallColourChanged && giBounceAfterRecolour !== undefined
                  ? Math.abs(giBounceAfterRecolour - giBounceBaseline)
                  : 0,
            });
          })
          .catch(() => undefined)
          .finally(() => {
            giReadbackInFlight = false;
          });
      });
    };
    const statePatch: Partial<GameState> = {};
    return (frameCtx, dt) => {
      loading.update();
      player.update(frameCtx, dt);
      if (frameCtx.input.justPressed("freezeLighting")) freezeLighting = true;
      if (!freezeLighting) {
        elapsed += dt;
        solarInput.timeOfDay = (6 + elapsed * 2) % 24;
        solarPosition(solarInput, sun);
        if (atmosphere !== undefined) {
          atmosphere.setSunDirection(sun);
          lighting.updateSun(atmosphere.getSunDirection());
        }
      }
      if (frameCtx.input.justPressed("recolour")) {
        wallColourChanged = !wallColourChanged;
        setWallColour(wallColourChanged);
        giReadbackEpoch += 1;
        giBounceAfterRecolour = undefined;
        giRecolourFrame = giObservationFrame;
      }
      const state = frameCtx.state.getState();
      hud.update({
        primary: state.score,
        seconds: elapsed,
      });
      statePatch.giCoverage = gi?.coverage ?? 0;
      requestGiObservation();
      const giBounceRed =
        gi === undefined
          ? 0
          : ((wallColourChanged ? giBounceAfterRecolour : giBounceBaseline) ?? 0);
      statePatch.giBounceRed = giBounceRed;
      statePatch.giBounceDeltaRed =
        wallColourChanged && giBounceBaseline !== undefined && giBounceAfterRecolour !== undefined
          ? Math.abs(giBounceAfterRecolour - giBounceBaseline)
          : 0;
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
