import { abs, float, mix, pass, step, uv, vec2, vec4 } from "three/tsl";
import {
  BatchedMesh,
  Color,
  DataUtils,
  DirectionalLight,
  DynamicDrawUsage,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  OrthographicCamera,
  RenderPipeline,
  Scene,
  SphereGeometry,
  Vector3,
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
const query = new URLSearchParams(location.search);
const instanced = query.has("instanced");
const dynamic = query.has("dynamic");
const material = new MeshStandardMaterial({ color: 0x69c5ff, roughness: 0.38 });
const mesh = instanced
  ? new InstancedMesh(geometry, material, 2)
  : new BatchedMesh(
      2,
      geometry.getAttribute("position").count,
      geometry.getIndex()?.count,
      material,
    );
if (mesh instanceof BatchedMesh) {
  const shape = mesh.addGeometry(geometry);
  mesh.addInstance(shape);
  mesh.addInstance(shape);
} else if (dynamic) mesh.instanceMatrix.setUsage(DynamicDrawUsage);
mesh.setMatrixAt(0, new Matrix4().makeTranslation(-1.5, 0, 0));
mesh.setMatrixAt(1, new Matrix4().makeTranslation(1.5, 0, 0));
scene.add(mesh);
// Removes the scheduler, exercising the actual accessor fallback; readbacks are never overridden.
const withoutHistory = query.has("without-history");
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
let oracleMaxErrorPixels = 0;
let stoppedMax = -1;
let currentX = 1.5;
const samples: {
  frame: number;
  expectedX: number;
  actualX: number;
  actualY: number;
  errorPixels: number;
}[] = [];
// Includes reversals, unequal steps, a stop and a restart. One-frame-old data cannot agree by coincidence.
const positions = [1.5, 1.35, 1.65, 1.25, 1.6, 1.45, 1.45, 1.7, 1.3];

async function renderFrame() {
  // Three's NodeFrame is driven by RAF; synchronous render loops cannot prove frame history.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const previousX = currentX;
  currentX = positions[frame % positions.length] ?? 1.5;
  mesh.setMatrixAt(1, new Matrix4().makeTranslation(currentX, 0, 0));
  if (mesh instanceof InstancedMesh) mesh.instanceMatrix.needsUpdate = true;
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
  if (frame === 6) stoppedMax = metrics.movingMax;
  const currentPoint = new Vector3(currentX, 0, 0).project(camera);
  const previousPoint = new Vector3(previousX, 0, 0).project(camera);
  const expectedX = currentPoint.x - previousPoint.x;
  const px = Math.floor((currentPoint.x * 0.5 + 0.5) * target.width);
  const py = Math.floor(target.height / 2);
  // Interior of the actually rendered moving sphere. Translation in this orthographic camera
  // has the same velocity at every vertex, so the centre has an independent analytic oracle.
  const offset = (py * target.width + px) * 4;
  const actualX = data[offset];
  const actualY = data[offset + 1];
  if (actualX === undefined || actualY === undefined) throw new Error("Oracle sample is missing.");
  const errorPixels = Math.hypot(
    ((actualX - expectedX) * target.width) / 2,
    (actualY * target.height) / 2,
  );
  oracleMaxErrorPixels = Math.max(oracleMaxErrorPixels, errorPixels);
  samples.push({ frame: frame + 1, expectedX, actualX, actualY, errorPixels });
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
  resources: {
    read: () => ({
      motion: {
        ...metrics,
        firstFrameMax,
        frame,
        withoutHistory,
        instanced,
        dynamic,
        oracleMaxErrorPixels,
        stoppedMax,
        samples,
      },
    }),
  },
  tick: () => frame,
});
