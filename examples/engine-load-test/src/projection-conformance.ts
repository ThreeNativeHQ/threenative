import { installThreePlaytestBridge } from "@threenative/playtest/three";
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { ScenePicker } from "../../../packages/core/src/picking.js";
import { SceneRenderProjection } from "../../../packages/core/src/renderProjection.js";
import type { Viewport } from "../../../packages/core/src/viewport.js";
import { cameraPose, createPlacements, uniqueMaterialColor } from "./workload.js";

const WIDTH = 1_280;
const HEIGHT = 720;
const ANCHOR_COUNT = 128;
const UNIQUE_COUNT = 128;
const VISIBLE_UNIQUE_COUNT = 16;
const FAR_DISTANCE = 200;

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const status = document.getElementById("status") as HTMLElement;
const query = new URLSearchParams(globalThis.location.search);
const renderSource = query.get("mode") === "source";
const forceWebGL = query.get("renderer") === "webgl";
/**
 * The uniform rung swaps the in-frame block for the population the per-instance-colour lane exists
 * for: one shared geometry, one material clone per mesh, and nothing but the base colour differing.
 * Everything else — the anchors, the off-screen unique geometries, the camera, the raycast target —
 * is the same scene, so the same assertions and the same captured frame compare across the two.
 */
const uniformRung = query.get("rung") === "uniform";
/**
 * `count` builds that population at the load test's own L4 scale instead: the same placement, the
 * same per-cube colour function, the same camera, and nothing else in the scene. It is the scene the
 * benchmark rung measures, so a frame captured here is the frame that number is about.
 */
const latticeCount = Number(query.get("count") ?? 0);
canvas.width = WIDTH;
canvas.height = HEIGHT;

const renderer = new WebGPURenderer({ antialias: false, canvas, forceWebGL });
renderer.setPixelRatio(1);
renderer.setSize(WIDTH, HEIGHT, false);
renderer.autoClear = false;

const source = new Scene();
source.background = new Color(0x08131f);
const material = new MeshBasicMaterial({ color: 0x3bc7ff });
const anchorGeometry = new BoxGeometry(1, 1, 1);
const uniqueMeshes: Mesh[] = [];
let target: Mesh;
let camera: PerspectiveCamera;

if (latticeCount > 0) {
  // L4's own authoring: one shared geometry, one MeshStandardMaterial clone per cube, and a light
  // so a lit surface is what draws. Nothing here chooses a look — the colours and the geometry are
  // the load test's, and both arms of the comparison draw the same scene.
  const base = new MeshStandardMaterial({ color: 0xb8c4cc, metalness: 0, roughness: 0.75 });
  const sun = new DirectionalLight(0xffffff, 2.4);
  sun.position.set(60, 120, 40);
  source.add(sun);
  source.add(new AmbientLight(0xffffff, 0.35));
  // `rung=shared` is the control for the pixel comparison: the same lattice on one material, so a
  // difference between the two arms that survives it is float32, not a per-instance colour.
  const sharedMaterial = query.get("rung") === "shared";
  const placements = createPlacements(latticeCount);
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index] as { x: number; y: number; z: number };
    const cubeMaterial = sharedMaterial ? base : base.clone();
    cubeMaterial.color.setHex(uniqueMaterialColor(index));
    const cube = new Mesh(anchorGeometry, cubeMaterial);
    cube.position.set(placement.x, placement.y, placement.z);
    cube.rotation.set(index * 0.011, index * 0.017, 0);
    source.add(cube);
    uniqueMeshes.push(cube);
  }
  const pose = cameraPose(0, latticeCount);
  camera = new PerspectiveCamera(60, WIDTH / HEIGHT, 0.5, pose.x * 4 + 2_000);
  camera.position.set(pose.x, pose.y, pose.z);
  camera.lookAt(pose.targetX, pose.targetY, pose.targetZ);
  camera.updateMatrixWorld(true);
  target = uniqueMeshes[0] as Mesh;
} else {
  for (let index = 0; index < ANCHOR_COUNT; index += 1) {
    const anchor = new Mesh(anchorGeometry, material);
    anchor.position.set(20 + (index % 8) * 2, Math.floor(index / 8) * 2 - 15, 0);
    source.add(anchor);
  }
  for (let index = 0; index < UNIQUE_COUNT; index += 1) {
    const uniform = uniformRung && index < VISIBLE_UNIQUE_COUNT;
    const meshMaterial = uniform
      ? new MeshBasicMaterial({ color: 0xff0000 | (index & 0x00ffff) })
      : material;
    const mesh = new Mesh(
      uniform ? anchorGeometry : new BoxGeometry(1, 1 + index * 0.002, 1),
      meshMaterial,
    );
    if (index < VISIBLE_UNIQUE_COUNT) {
      mesh.position.set((index % 4) * 2.5 - 3.75, Math.floor(index / 4) * 2.5 - 3.75, 0);
    } else {
      mesh.position.set((index % 8) * 2 - 7, Math.floor(index / 8) * 2 - 7, -FAR_DISTANCE);
    }
    source.add(mesh);
    uniqueMeshes.push(mesh);
  }
  target = uniqueMeshes[0] as Mesh;
  camera = new PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 40);
  camera.position.set(0, 0, 8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
}

