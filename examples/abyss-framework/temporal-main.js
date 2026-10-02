import { installThreePlaytestBridge } from "@threenative/playtest/three";
import { NoToneMapping, PerspectiveCamera, Scene, WebGPURenderer } from "three/webgpu";
import { createTemporalAAFixture } from "../../packages/runtime-native/conformance/scenes/shared/temporal-aa-fixture.js";

const renderer = new WebGPURenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(1280, 720);
renderer.toneMapping = NoToneMapping;
document.body.appendChild(renderer.domElement);
await renderer.init();
const scene = new Scene();
const camera = new PerspectiveCamera(50, 1280 / 720, 0.1, 100);
const fixture = createTemporalAAFixture(renderer, scene, camera, new URLSearchParams(location.search).get("variant") ?? "temporal");
// Three advances NodeUpdateType.FRAME from its existing animation clock. Multiple synchronous
// renders would reuse one temporal result, so each deterministic step waits for that boundary.
async function advance(ticks) {
  for (let index = 0; index < ticks; index++) {
    await new Promise(requestAnimationFrame);
    fixture.render();
  }
  return ticks;
}
await advance(20);
installThreePlaytestBridge({
  camera, scene, renderer,
  fixedStep: advance,
  resources: { read: () => ({ temporal: fixture.observation() }) },
  tick: () => fixture.observation().frame,
});
