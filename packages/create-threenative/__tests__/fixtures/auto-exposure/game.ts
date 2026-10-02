import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  type PerspectiveCamera,
} from "three";
import { pass } from "three/tsl";
import type { WebGPURenderer } from "three/webgpu";
import { type ICtx, Scene, defineGame } from "../../../../core/dist/index.js";
import { playtest } from "../../../../core/dist/playtest.js";
import { applyExposure } from "../../../template-assets/autoExposure.js";
import { exposureSettings } from "../../../template-assets/exposure.js";
import { createFixedExposureRooms } from "./fixedRooms.js";
import { ObservedExposureNode } from "./observedExposure.js";

export interface IExposureFixtureOptions {
  enabled: boolean;
  bright: boolean;
  stops: number;
  snapGain: number;
  deterministic?: boolean;
  coldBoot?: boolean;
  cameraCut?: boolean;
}

/** Portable scene and engine loop. The browser entry only supplies controls and mounts the canvas. */
export function createExposureFixture(options: IExposureFixtureOptions) {
  class ExposureRoom extends Scene {
    #dispose = () => {};

    override enter(ctx: ICtx) {
      const camera = ctx.camera as PerspectiveCamera;
      camera.position.set(6, 4, 9);
      camera.lookAt(0, 1.2, 0);
      let bright = options.bright;
      const fixedRooms =
        options.cameraCut === true
          ? createFixedExposureRooms(ctx.scene, camera, options.stops)
          : undefined;
      let applyLight = () => {};
      let disposeRoom = () => {};
      if (fixedRooms === undefined) {
        const floor = new BoxGeometry(12, 0.2, 12);
        const block = new BoxGeometry(1, 1, 1);
        const materials = [0x9a9a9a, 0xa34a25, 0x246d95, 0xd9c989].map(
          (color) => new MeshStandardMaterial({ color, roughness: 0.85 }),
        );
        const ground = new Mesh(floor, materials[0]);
        ground.position.y = -0.1;
        ctx.add(ground);
        for (let i = 0; i < 12; i++) {
          const box = new Mesh(block, materials[i % materials.length]);
          box.position.set(
            (i % 4) * 1.8 - 2.7,
            0.5 + Math.floor(i / 4) * 0.2,
            Math.floor(i / 4) * 1.8 - 1.8,
          );
          box.scale.y = 1 + Math.floor(i / 4) * 0.4;
          ctx.add(box);
        }
        const sun = new DirectionalLight(0xfff4df, 1);
        sun.position.set(4, 7, 3);
        const fill = new AmbientLight(0xffffff, 1);
        ctx.add(sun);
        ctx.add(fill);
        applyLight = () => {
          const intensity = 0.01 * (bright ? 2 ** options.stops : 1);
          sun.intensity = intensity * 3;
          fill.intensity = intensity;
          ctx.scene.background = new Color(0x445565).multiplyScalar(intensity);
        };
        applyLight();
        disposeRoom = () => {
          floor.dispose();
          block.dispose();
          for (const material of materials) material.dispose();
        };
      } else {
        fixedRooms.setPose(bright);
        disposeRoom = () => fixedRooms.dispose();
      }
      const renderer = ctx.renderer.raw as WebGPURenderer;
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;
      const worldPass = pass(ctx.scene, ctx.camera);
      const colour = worldPass.getTextureNode("output");
      const exposure = new ObservedExposureNode(
        colour,
        {
          ...exposureSettings,
          enabled: options.enabled,
          snapGain: options.snapGain,
          reportInterval: options.deterministic === true || options.coldBoot === true ? 1e-6 : 0.1,
        },
        1,
      );
      exposure.capturePose = fixedRooms?.snapshot;
      exposure.deterministic = options.deterministic === true;
      exposure.coldBoot = options.coldBoot === true;
      if (exposure.coldBoot) exposure.observeColdBootStartup(ctx.startup);
      if (exposure.deterministic) exposure.holdStartup(ctx.startup);
      exposure.onProgress = () => ctx.state.set(exposure.getProgress());
      ctx.renderer.setOutputNode(applyExposure(colour, exposure.exposureNode), worldPass);
      ctx.entities.add("exposure", {
        debug: () => ({
          ...exposure.getObservation(),
          ...exposure.timing,
          bright,
          stops: options.stops,
        }),
      });
      this.#dispose = () => {
        ctx.renderer.clearOutputNode?.();
        exposure.dispose();
        worldPass.dispose();
        disposeRoom();
      };
      return (frame: ICtx) => {
        if (frame.input.justPressed("cut")) {
          const before = fixedRooms?.snapshot();
          exposure.beginCut();
          bright = !bright;
          if (fixedRooms === undefined) applyLight();
          else fixedRooms.setPose(bright);
          const cameraCut =
            before === undefined ? undefined : { before, after: fixedRooms?.snapshot() };
          console.info(
            `TN_EXPOSURE_CUT:${JSON.stringify({ cameraCut, bright, stops: options.stops, ...exposure.timing, ...exposure.getObservation() })}`,
          );
        }
        if (frame.input.justPressed("disable")) exposure.setEnabled(false);
        if (frame.input.justPressed("reset")) exposure.reset();
      };
    }

    override exit(): void {
      this.#dispose();
      this.#dispose = () => {};
    }
  }
  return defineGame({
    camera: { far: 100, fov: 48, near: 0.1, projection: "perspective" },
    display: { maxFps: 60 },
    initialState: { sampleFrames: 0, cutSampleFrames: 0 },
    input: { cut: { keys: ["KeyC"] }, disable: { keys: ["KeyD"] }, reset: { keys: ["KeyR"] } },
    plugins: [playtest({ holdUntilAttached: true })],
    renderer: { preferWebGPU: true },
    scenes: { room: ExposureRoom },
    seed: 339,
    start: "room",
  });
}
