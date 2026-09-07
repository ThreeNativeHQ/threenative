import {
  BoxGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  Scene,
  WebGPURenderer,
} from "../../packages/core/node_modules/three/build/three.webgpu.js";
import { yieldToMain } from "../../packages/core/node_modules/three/src/utils.js";
const nativeRaf = globalThis.requestAnimationFrame.bind(globalThis);
let frames = 0;
let yields = 0;
let timer = false;
let finished = false;
globalThis.requestAnimationFrame = () => {
  frames += 1;
  return 1;
};
const renderer = new WebGPURenderer({ canvas: globalThis.canvas });
const scene = new Scene();
const camera = new PerspectiveCamera(60, 1280 / 720, 0.1, 100);
camera.position.z = 3;
scene.add(new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial({ color: 0x22aa99 })));
function release(pass, error) {
  if (finished) return;
  finished = true;
  console.log(
    `TN_HELD_COMPILE:${JSON.stringify({ pass, yields, timer, requestedFrames: frames, error: error ?? null })}`,
  );
  globalThis.requestAnimationFrame = nativeRaf;
  const draw = () => {
    renderer.render(scene, camera);
    nativeRaf(draw);
  };
  nativeRaf(draw);
}
setTimeout(() => release(false, "deadline"), 15000);
(async () => {
  await renderer.init();
  setTimeout(() => {
    timer = true;
  }, 0);
  for (let i = 0; i < 32; i += 1) {
    await yieldToMain();
    yields += 1;
  }
  await renderer.compileAsync(scene, camera);
  release(yields === 32 && timer);
})().catch((error) => release(false, String(error)));
