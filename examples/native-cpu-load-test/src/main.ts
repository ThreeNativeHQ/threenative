import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Frustum,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Sphere,
  TorusGeometry,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import {
  type IRenderProjectionReport,
  SceneRenderProjection,
} from "../../../packages/core/src/renderProjection.js";
import {
  type IRenderAdvisorObservedPass,
  type IRenderAdvisorReport,
  adviseThreeRenderWorkload,
} from "../../../packages/playtest/src/three/renderWorkloadAdvisor.js";
import {
  EXPECTED_THREE_VERSION,
  type IRendererStageReport,
  installRendererStageHooks,
} from "../../../scripts/render-profile/renderer-stage-hooks.js";

type Hierarchy = "deep" | "flat";
type Visibility = "all-visible" | "mostly-culled";
/**
 * `scene-projection` is PRD-152's shipping implementation, and it runs the same code `defineGame`
 * does rather than a benchmark-local copy of it. The superseded `SceneCollapse` incumbent it was
 * measured against was deleted with the technical-debt audit; its archived differential numbers
 * live in that PRD's verification record, not in a live arm.
 */
type RenderMode =
  | "distinct-materials"
  | "independent"
  | "instanced"
  | "merged"
  | "scene-projection";
type ScenarioPreset = "fox-scale";

interface IScenario {
  dirtyRatio: 0 | 0.1 | 1;
  hierarchy: Hierarchy;
  objectCount: number;
  passes: 1 | 2;
  renderMode: RenderMode;
  rendererStages: boolean;
  renderAdvisor: boolean;
  samples: number;
  scenario?: ScenarioPreset;
  seed: number;
  visibility: Visibility;
  warmupFrames: number;
}

interface ITimingSamples {
  boundsCullMs: number[];
  drawCalls: number[];
  frameMs: number[];
  logicalObjects: number[];
  materialIdentities: number[];
  matrixWorldMs: number[];
  mutationMs: number[];
  renderMs: number[];
  triangles: number[];
  visibleCount: number[];
}

interface IProfileResult {
  adapter: Record<string, string> | null;
  rendererStages?: IRendererStageReport;
  renderAdvisor?: {
    readonly elapsedMs: number;
    readonly report: IRenderAdvisorReport;
  };
  scenario: IScenario;
  samples: ITimingSamples;
  sceneProjection?: {
    beforeSamples: ITimingSamples;
    report: IRenderProjectionReport;
    settleFrames: number;
    stabilityDrawCalls: number[];
    /**
     * §4.2's late-mutation pass. After 600 settled frames the workload moves hidden and static
     * objects, toggles visibility, recolours a material, adds, removes and reparents meshes and
     * mutates a signalled geometry attribute — then checks the very next frame reflects all of it
     * and that the draw count returns for the groups nothing touched.
     */
    lateMutation: {
      appliedOnNextFrame: boolean;
      drawCallsAfter: number;
      drawCallsBefore: number;
      observed: Record<string, boolean>;
      recoveredDrawCalls: number[];
    };
  };
}

declare global {
  interface Window {
    __TN_CPU_PROFILE__: {
      ready: Promise<void>;
      run: () => Promise<IProfileResult>;
    };
  }
}