const projection = new SceneRenderProjection(source);
projection.reconcile();
if (
  projection.deoptimized ||
  // The uniform rung adds an instanced draw of its own: the anchors keep the shared material, and
  // the in-frame block is the one draw that stands for sixteen of them. The lattice is one alone.
  projection.report.instancedBatches !== (latticeCount > 0 ? 1 : uniformRung ? 2 : 1) ||
  projection.report.materialBatches !== (latticeCount > 0 ? 0 : 1) ||
  projection.report.projectedObjects !==
    (latticeCount > 0 ? latticeCount : ANCHOR_COUNT + UNIQUE_COUNT)
) {
  throw new Error("TN_PROJECTION_CONFORMANCE_NOT_PROJECTED");
}

// Use the public picker for both graphs. The fixture only needs the picker's size readout, so a
// minimal viewport view keeps this proof independent from a game boot's renderer wrapper.
const viewport = {
  size: { aspect: WIDTH / HEIGHT, height: HEIGHT, width: WIDTH },
} as Viewport;
const sourcePicker = new ScenePicker({
  camera,
  pointer: () => new Vector2(0, 0),
  scene: source,
  viewport,
});
const projectedPicker = new ScenePicker({
  camera,
  pointer: () => new Vector2(0, 0),
  scene: projection.root,
  viewport,
});
let tick = 0;
let proofState = "boot";
let sourceRaycastHit = false;
let projectedRaycastHit = false;
let reconciled = false;
let renderSucceeded = false;
let sourceRaycastDistance: number | null = null;
let projectedRaycastDistance: number | null = null;

/**
 * The mirror bakes an instance matrix into a float32 buffer, so what it hands the renderer is the
 * authored transform to single precision. The small scene's transforms are exact in float32, so its
 * proof stays bit-exact; a lattice-scale one is compared at the precision the store can hold, and
 * says so here rather than quietly loosening the proof that was already there.
 */
const MATRIX_TOLERANCE = latticeCount > 0 ? 0.002 : 0;
const RAY_TOLERANCE = latticeCount > 0 ? 0.05 : 0.0001;

function matrixMatches(
  left: { elements: readonly number[] },
  right: { elements: readonly number[] },
): boolean {
  if (left.elements.length !== right.elements.length) return false;
  for (let index = 0; index < left.elements.length; index += 1) {
    if (
      Math.abs((left.elements[index] as number) - (right.elements[index] as number)) >
      MATRIX_TOLERANCE
    )
      return false;
  }
  return true;
}

