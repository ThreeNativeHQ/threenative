import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
} from "../../../../packages/core/node_modules/three/build/three.webgpu.js";
import { isNative } from "../../../../packages/core/src/platform.ts";
import { createRenderer } from "../../../../packages/core/src/renderer.ts";
import {
  observeQualityWindow,
  setupPost,
} from "../../../../packages/create-threenative/templates/starter/src/render/postprocessing.ts";

const MARKER = "TN_QUALITY_RESOURCE_LIFECYCLE:";
const RESULT_KEY = "__TN_QUALITY_RESOURCE_LIFECYCLE__";
const FRAME_COUNT = 10;

function canvasForHost() {
  if (globalThis.canvas !== undefined) return globalThis.canvas;
  if (isNative()) throw new Error("native resource probe requires globalThis.canvas");
  if (typeof document === "undefined")
    throw new Error("browser resource probe requires document canvas support");
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  canvas.style.width = "640px";
  canvas.style.height = "360px";
  document.body?.append(canvas);
  return canvas;
}

function readSize(canvas) {
  const width = Number(canvas.clientWidth || canvas.width || 640);
  const height = Number(canvas.clientHeight || canvas.height || 360);
  return [Math.max(1, width), Math.max(1, height)];
}

function nextFrame() {
  if (typeof globalThis.requestAnimationFrame !== "function")
    throw new Error("resource probe requires real requestAnimationFrame");
  return new Promise((resolve) => globalThis.requestAnimationFrame(() => resolve()));
}

async function settle(renderer, scene, camera) {
  for (let index = 0; index < FRAME_COUNT; index += 1) {
    await nextFrame();
    renderer.render(scene, camera);
  }
}

function textureCount(renderer) {
  const count = renderer.raw?.info?.memory?.textures;
  if (!Number.isInteger(count) || count <= 0)
    throw new Error(
      `Three memory.textures must be a positive integer after a settled draw, received ${String(count)}`,
    );
  return count;
}

function drawCallCount(renderer) {
  const count = renderer.raw?.info?.render?.drawCalls;
  if (!Number.isInteger(count) || count <= 0)
    throw new Error(
      `Three render.drawCalls must be a positive integer after a settled draw, received ${String(count)}`,
    );
  return count;
}

function debugSample(controller, expectedTier, cycle, step) {
  const debug = controller.debug();
  if (debug.tier !== expectedTier)
    throw new Error(`quality tier ${String(debug.tier)} did not reach ${expectedTier}`);
  const stages = Array.isArray(debug.stages) ? [...debug.stages] : [];
  const dropped = Array.isArray(debug.dropped) ? [...debug.dropped] : [];
  if (!stages.includes("bloom"))
    throw new Error(
      `quality bloom stage is missing at ${expectedTier}; dropped=${JSON.stringify(dropped)}`,
    );
  return {
    cycle,
    step,
    textures: textureCount(renderer),
    drawCalls: drawCallCount(renderer),
    debug: { tier: debug.tier, stages, dropped },
  };
}

function syntheticWindow(window, gpuMs) {
  return {
    window,
    frames: 60,
    fps: 60,
    presented: { p95: 16.7 },
    frame: { p95: 5.5 },
    gpuMs,
    gpuAgeFrames: 1,
  };
}

const canvas = canvasForHost();
const source = {
  createCanvas: () => canvas,
  hasWebGPU: () => true,
  observeResize: () => () => {},
  readSize: () => readSize(canvas),
};
let renderer;
let controller;
let nextWindow = 0;
let cycles = [];
const samples = [];
let result = { pass: false, cycles };

try {
  renderer = await createRenderer({
    canvas,
    source,
    preferWebGPU: true,
    resolutionScale: 1,
    scaleSource: "pinned",
  });
  const scene = new Scene();
  scene.background = new Color(0x263238);
  scene.add(new AmbientLight(0x9fb6c4, 1.2));
  const sun = new DirectionalLight(0xffffff, 2.4);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const floor = new Mesh(
    new PlaneGeometry(8, 8),
    new MeshStandardNodeMaterial({ color: 0x49624f, roughness: 0.9, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.75;
  scene.add(floor);
  const cube = new Mesh(
    new BoxGeometry(1.4, 1.4, 1.4),
    new MeshStandardNodeMaterial({ color: 0xc27c4a, roughness: 0.55, metalness: 0.05 }),
  );
  cube.position.y = 0;
  scene.add(cube);
  const camera = new PerspectiveCamera(55, readSize(canvas)[0] / readSize(canvas)[1], 0.1, 50);
  camera.position.set(3.2, 2.8, 4.6);
  camera.lookAt(0, 0, 0);
  const post = setupPost(renderer, scene, camera, {
    mobile: false,
    startupWindows: 0,
    cooldownMs: 0,
    overloadedWindows: 1,
    healthyWindows: 1,
    maxGpuAgeFrames: 4,
  });
  controller = post;
  for (let cycle = 1; cycle <= 2; cycle += 1) {
    await settle(renderer, scene, camera);
    samples.push(debugSample(controller, "high", cycle, "high-start"));
    for (const [tier, gpuMs] of [
      ["medium", 40],
      ["low", 40],
      ["medium", 1],
      ["high", 1],
    ]) {
      nextWindow += 1;
      observeQualityWindow(syntheticWindow(nextWindow, gpuMs));
      await settle(renderer, scene, camera);
      samples.push(debugSample(controller, tier, cycle, tier));
    }
  }
  const firstCycle = samples.filter((sample) => sample.cycle === 1);
  const secondCycle = samples.filter((sample) => sample.cycle === 2);
  if (firstCycle.length !== secondCycle.length)
    throw new Error("quality cycles have different lengths");
  for (let index = 0; index < firstCycle.length; index += 1) {
    if (secondCycle[index].textures > firstCycle[index].textures)
      throw new Error(
        `texture count grew on repeat at ${secondCycle[index].step}: ${firstCycle[index].textures} -> ${secondCycle[index].textures}`,
      );
  }
  cycles = [firstCycle, secondCycle];
  result = { pass: true, framesPerDecision: FRAME_COUNT, cycles: [firstCycle, secondCycle] };
} catch (error) {
  if (samples.length > 0) cycles = [samples];
  result = { pass: false, cycles, error: String(error) };
} finally {
  try {
    controller?.dispose();
  } catch (error) {
    result = { ...result, pass: false, cleanupError: `controller: ${String(error)}` };
  }
  try {
    renderer?.dispose();
  } catch (error) {
    result = { ...result, pass: false, cleanupError: `renderer: ${String(error)}` };
  }
  globalThis[RESULT_KEY] = result;
  console.log(`${MARKER}${JSON.stringify(result)}`);
}