function integerParameter(
  params: URLSearchParams,
  name: string,
  fallback: number,
  minimum = 0,
): number {
  const parsed = Number(params.get(name) ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${name} is invalid`);
  return parsed;
}

function scenarioFromLocation(): IScenario {
  const params = new URLSearchParams(location.search);
  const objectCount = integerParameter(params, "objects", 500, 1);
  const seed = integerParameter(params, "seed", 90210);
  const samples = integerParameter(params, "samples", 180, 1);
  const warmupFrames = integerParameter(params, "warmup", 120);
  const hierarchy = params.get("hierarchy") ?? "flat";
  const visibility = params.get("visibility") ?? "all-visible";
  const dirtyPercent = Number(params.get("dirty") ?? 10);
  const renderMode = params.get("renderMode") ?? "independent";
  const rendererStages = params.get("rendererStages") === "1";
  const renderAdvisor = params.get("renderAdvisor") === "1";
  const preset = params.get("scenario");
  const passes = integerParameter(params, "passes", 1, 1);
  if (hierarchy !== "flat" && hierarchy !== "deep") throw new Error("hierarchy is invalid");
  if (visibility !== "all-visible" && visibility !== "mostly-culled")
    throw new Error("visibility is invalid");
  if (![0, 10, 100].includes(dirtyPercent)) throw new Error("dirty is invalid");
  if (
    !["independent", "distinct-materials", "instanced", "merged", "scene-projection"].includes(
      renderMode,
    )
  )
    throw new Error("renderMode is invalid");
  if (preset !== null && preset !== "fox-scale") throw new Error("scenario is invalid");
  if (passes !== 1 && passes !== 2) throw new Error("passes is invalid");
  return {
    dirtyRatio: (dirtyPercent / 100) as 0 | 0.1 | 1,
    hierarchy,
    objectCount,
    passes,
    renderMode: renderMode as RenderMode,
    rendererStages,
    renderAdvisor,
    samples,
    scenario: preset === "fox-scale" ? preset : undefined,
    seed,
    visibility,
    warmupFrames,
  };
}

const VERIFIED_ADVISOR_EXAMPLES = {
  gpuParticles: "examples/abyss-framework/src/scenes/Abyss.ts",
  hudInstancing: "packages/create-threenative/templates/minimal/src/render/hud.ts",
  materialSharing: "packages/create-threenative/templates/starter/src/render/materials.ts",
  staticMerge: "examples/native-cpu-load-test/src/main.ts",
} as const;

function observedPasses(): IRenderAdvisorObservedPass[] {
  return Array.from({ length: scenario.passes }, () => ({
    cameraToken: "primary-camera",
    depthToken: "main-depth",
    equivalenceToken: "presented-color",
    purpose: "color" as const,
    renderCalls: 1,
    sceneToken: scenario.scenario ?? "matrix-scene",
    targetToken: "default-framebuffer",
  }));
}

function renderAdvisorReport(samples: ITimingSamples): IProfileResult["renderAdvisor"] {
  if (!scenario.renderAdvisor) return undefined;
  const start = performance.now();
  const report = adviseThreeRenderWorkload({
    materialMutationSafety:
      scenario.renderMode === "distinct-materials" ? "unknown" : "caller-declared-stable",
    observed: {
      passes: observedPasses(),
      renderer: {
        drawCalls: samples.drawCalls.at(-1),
        triangles: samples.triangles.at(-1),
      },
    },
    scene,
    transformSafety:
      scenario.renderMode === "scene-projection" || scenario.renderMode === "merged"
        ? "caller-declared-static"
        : "unknown",
    verifiedExamplePaths: VERIFIED_ADVISOR_EXAMPLES,
  });
  return { elapsedMs: performance.now() - start, report };
}

function hash(seed: number, id: number, channel: number): number {
  let value = (seed ^ Math.imul(id + 1, 0x9e37_79b1) ^ Math.imul(channel, 0x85eb_ca6b)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb_352d);
  value = Math.imul(value ^ (value >>> 15), 0x846c_a68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function unit(seed: number, id: number, channel: number): number {
  return hash(seed, id, channel) / 0x1_0000_0000;
}

const scenario = scenarioFromLocation();
const status = document.querySelector<HTMLDivElement>("#status");
if (!status) throw new Error("status element missing");
const statusElement = status;

const scene = new Scene();
scene.background = new Color(0x071018);
const camera = new PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 20_000);
camera.position.set(0, 0, 135);
camera.lookAt(0, 0, 0);
scene.add(new DirectionalLight(0xffffff, 2.2));

const renderer = new WebGPURenderer({ alpha: false, antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);
await renderer.init();
const rendererStageHooks = scenario.rendererStages
  ? installRendererStageHooks(renderer, { mode: "safe", threeVersion: EXPECTED_THREE_VERSION })
  : undefined;

const gpu = (
  navigator as Navigator & {
    gpu?: { requestAdapter: () => Promise<{ info: Record<string, string> } | null> };
  }
).gpu;
const adapter = await gpu?.requestAdapter().catch(() => null);
const adapterInfo: Record<string, string> | null = adapter?.info ? {} : null;
if (adapterInfo) {
  for (const key of ["architecture", "description", "device", "vendor"] as const) {
    const value = String(adapter?.info[key] ?? "");
    if (value) adapterInfo[key] = value;
  }
}

const geometry = new BoxGeometry(0.8, 0.8, 0.8);
const material = new MeshStandardMaterial({ color: 0x37b8ff, roughness: 0.55 });
const meshes: Mesh[] = [];
const materialIdentities = new Set<object>();
const animatedMeshIds: number[] = [];
const columns = Math.ceil(Math.sqrt(scenario.objectCount));

function trackMesh(mesh: Mesh): Mesh {
  meshes.push(mesh);
  const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const item of meshMaterials) materialIdentities.add(item);
  return mesh;
}

function addMesh(mesh: Mesh, parent = scene): Mesh {
  parent.add(trackMesh(mesh));
  return mesh;
}

function lowPolyMaterial(color: number): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, flatShading: true, roughness: 0.82 });
}

function buildFoxScaleScene(): void {
  camera.position.set(10, 18, 46);
  camera.lookAt(0, 5, 0);
  scene.background = new Color(0x94c8f2);
  const sun = new DirectionalLight(0xfff0d0, 1.6);
  sun.position.set(12, 24, 18);
  scene.add(sun);

  const grass = lowPolyMaterial(0x50ba2b);
  const dirt = lowPolyMaterial(0x9f7b52);
  const rock = lowPolyMaterial(0x8d826e);
  const wood = lowPolyMaterial(0xb87531);
  const trunk = lowPolyMaterial(0x9b6a3d);
  const leaves = lowPolyMaterial(0x319d25);
  const water = lowPolyMaterial(0x46b8ee);
  const cloud = new MeshBasicMaterial({ color: 0xffffff });
  const gold = lowPolyMaterial(0xffc629);
  const foxOrange = lowPolyMaterial(0xf47c24);
  const foxCream = lowPolyMaterial(0xffe0a6);
  const foxWhite = lowPolyMaterial(0xffffff);
  const black = lowPolyMaterial(0x1a1a1a);
  const hudRed = lowPolyMaterial(0xf22d35);
  const blueGem = lowPolyMaterial(0x25a8ff);

  const box = new BoxGeometry(1, 1, 1);
  const cone = new ConeGeometry(0.5, 1, 5);
  const cylinder = new CylinderGeometry(0.45, 0.45, 1, 6);
  const coin = new TorusGeometry(0.38, 0.08, 6, 12);
  const panel = new PlaneGeometry(1, 1);

  const platforms = [
    [-15, -3, 0, 12, 3, 9],
    [-2, 1, 0, 18, 7, 11],
    [13, -1, -1, 13, 5, 9],
    [25, 2, -3, 10, 4, 7],
  ] as const;
  for (const [x, y, z, sx, sy, sz] of platforms) {
    const cliff = addMesh(new Mesh(box, dirt));
    cliff.position.set(x, y - sy / 2, z);
    cliff.scale.set(sx, sy, sz);
    const top = addMesh(new Mesh(box, grass));
    top.position.set(x, y + 0.25, z);
    top.scale.set(sx + 0.4, 0.5, sz + 0.4);
    for (let stripe = 0; stripe < 3; stripe += 1) {
      const seam = addMesh(new Mesh(box, rock));
      seam.position.set(x, y - 1 - stripe * 1.35, z + sz / 2 + 0.04);
      seam.scale.set(
        sx * (0.55 + unit(scenario.seed, stripe + Math.floor(x), 4) * 0.35),
        0.18,
        0.08,
      );
    }
  }

  for (let plank = 0; plank < 18; plank += 1) {
    const board = addMesh(new Mesh(box, wood));
    board.position.set(-8 + plank * 0.75, -0.9, 5.6);
    board.scale.set(0.62, 0.16, 2.8);
    const railA = addMesh(new Mesh(cylinder, wood));
    railA.position.set(board.position.x, 0, 7.05);
    railA.scale.set(0.08, 1.9, 0.08);
    railA.rotation.z = Math.PI / 2;
    const railB = addMesh(new Mesh(cylinder, wood));
    railB.position.set(board.position.x, 0, 4.15);
    railB.scale.set(0.08, 1.9, 0.08);
    railB.rotation.z = Math.PI / 2;
  }

  const fox = new Group();
  fox.position.set(-4.8, 1.5, 7.6);
  fox.scale.setScalar(2.8);
  scene.add(fox);
  const foxParts = [
    [foxOrange, [0, 0.9, 0], [1.1, 0.75, 0.55]],
    [foxOrange, [0.72, 1.42, 0], [0.7, 0.58, 0.52]],
    [foxCream, [1.15, 1.35, 0], [0.34, 0.25, 0.36]],
    [foxOrange, [-0.85, 1.0, 0.05], [0.45, 0.35, 1.5]],
    [foxWhite, [-1.32, 1.0, 0.05], [0.25, 0.28, 0.6]],
  ] as const;
  for (const [mat, pos, scale] of foxParts) {
    const part = addMesh(new Mesh(box, mat), fox);
    part.position.set(...pos);
    part.scale.set(...scale);
    animatedMeshIds.push(meshes.length - 1);
  }
  for (const z of [-0.28, 0.28]) {
    const ear = addMesh(new Mesh(cone, foxOrange), fox);
    ear.position.set(0.75, 1.92, z);
    ear.scale.set(0.42, 0.7, 0.42);
    const eye = addMesh(new Mesh(box, black), fox);
    eye.position.set(1.12, 1.55, z * 0.85);
    eye.scale.set(0.08, 0.08, 0.08);
    animatedMeshIds.push(meshes.length - 2);
  }
  for (const x of [-0.36, 0.36]) {
    for (const z of [-0.22, 0.22]) {
      const leg = addMesh(new Mesh(box, foxOrange), fox);
      leg.position.set(x, 0.35, z);
      leg.scale.set(0.2, 0.65, 0.2);
      animatedMeshIds.push(meshes.length - 1);
    }
  }

  for (let i = 0; i < 44; i += 1) {
    const x = -22 + unit(scenario.seed, i, 1) * 54;
    const z = -11 + unit(scenario.seed, i, 2) * 22;
    const y = unit(scenario.seed, i, 3) > 0.55 ? 2.2 : -0.7;
    const trunkMesh = addMesh(new Mesh(cylinder, trunk));
    trunkMesh.position.set(x, y + 1.0, z);
    trunkMesh.scale.set(0.28, 2.0, 0.28);
    const crown = addMesh(new Mesh(cone, leaves));
    crown.position.set(x, y + 2.5, z);
    crown.scale.set(1.1, 2.0, 1.1);
  }

  for (let i = 0; i < 100; i += 1) {
    const c = addMesh(new Mesh(coin, gold));
    c.position.set(-8 + i * 0.34, 1.6 + Math.sin(i * 0.45) * 0.6, 4.1 + (i % 7) * 0.45);
    c.rotation.y = Math.PI / 2;
    c.scale.setScalar(0.75);
    animatedMeshIds.push(meshes.length - 1);
  }

  for (let i = 0; i < 8; i += 1) {
    const fall = addMesh(new Mesh(box, water));
    fall.position.set(-3 + i * 4.5, -2, -5.2);
    fall.scale.set(0.35, 8 + unit(scenario.seed, i, 8) * 3, 0.08);
    animatedMeshIds.push(meshes.length - 1);
  }
  for (let i = 0; i < 22; i += 1) {
    const tuft = addMesh(new Mesh(cone, leaves));
    tuft.position.set(
      -18 + unit(scenario.seed, i, 9) * 48,
      0.55,
      -4 + unit(scenario.seed, i, 10) * 15,
    );
    tuft.scale.set(0.24, 0.7, 0.24);
  }
  for (let i = 0; i < 11; i += 1) {
    const cloudMesh = addMesh(new Mesh(panel, cloud));
    cloudMesh.position.set(-24 + i * 5.2, 10 + Math.sin(i) * 2, -12);
    cloudMesh.scale.set(4 + (i % 3), 1.6, 1);
  }
  for (let i = 0; i < 3; i += 1) {
    const heart = addMesh(new Mesh(cone, hudRed));
    heart.position.set(-17 + i * 1.2, 12.5, 8);
    heart.rotation.z = Math.PI;
    heart.scale.set(0.55, 1.0, 0.55);
  }
  for (let i = 0; i < 4; i += 1) {
    const gem = addMesh(new Mesh(cone, blueGem));
    gem.position.set(14 + i * 0.65, 11.7 - i * 0.28, 8);
    gem.scale.set(0.35, 0.9, 0.35);
  }

  while (meshes.length < scenario.objectCount) {
    const id = meshes.length;
    const pebble = addMesh(new Mesh(box, id % 3 === 0 ? rock : id % 3 === 1 ? grass : dirt));
    pebble.position.set(
      -24 + unit(scenario.seed, id, 20) * 55,
      -0.4 + unit(scenario.seed, id, 21) * 5,
      -8 + unit(scenario.seed, id, 22) * 17,
    );
    const scale = 0.08 + unit(scenario.seed, id, 23) * 0.2;
    pebble.scale.set(scale, scale * 0.7, scale);
  }
}

if (scenario.scenario === "fox-scale") {
  buildFoxScaleScene();
} else {
  for (let id = 0; id < scenario.objectCount; id += 1) {
    const meshMaterial = scenario.renderMode === "distinct-materials" ? material.clone() : material;
    const mesh = trackMesh(new Mesh(geometry, meshMaterial));
    mesh.matrixAutoUpdate = true;
    const column = id % columns;
    const row = Math.floor(id / columns);
    const x = (column - (columns - 1) / 2) * 1.45;
    const y = (row - (Math.ceil(scenario.objectCount / columns) - 1) / 2) * 1.45;
    mesh.position.set(
      x + (scenario.visibility === "mostly-culled" && id % 10 !== 0 ? 10_000 : 0),
      y,
      (unit(scenario.seed, id, 2) - 0.5) * 8,
    );
    mesh.rotation.set(unit(scenario.seed, id, 3) * 0.4, unit(scenario.seed, id, 4) * Math.PI, 0);
    if (
      scenario.renderMode === "independent" ||
      scenario.renderMode === "scene-projection" ||
      scenario.renderMode === "distinct-materials"
    ) {
      if (scenario.hierarchy === "deep" && id % 64 !== 0) {
        meshes[id - 1]?.add(mesh);
      } else {
        scene.add(mesh);
      }
    }
  }

  if (scenario.renderMode === "instanced") {
    const instanced = new InstancedMesh(geometry, material, meshes.length);
    for (let index = 0; index < meshes.length; index += 1) {
      meshes[index]?.updateMatrix();
      instanced.setMatrixAt(index, meshes[index]?.matrix ?? new Matrix4());
    }
    instanced.instanceMatrix.needsUpdate = true;
    scene.add(instanced);
  } else if (scenario.renderMode === "merged") {
    const transformed = meshes.map((mesh) => {
      mesh.updateMatrix();
      return geometry.clone().applyMatrix4(mesh.matrix);
    });
    const merged = mergeGeometries(transformed, false);
    for (const item of transformed) item.dispose();
    if (!merged) throw new Error("failed to merge benchmark geometry");
    scene.add(new Mesh(merged, material));
  }
}

const dirtyCount = Math.round(scenario.objectCount * scenario.dirtyRatio);
const dirtyIds = [
  ...new Set([
    ...meshes
      .map((_, id) => ({ id, rank: hash(scenario.seed, id, 17) }))
      .sort((left, right) => left.rank - right.rank || left.id - right.id)
      .slice(0, dirtyCount)
      .map(({ id }) => id),
    ...animatedMeshIds,
  ]),
].sort((left, right) => left - right);
const projectionView = new Matrix4();
const frustum = new Frustum();
const localSphere = new Sphere(new Vector3(), Math.sqrt(3) * 0.4);
const worldSphere = new Sphere();
let tick = 0;

function presentFrame(): void {
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld();
  scene.matrixWorldAutoUpdate = false;
  renderer.render(scene, camera);
}

function createSamples(): ITimingSamples {
  return {
    boundsCullMs: [],
    drawCalls: [],
    frameMs: [],
    logicalObjects: [],
    materialIdentities: [],
    matrixWorldMs: [],
    mutationMs: [],
    renderMs: [],
    triangles: [],
    visibleCount: [],
  };
}

function oneFrame(
  record: boolean,
  samples?: ITimingSamples,
  projection?: SceneRenderProjection,
): void {
  const frameStart = performance.now();
  const mutationStart = frameStart;
  tick += 1;
  for (const id of dirtyIds) {
    const mesh = meshes[id];
    if (!mesh) continue;
    if (scenario.scenario === "fox-scale") {
      mesh.rotation.y += 0.008 + ((id + tick) % 11) * 0.0002;
      mesh.position.y += Math.sin((tick + id) * 0.035) * 0.0015;
    } else {
      mesh.rotation.y += 0.001 + ((id + tick) % 7) * 0.00001;
      mesh.position.z += Math.sin((tick + id) * 0.01) * 0.0002;
    }
    mesh.matrixWorldNeedsUpdate = true;
  }
  const mutationEnd = performance.now();

  const matrixStart = mutationEnd;
  // The projection refreshes the authored scene's world matrices itself, because it is not what
  // the renderer is handed and nothing else would. Doing it here as well would charge the
  // candidate for two full matrix passes where it ships with one, so this arm records its matrix
  // cost inside `reconcile` instead — which lands in `frameMs` either way, and `frameMs` is what
  // §4.3's thresholds are applied to.
  if (projection === undefined) scene.updateMatrixWorld(true);
  const matrixEnd = performance.now();
  // Keep `renderer.render()` from repeating the matrix pass we time explicitly above.
  scene.matrixWorldAutoUpdate = false;

  const cullStart = matrixEnd;
  let visibleCount = 0;
  const cullRepeats = Math.max(1, Math.ceil(20_000 / meshes.length));
  for (let repeat = 0; repeat < cullRepeats; repeat += 1) {
    projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projectionView);
    for (const mesh of meshes) {
      worldSphere.copy(localSphere).applyMatrix4(mesh.matrixWorld);
      if (frustum.intersectsSphere(worldSphere)) visibleCount += 1;
    }
  }
  const cullEnd = performance.now();

  // Reconciled inside the measured frame, before the draw, exactly where `defineGame` does it.
  // Moving it outside the timed window would be the "hide the cost somewhere else" failure §4.3
  // item 6 exists to catch.
  projection?.reconcile();

  const renderStart = cullEnd;
  renderer.info.reset();
  // Whatever the projection resolves to — its mirror when it is faithful, the authored scene when
  // it is not. The arm draws the shipping path's own render input rather than a fixture-local one.
  const renderInput = projection?.root ?? scene;
  for (let pass = 0; pass < scenario.passes; pass += 1) {
    renderer.render(renderInput, camera);
  }
  const renderEnd = performance.now();

  if (record && samples) {
    samples.mutationMs.push(mutationEnd - mutationStart);
    samples.matrixWorldMs.push(matrixEnd - matrixStart);
    samples.boundsCullMs.push((cullEnd - cullStart) / cullRepeats);
    samples.drawCalls.push(renderer.info.render.drawCalls);
    samples.logicalObjects.push(meshes.length);
    samples.materialIdentities.push(materialIdentities.size);
    samples.renderMs.push(renderEnd - renderStart);
    samples.frameMs.push(
      renderEnd - frameStart - (cullEnd - cullStart) + (cullEnd - cullStart) / cullRepeats,
    );
    samples.triangles.push(renderer.info.render.triangles);
    samples.visibleCount.push(visibleCount / cullRepeats);
  }
}

async function run(): Promise<IProfileResult> {
  for (let frame = 0; frame < scenario.warmupFrames; frame += 1) await oneFrame(false);
  rendererStageHooks?.reset();
  if (scenario.renderMode === "scene-projection") {
    // Measured before the projection exists, so this arm carries its own unbatched control on the
    // identical workload rather than relying on a separate `independent` run to have drawn the
    // same scene.
    const beforeSamples = createSamples();
    for (let frame = 0; frame < scenario.samples; frame += 1) await oneFrame(true, beforeSamples);

    // The shipping implementation with shipping defaults, constructed exactly as `defineGame`
    // constructs it. A benchmark-local batcher or a tuned option here would make every number
    // below describe something the user never runs.
    const projection = new SceneRenderProjection(scene, { minMeshes: 8 });
    let settleFrames = 0;
    for (; settleFrames < 5_000 && projection.deoptimized; settleFrames += 1) {
      oneFrame(false, undefined, projection);
    }
    if (projection.deoptimized) throw new Error("SceneRenderProjection did not project in fixture");
    const report = projection.report;

    const samples = createSamples();
    for (let frame = 0; frame < scenario.samples; frame += 1)
      await oneFrame(true, samples, projection);

    const stabilityDrawCalls: number[] = [];
    for (let frame = 0; frame < 300; frame += 1) {
      oneFrame(false, undefined, projection);
      renderer.info.reset();
      renderer.render(projection.root, camera);
      stabilityDrawCalls.push(renderer.info.render.drawCalls);
    }

    // ── §4.2's late-mutation pass, run long past any settling.
    for (let frame = 0; frame < 600; frame += 1) {
      oneFrame(false, undefined, projection);
    }
    renderer.info.reset();
    renderer.render(projection.root, camera);
    const drawCallsBefore = renderer.info.render.drawCalls;

    const moved = meshes[0] as Mesh;
    const hiddenMesh = meshes[1] as Mesh;
    const removed = meshes[2] as Mesh;
    const reparented = meshes[3] as Mesh;
    const removedParent = removed.parent;
    const reparentHome = reparented.parent;
    const relocated = new Group();
    relocated.position.set(0, 500, 0);
    scene.add(relocated);

    moved.position.set(0, 900, 0);
    moved.updateMatrix();
    hiddenMesh.visible = false;
    removedParent?.remove(removed);
    relocated.add(reparented);
    // A material the game recolours, and a geometry attribute it streams into with the signal
    // three.js itself requires. Raw writes without `needsUpdate` are deliberately not covered:
    // the stock renderer does not upload those either.
    const recoloured = (meshes[4] as Mesh).material as MeshStandardMaterial;
    recoloured.color.setRGB(1, 0, 0);
    const streamed = (meshes[5] as Mesh).geometry.getAttribute("position");
    streamed.setXYZ(0, 3, 3, 3);
    streamed.needsUpdate = true;
    const added = new Mesh((meshes[6] as Mesh).geometry, (meshes[6] as Mesh).material);
    added.position.set(0, -900, 0);
    scene.add(added);

    // Exactly one frame later. "Next frame" is the contract; catching up two frames later is a
    // stale frame the player saw.
    oneFrame(false, undefined, projection);
    renderer.info.reset();
    renderer.render(projection.root, camera);
    const drawCallsAfter = renderer.info.render.drawCalls;
    const after = projection.report;
    const observed = {
      movedFollowed: projection.inspect(moved)?.matrixWorld.elements[13] === 900,
      hiddenDropped: projection.inspect(hiddenMesh)?.visible === false,
      removedGone: projection.inspect(removed) === undefined,
      reparentedFollowed: projection.inspect(reparented)?.matrixWorld.elements[13] === 500,
      addedDrawn: projection.inspect(added) !== undefined,
      // The game's own material instance still drives a draw, so recolouring it recolours what is
      // on screen without the mirror being told anything.
      recolouredLive: projection.drawsWith(recoloured),
      // Nothing was abandoned: the object count did not collapse because one geometry streamed.
      streamedUploaded: after.projectedObjects >= report.projectedObjects - 1,
      stillProjecting: !projection.deoptimized,
    };

    const recoveredDrawCalls: number[] = [];
    for (let frame = 0; frame < 60; frame += 1) {
      oneFrame(false, undefined, projection);
      renderer.info.reset();
      renderer.render(projection.root, camera);
      recoveredDrawCalls.push(renderer.info.render.drawCalls);
    }

    statusElement.textContent = `complete\n${scenario.scenario ?? "matrix"}\nobjects ${meshes.length}\nscene-projection\nmaterials ${materialIdentities.size}\nvisible ${samples.visibleCount.at(-1)?.toFixed(0) ?? "n/a"}`;
    rendererStageHooks?.dispose();
    return {
      adapter: adapterInfo,
      samples,
      scenario,
      sceneProjection: {
        beforeSamples,
        report: after,
        settleFrames,
        stabilityDrawCalls,
        lateMutation: {
          appliedOnNextFrame: Object.values(observed).every(Boolean),
          drawCallsAfter,
          drawCallsBefore,
          observed,
          recoveredDrawCalls,
        },
      },
    };
  }
  const samples = createSamples();
  for (let frame = 0; frame < scenario.samples; frame += 1) await oneFrame(true, samples);
  statusElement.textContent = `complete\n${scenario.scenario ?? "matrix"}\nobjects ${meshes.length}\n${scenario.renderMode} · passes ${scenario.passes}\nmaterials ${materialIdentities.size}\nvisible ${samples.visibleCount.at(-1)?.toFixed(0) ?? "n/a"}`;
  const rendererStages = rendererStageHooks?.snapshot({ measuredFrameCount: scenario.samples });
  rendererStageHooks?.dispose();
  return {
    adapter: adapterInfo,
    ...(rendererStages === undefined ? {} : { rendererStages }),
    ...(scenario.renderAdvisor ? { renderAdvisor: renderAdvisorReport(samples) } : {}),
    samples,
    scenario,
  };
}

statusElement.textContent = `ready\n${scenario.scenario ?? "matrix"}\nobjects ${scenario.objectCount}\n${scenario.renderMode} · passes ${scenario.passes}\n${scenario.visibility}`;
presentFrame();
window.__TN_CPU_PROFILE__ = { ready: Promise.resolve(), run };
