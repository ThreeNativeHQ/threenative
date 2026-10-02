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
for (let index = 0; index < 20; index++) fixture.render();
installThreePlaytestBridge({
  camera, scene, renderer,
  fixedStep: async (ticks) => { for (let index = 0; index < ticks; index++) fixture.render(); return ticks; },
  resources: { read: () => ({ temporal: fixture.observation() }) },
  tick: () => fixture.observation().frame,
});
