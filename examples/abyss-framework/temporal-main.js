import { installThreePlaytestBridge } from "@threenative/playtest/three";
import { NoToneMapping, PerspectiveCamera, Scene, WebGPURenderer } from "three/webgpu";
import { createTemporalAAFixture } from "../../packages/runtime-native/conformance/scenes/shared/temporal-aa-fixture.js";

const query = new URLSearchParams(location.search);
const measurement = query.has("measure");
const rasterScale = query.get("variant") === "supersampled" ? 4 : 1;
const width = measurement ? 640 * rasterScale : 1280;
const height = measurement ? 360 * rasterScale : 720;
const renderer = new WebGPURenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(width, height);
renderer.toneMapping = NoToneMapping;
document.body.appendChild(renderer.domElement);
await renderer.init();
const scene = new Scene();
const camera = new PerspectiveCamera(50, 1280 / 720, 0.1, 100);
const fixture = createTemporalAAFixture(
  renderer,
  scene,
  camera,
  query.get("variant") === "supersampled" ? "reference" : (query.get("variant") ?? "temporal"),
  measurement,
);
// Three advances NodeUpdateType.FRAME from its existing animation clock. Multiple synchronous
// renders would reuse one temporal result, so each deterministic step waits for that boundary.
async function advance(ticks) {
  for (let index = 0; index < ticks; index++) {
    await new Promise(requestAnimationFrame);
    fixture.render();
    await fixture.sampleVelocity();
  }
  return ticks;
}
let startupError;
try {
  await advance(20);
} catch (error) {
  startupError = error instanceof Error ? error.stack : String(error);
  console.error(startupError);
}
installThreePlaytestBridge({
  camera,
  scene,
  renderer,
  diagnostics: () =>
    startupError === undefined ? [] : [{ code: "TN_TEMPORAL_STARTUP_FAILED", error: startupError }],
  fixedStep: async (ticks) => {
    if (startupError !== undefined) throw new Error(startupError);
    return advance(ticks);
  },
  resources: { read: () => ({ temporal: fixture.observation() }) },
  tick: () => fixture.observation().frame,
});