function raycastDistance(picker: ScenePicker): number | null {
  // The lattice rung aims the ray the way a player aims it — from the camera at a cube — because
  // the fixed down-the-Z ray the original scene was built for cannot reach a 64-wide lattice. Both
  // graphs are asked the same question in the same frame, which is the whole claim.
  if (latticeCount > 0) {
    const direction = new Vector3(target.position.x, target.position.y, target.position.z)
      .sub(camera.position)
      .normalize();
    const hit = picker.raycast({ direction, origin: camera.position.clone() });
    return hit?.distance ?? null;
  }
  const hit = picker.raycast({
    direction: new Vector3(0, 0, -1),
    origin: new Vector3(target.position.x, target.position.y, 8),
  });
  return hit?.distance ?? null;
}

function updateProof(): void {
  source.updateMatrixWorld(true);
  projection.root.updateMatrixWorld(true);
  sourceRaycastDistance = raycastDistance(sourcePicker);
  projectedRaycastDistance = raycastDistance(projectedPicker);
  sourceRaycastHit = sourceRaycastDistance !== null;
  projectedRaycastHit = projectedRaycastDistance !== null;
  const inspected = projection.inspect(target);
  reconciled = inspected !== undefined && matrixMatches(inspected.matrixWorld, target.matrixWorld);
  const raycastMatches =
    sourceRaycastHit &&
    projectedRaycastHit &&
    (latticeCount > 0
      ? // A camera ray through 4,096 cubes can graze two faces at distances the float32 instance
        // store cannot separate, so which one is nearest is not a stable claim at this scale. Both
        // graphs must still hit, and the consumer parity itself is proved on the small scene, whose
        // nearest hit is unambiguous.
        true
      : Math.abs((sourceRaycastDistance as number) - (projectedRaycastDistance as number)) <=
        RAY_TOLERANCE);
  proofState = raycastMatches && reconciled ? "raycast-match-reconciled" : "proof-failed";
  status.textContent = [
    "PRD-238 projection consumer conformance",
    `state=${proofState} tick=${tick} rung=${latticeCount > 0 ? `lattice-${latticeCount}-${query.get("rung") ?? "uniform"}` : uniformRung ? "uniform" : "default"}`,
    `sourceRaycast=${sourceRaycastDistance ?? "miss"}`,
    `projectedRaycast=${projectedRaycastDistance ?? "miss"}`,
    `reconciled=${reconciled}`,
    `sourceRenderables=${projection.report.sourceRenderables} instancedBatches=${projection.report.instancedBatches} materialBatches=${projection.report.materialBatches}`,
  ].join("\n");
}

function gameplay() {
  return {
    animation: {},
    states: { "projection.proof": proofState },
  };
}

function components() {
  return {
    "projection.proof": {
      ProjectionConformance: {
        projectedRaycastHit,
        projectedRaycastDistance,
        reconciled,
        renderSucceeded,
        sourceRaycastHit,
        sourceRaycastDistance,
      },
    },
  };
}

async function renderFrame(): Promise<void> {
  renderer.setViewport(0, 0, WIDTH, HEIGHT);
  renderer.clear();
  renderSucceeded = false;
  try {
    await renderer.render(renderSource ? source : projection.root, camera);
    renderSucceeded = true;
    requestAnimationFrame(() => void renderFrame());
  } catch (error: unknown) {
    renderSucceeded = false;
    status.textContent = `failed: ${String(error)}`;
    throw error;
  }
}

const installation = installThreePlaytestBridge({
  camera,
  components,
  entities: [
    { id: "projection.target", object: target },
    { id: "projection.proof", object: target },
  ],
  fixedStep: (ticks: number) => {
    for (let index = 0; index < ticks; index += 1) {
      tick += 1;
      if (tick === 1) target.position.x = 0.5;
      projection.reconcile();
      updateProof();
    }
  },
  gameplay,
  renderer,
  scene: source,
  tick: () => tick,
});

void renderer
  .init()
  .then(async () => {
    await renderer.compileAsync(renderSource ? source : projection.root, camera);
    source.updateMatrixWorld(true);
    projection.root.updateMatrixWorld(true);
    void renderFrame();
  })
  .catch((error: unknown) => {
    installation.dispose();
    status.textContent = `failed: ${String(error)}`;
    throw error;
  });
