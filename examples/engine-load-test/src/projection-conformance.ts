import { installThreePlaytestBridge } from "@threenative/playtest/three";
import {
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { ScenePicker } from "../../../packages/core/src/picking.js";
import { SceneRenderProjection } from "../../../packages/core/src/renderProjection.js";
import type { Viewport } from "../../../packages/core/src/viewport.js";

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
for (let index = 0; index < ANCHOR_COUNT; index += 1) {
  const anchor = new Mesh(anchorGeometry, material);
  anchor.position.set(20 + (index % 8) * 2, Math.floor(index / 8) * 2 - 15, 0);
  source.add(anchor);
}

const uniqueMeshes: Mesh[] = [];
for (let index = 0; index < UNIQUE_COUNT; index += 1) {
  const mesh = new Mesh(new BoxGeometry(1, 1 + index * 0.002, 1), material);
  if (index < VISIBLE_UNIQUE_COUNT) {
    mesh.position.set((index % 4) * 2.5 - 3.75, Math.floor(index / 4) * 2.5 - 3.75, 0);
  } else {
    mesh.position.set((index % 8) * 2 - 7, Math.floor(index / 8) * 2 - 7, -FAR_DISTANCE);
  }
  source.add(mesh);
  uniqueMeshes.push(mesh);
}
const target = uniqueMeshes[0] as Mesh;

const camera = new PerspectiveCamera(50, WIDTH / HEIGHT, 0.1, 40);
camera.position.set(0, 0, 8);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);

const projection = new SceneRenderProjection(source);
projection.reconcile();
if (
  projection.deoptimized ||
  projection.report.instancedBatches !== 1 ||
  projection.report.materialBatches !== 1 ||
  projection.report.projectedObjects !== ANCHOR_COUNT + UNIQUE_COUNT
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
let sourceRaycastDistance: number | null = null;
let projectedRaycastDistance: number | null = null;

function matrixMatches(
  left: { elements: readonly number[] },
  right: { elements: readonly number[] },
): boolean {
  if (left.elements.length !== right.elements.length) return false;
  for (let index = 0; index < left.elements.length; index += 1) {
    if (left.elements[index] !== right.elements[index]) return false;
  }
  return true;
}

function raycastDistance(picker: ScenePicker): number | null {
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
    Math.abs((sourceRaycastDistance as number) - (projectedRaycastDistance as number)) < 0.0001;
  proofState = raycastMatches && reconciled ? "raycast-match-reconciled" : "proof-failed";
  status.textContent = [
    "PRD-238 projection consumer conformance",
    `state=${proofState} tick=${tick}`,
    `sourceRaycast=${sourceRaycastDistance ?? "miss"}`,
    `projectedRaycast=${projectedRaycastDistance ?? "miss"}`,
    `reconciled=${reconciled}`,
    `sourceRenderables=${projection.report.sourceRenderables} materialBatches=${projection.report.materialBatches}`,
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
        sourceRaycastHit,
        sourceRaycastDistance,
      },
    },
  };
}

async function renderFrame(): Promise<void> {
  renderer.setViewport(0, 0, WIDTH, HEIGHT);
  renderer.clear();
  try {
    await renderer.render(renderSource ? source : projection.root, camera);
    requestAnimationFrame(() => void renderFrame());
  } catch (error: unknown) {
    status.textContent = `failed: ${String(error)}`;
  }
}

const installation = installThreePlaytestBridge({
  camera,
  components,
  entities: [
    { id: "projection.target", object: target },
    { id: "projection.proof", object: target },
  ],
  fixedStep: (ticks) => {
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
  });
