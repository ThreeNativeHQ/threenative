/**
 * PRD-462 phase 1: what the 4,096-member reconcile actually spends its time on, per lane.
 *
 * The GPU A/B in `4ba74c9c5` says a settled L4@4,096 frame is 10.0 ms of which the projection
 * reconcile is 7.53, and that the same 4,096 moving cubes on the shared-material lane (L3) spend
 * 0.8 ms there. This harness reproduces both lanes without a browser, a renderer or a GPU, so the
 * difference is attributable to JavaScript: same scene, same mutation rate, one difference.
 *
 *     node --import tsx packages/core/__tests__/prd-462-reconcile-profile.ts [shared|uniform] [frames] [out.cpuprofile]
 *
 * The profiler is started around the measured loop and not the process, so building 4,096 materials
 * cannot be mistaken for the cost of reconciling them. The per-frame milliseconds it prints and the
 * profile it writes come from the same loop.
 */
import { writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { BoxGeometry, Mesh, MeshStandardMaterial, Scene } from "three";
import { SceneRenderProjection } from "../src/renderProjection.js";

const COUNT = 4096;
const WARMUP = 20;
const GEOMETRY = new BoxGeometry(1, 1, 1);

/** One lattice per lane: `shared` is L3, `uniform` is L4. Every transform moves on every frame. */
function lattice(lane: "shared" | "uniform", count: number): Scene {
  const scene = new Scene();
  const material = new MeshStandardMaterial({ color: 0x3366aa, metalness: 0, roughness: 0.75 });
  for (let index = 0; index < count; index += 1) {
    let own = material;
    if (lane === "uniform") {
      // L4's per-cube albedo, `0xRRGGBB` with the index in the lower channels, so no two cubes
      // can share a material and the colour is the only thing that differs between them.
      own = material.clone();
      own.color.setHex(0xff0000 | (index & 0x00ffff));
    }
    const mesh = new Mesh(GEOMETRY, own);
    mesh.position.set((index % 8) * 2.5, Math.floor(index / 8) * 2.5, 0);
    mesh.rotation.y = index * 0.001;
    scene.add(mesh);
  }
  return scene;
}

/** The benchmark's `mutationRate 1` update: every cube's position and rotation moves every frame. */
function mutate(scene: Scene, frame: number): void {
  for (const child of scene.children) {
    const mesh = child as Mesh;
    mesh.position.y += 0.01 * (((frame + 1) % 7) - 3);
    mesh.rotation.x = frame * 0.001;
    mesh.rotation.y += 0.002;
  }
}

const lane = process.argv[2] === "shared" ? "shared" : "uniform";
const frames = Number(process.argv[3] ?? 200);
const out = process.argv[4];
const scene = lattice(lane, COUNT);
const projection = new SceneRenderProjection(scene, {
  minMeshes: 8,
  onReport: () => undefined,
});
// One settle pass before the profiler opens, so the plan is retained and the frames it samples are
// the steady ones the GPU arm measures.
for (let frame = 0; frame < WARMUP; frame += 1) {
  mutate(scene, frame);
  projection.reconcile();
}

const session = new Session();
session.connect();
await session.post("Profiler.enable");
await session.post("Profiler.setSamplingInterval", { interval: 100 });
await session.post("Profiler.start");
const samples: number[] = [];
for (let frame = 0; frame < frames; frame += 1) {
  mutate(scene, WARMUP + frame);
  const startedAt = performance.now();
  projection.reconcile();
  samples.push(performance.now() - startedAt);
}
const { profile } = await session.post("Profiler.stop");
if (out !== undefined) writeFileSync(out, JSON.stringify(profile));
session.disconnect();

samples.sort((left, right) => left - right);
const mean = samples.reduce((total, value) => total + value, 0) / samples.length;
const median = samples[samples.length >> 1] as number;
process.stdout.write(
  `${JSON.stringify({
    lane,
    count: COUNT,
    frames,
    meanMs: Number(mean.toFixed(3)),
    medianMs: Number(median.toFixed(3)),
    batches: projection.report.batches,
    deoptimized: projection.deoptimized,
  })}\n`,
);
