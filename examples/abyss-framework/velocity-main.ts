import { abs, float, mix, pass, step, uv, vec2, vec4 } from "three/tsl";
import {
  BatchedMesh,
  Color,
  DataUtils,
  DirectionalLight,
  HemisphereLight,
  Matrix4,
  MeshStandardMaterial,
  OrthographicCamera,
  RenderPipeline,
  Scene,
  SphereGeometry,
  WebGPURenderer,
} from "three/webgpu";
import { ensureVelocityOutput } from "../../packages/core/src/render/velocity.js";
import { SceneRenderProjection } from "../../packages/core/src/renderProjection.js";
import { installThreePlaytestBridge } from "../../packages/playtest/dist/three/index.js";
import { summarizeVelocityPixels } from "./src/render/velocityReadback.js";

const width = 960;
const height = 540;
const renderer = new WebGPURenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(width, height);
document.body.appendChild(renderer.domElement);
await renderer.init();
const scene = new Scene();
scene.background = new Color(0x172034);
const camera = new OrthographicCamera(-3, 3, 3.375, -3.375, 0.1, 20);
camera.position.z = 8;
scene.add(new HemisphereLight(0xb8d7ff, 0x263349, 2));
const key = new DirectionalLight(0xffffff, 3);
key.position.set(-2, 4, 5);
scene.add(key);
const geometry = new SphereGeometry(0.8, 32, 24);
const batch = new BatchedMesh(
  2,
  geometry.getAttribute("position").count,
  geometry.getIndex()?.count,
  new MeshStandardMaterial({ color: 0x69c5ff, roughness: 0.38 }),
);
const shape = batch.addGeometry(geometry);
const still = batch.addInstance(shape);
const moving = batch.addInstance(shape);
batch.setMatrixAt(still, new Matrix4().makeTranslation(-1.5, 0, 0));
batch.setMatrixAt(moving, new Matrix4().makeTranslation(1.5, 0, 0));
scene.add(batch);
// Mutation reproduces the old opt-out branch: the scene draws, but no previous sub-draw texture exists.
const withoutHistory = new URLSearchParams(location.search).has("without-history");
const projection = new SceneRenderProjection(scene, {
  projection: false,
  velocity: !withoutHistory,
});
const scenePass = pass(scene, camera);
ensureVelocityOutput(scenePass);
const imageUv = vec2(uv().x.mul(2).fract(), uv().y);
const beauty = scenePass.getTextureNode("output").sample(imageUv);
const velocity = scenePass.getTextureNode("velocity").sample(imageUv);
// Left: actual colour. Right: absolute x/y velocity, amplified 20x over a dark blue zero point.
const motion = vec4(
  abs(velocity.x).mul(20).add(0.035),
  abs(velocity.y).mul(20).add(0.045),
  float(0.09),
  1,
);
const pipeline = new RenderPipeline(renderer);
pipeline.outputNode = mix(beauty, motion, step(0.5, uv().x));
let frame = 0;
let firstFrameMax = -1;
let metrics = { staticMax: 0, movingMax: 0, movingPixels: 0 };

async function renderFrame() {
  // Three's NodeFrame is driven by RAF; synchronous render loops cannot prove frame history.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (frame > 0)
    batch.setMatrixAt(moving, new Matrix4().makeTranslation(frame % 2 === 0 ? 1.65 : 1.35, 0, 0));
  projection.reconcile();
  if (projection.root !== scene || projection.report.reasonCode !== "disabled")
    throw new Error("Velocity fixture must render the authored, opted-out scene.");
  pipeline.render();
  const target = scenePass.renderTarget;
  const velocityIndex = target.textures.indexOf(scenePass.getTexture("velocity"));
  if (velocityIndex < 0) throw new Error("Velocity MRT attachment is missing.");
  const raw = await renderer.readRenderTargetPixelsAsync(
    target,
    0,
    0,
    target.width,
    target.height,
    velocityIndex,
  );
  const data = raw instanceof Uint16Array ? Float32Array.from(raw, DataUtils.fromHalfFloat) : raw;
  if (!(data instanceof Float32Array))
    throw new Error("Velocity MRT readback has an unsupported format.");
  metrics = summarizeVelocityPixels(data, target.width, target.height);
  if (frame === 0) firstFrameMax = Math.max(metrics.staticMax, metrics.movingMax);
  projection.commit();
  frame += 1;
}
await renderFrame();
installThreePlaytestBridge({
  camera,
  scene,
  renderer,
  diagnostics: () => [],
  fixedStep: async (ticks) => {
    for (let index = 0; index < ticks; index += 1) await renderFrame();
    return ticks;
  },
  resources: { read: () => ({ motion: { ...metrics, firstFrameMax, frame, withoutHistory } }) },
  tick: () => frame,
});
