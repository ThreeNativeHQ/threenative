// Skinned-crowd A/B for PRD-threejs-instanced-skinning. Each arm renders N identical procedural
// rigs with independent poses and shadows; only the submission path differs. Reports land on
// `window.__ENGINE_LOAD_TEST__` for `scripts/engine-load-test/browser.ts` to collect.
import {
  Bone,
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  HemisphereLight,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  WebGPURenderer,
} from "three/webgpu";
import { SceneRenderProjection } from "../../../packages/core/src/renderProjection.js";
import { percentile } from "./workload.js";

export type CrowdArm = "stock" | "stock2" | "projected";
const BONES = 32;
const HEIGHT = 2;
const params = new URLSearchParams(location.search);
const LADDER = (params.get("ladder") ?? "8,128,512").split(",").map(Number);
const ORDER = (params.get("order") ?? "stock,projected,stock2,projected,stock,projected")
  .split(",")
  .map((arm) => arm as CrowdArm);
const FRAMES = Number(params.get("frames") ?? 300);
const WARMUP = Number(params.get("warmup") ?? 60);
/** Static shadow-casting boxes added beside the rigs, to price a rigid draw on the same frame. */
const PROPS = Number(params.get("props") ?? 0);

function rigGeometry(): CylinderGeometry {
  const geometry = new CylinderGeometry(0.25, 0.3, HEIGHT, 32, 128);
  const position = geometry.getAttribute("position");
  const indices: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < position.count; i++) {
    const t = ((position.getY(i) + HEIGHT / 2) / HEIGHT) * (BONES - 1);
    const bone = Math.min(Math.floor(t), BONES - 2);
    const blend = t - bone;
    indices.push(bone, bone + 1, 0, 0);
    weights.push(1 - blend, blend, 0, 0);
  }
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));
  return geometry;
}

function rig(geometry: CylinderGeometry, material: MeshStandardNodeMaterial): SkinnedMesh {
  const bones: Bone[] = [];
  for (let i = 0; i < BONES; i++) {
    const bone = new Bone();
    bone.position.y = i === 0 ? -HEIGHT / 2 : HEIGHT / (BONES - 1);
    bones[i - 1]?.add(bone);
    bones.push(bone);
  }
  const mesh = new SkinnedMesh(geometry, material);
  mesh.add(bones[0] as Bone);
  mesh.bind(new Skeleton(bones));
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

interface ICrowdRun {
  arm: CrowdArm;
  count: number;
  cpuMs: number[];
  frameMs: number[];
  drawCalls: number;
  projection?: unknown;
}

async function run(renderer: WebGPURenderer, arm: CrowdArm, count: number): Promise<ICrowdRun> {
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 400);
  const side = Math.ceil(Math.sqrt(Math.max(count, PROPS, 1)));
  camera.position.set(0, side * 0.9 + 3, side * 1.4 + 4);
  camera.lookAt(0, 0, 0);
  scene.add(new HemisphereLight(0xffffff, 0x404040, 1));
  const sun = new DirectionalLight(0xffffff, 2);
  sun.position.set(5, 12, 4);
  sun.castShadow = true;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -side;
  sun.shadow.camera.right = sun.shadow.camera.top = side;
  scene.add(sun);
  const ground = new Mesh(
    new PlaneGeometry(side * 2 + 4, side * 2 + 4),
    new MeshStandardNodeMaterial(),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -HEIGHT / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const geometry = rigGeometry();
  const material = new MeshStandardNodeMaterial({ color: 0xc08860 });
  const box = new BoxGeometry(0.4, 0.4, 0.4);
  for (let i = 0; i < PROPS; i++) {
    const prop = new Mesh(box, material);
    prop.position.set(
      (i % side) - (side - 1) / 2 + 0.5,
      -0.7,
      Math.floor(i / side) - (side - 1) / 2,
    );
    prop.castShadow = true;
    scene.add(prop);
  }
  const rigs: SkinnedMesh[] = [];
  for (let i = 0; i < count; i++) {
    const mesh = rig(geometry, material);
    mesh.position.set((i % side) - (side - 1) / 2, 0, Math.floor(i / side) - (side - 1) / 2);
    scene.add(mesh);
    rigs.push(mesh);
  }
  // The shipping default: the game constructs nothing, the engine owns this.
  const floor = params.get("minMeshes");
  const projection =
    arm === "projected"
      ? new SceneRenderProjection(scene, floor === null ? {} : { minMeshes: Number(floor) })
      : undefined;
  const device = (
    renderer.backend as unknown as { device: { queue: { onSubmittedWorkDone(): Promise<void> } } }
  ).device;
  const cpuMs: number[] = [];
  const frameMs: number[] = [];
  let drawCalls = 0;
  for (let frame = 0; frame < WARMUP + FRAMES; frame++) {
    const t0 = performance.now();
    const time = frame / 60;
    for (let i = 0; i < count; i++) {
      const bones = (rigs[i] as SkinnedMesh).skeleton.bones;
      for (let b = 1; b < BONES; b++)
        (bones[b] as Bone).rotation.z = Math.sin(time * 2 + i * 0.7 + b * 0.3) * 0.12;
    }
    // What `defineGame` does every frame: reconcile after the game's update, render its root.
    projection?.reconcile();
    renderer.render(projection?.root ?? scene, camera);
    projection?.commit();
    drawCalls = renderer.info.render.drawCalls;
    const t1 = performance.now();
    await device.queue.onSubmittedWorkDone();
    const t2 = performance.now();
    if (frame >= WARMUP) {
      cpuMs.push(t1 - t0);
      frameMs.push(t2 - t0);
    }
  }
  const report = projection?.report;
  projection?.dispose();
  geometry.dispose();
  material.dispose();
  return { arm, count, cpuMs, frameMs, drawCalls, projection: report };
}

async function main(): Promise<void> {
  const canvas = document.getElementById("stage") as HTMLCanvasElement;
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  renderer.shadowMap.enabled = true;
  renderer.setSize(1280, 720, false);
  await renderer.init();
  // Same browser, same GPU process: the adapter the renderer was handed. SwiftShader shows here.
  const adapter = await (
    navigator as unknown as { gpu: { requestAdapter(): Promise<{ info: unknown } | null> } }
  ).gpu.requestAdapter();
  const runs: ICrowdRun[] = [];
  for (const count of LADDER) for (const arm of ORDER) runs.push(await run(renderer, arm, count));
  const summary = runs.map((r) => ({
    arm: r.arm,
    count: r.count,
    drawCalls: r.drawCalls,
    cpuP50: percentile(r.cpuMs, 0.5),
    frameP50: percentile(r.frameMs, 0.5),
    frameP95: percentile(r.frameMs, 0.95),
    projection: r.projection,
  }));
  (globalThis as Record<string, unknown>).__ENGINE_LOAD_TEST__ = {
    adapter:
      adapter === null
        ? null
        : JSON.parse(
            JSON.stringify(adapter.info, ["vendor", "architecture", "device", "description"]),
          ),
    frames: FRAMES,
    summary,
  };
}

main().catch((error: unknown) => {
  (globalThis as Record<string, unknown>).__ENGINE_LOAD_TEST_ERROR__ = String(
    error instanceof Error ? error.stack : error,
  );
});
