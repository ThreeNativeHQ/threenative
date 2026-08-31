import * as THREE from "three/webgpu";
import { color, normalWorld, positionWorld } from "three/tsl";
import { ProbeVolume } from "../../../../core/src/render/probe-volume.ts";
import { assertCondition, startVisualScene } from "./scene-support.js";

const VOLUME_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-1, -1, -0.8),
  new THREE.Vector3(1, 1, 0.8),
);
const BAKE_FRAME_LIMIT = 180;

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function waitForSubmittedWork(renderer) {
  const wait = renderer.backend?.device?.queue?.onSubmittedWorkDone;
  if (typeof wait === "function") await wait.call(renderer.backend.device.queue);
}

export async function startScene(canvas, dimensions) {
  return startVisualScene(
    canvas,
    dimensions,
    "probe-volume-sample",
    async ({ camera, renderer, scene }) => {
      const volume = new ProbeVolume({
        bounds: VOLUME_BOUNDS,
        bakeBudgetMs: 16,
        cubemapSize: 8,
        density: 0.5,
        maxWorkItemsPerFrame: 1,
      });
      scene.add(volume);
      const host = { kind: "webgpu", raw: renderer };
      volume.attachRenderer(host);

      const wallMaterial = new THREE.MeshBasicNodeMaterial();
      wallMaterial.colorNode = volume.sampleNode(positionWorld, normalWorld).mul(8);
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.45), wallMaterial);
      wall.name = "neutral-wall-inside-frustum";
      wall.position.set(0.5, 0, -0.35);

      // This saturated panel is deliberately outside the camera frustum. CubeCamera sees it
      // during the bake, which is the signal the wall receives through the probe sample node.
      const emitterMaterial = new THREE.MeshBasicNodeMaterial();
      emitterMaterial.colorNode = color(0xff0030).mul(12);
      const offscreenEmitter = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 1.45, 0.8),
        emitterMaterial,
      );
      offscreenEmitter.name = "off-screen-emitter";
      offscreenEmitter.position.set(4.2, 0, 1.8);
      scene.add(wall, offscreenEmitter);
      assertCondition(offscreenEmitter.position.x > 2, "emitter must be outside the camera frustum");
      assertCondition(wall.name.includes("inside-frustum"), "wall must be the visible subject");
      assertCondition(volume.sampleNode(positionWorld, normalWorld)?.isNode === true, "probe volume sample node must be installed");

      const bake = volume.requestBake(scene);
      let bakeFrames = 0;
      while (volume.observation.status === "baking") {
        volume.process(host);
        renderer.render(scene, camera);
        await waitForSubmittedWork(renderer);
        bakeFrames += 1;
        if (bakeFrames > BAKE_FRAME_LIMIT) {
          throw new Error(`probe volume bake exceeded ${BAKE_FRAME_LIMIT} frames`);
        }
        await nextFrame();
      }
      await bake;
      assertCondition(volume.observation.status === "ready", "probe volume bake must complete");
      assertCondition(volume.observation.stale === false, "completed probe volume must not be stale");

      return {
        detail: {
          atlasBytes: volume.atlasBytes,
          bakeFrames,
          bakeCostMs: volume.observation.bakeCostMs,
          emitter: "off-screen",
          marker: volume.observation.marker,
          probeCount: volume.probeCount,
          sample: "sampleNode(positionWorld, normalWorld)",
          status: volume.observation.status,
        },
        render: () => renderer.render(scene, camera),
        volume,
        wall,
      };
    },
    {
      background: 0x090b14,
      camera: (size) => {
        const view = new THREE.PerspectiveCamera(50, size.width / size.height, 0.1, 100);
        view.position.set(0, 0.05, 3.8);
        view.lookAt(0, 0, -0.35);
        return view;
      },
    },
  );
}
