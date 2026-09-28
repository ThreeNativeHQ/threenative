// The portable half of the PRD-117 ThreeNative arm: it builds the scene, steps it from a frame
// index, and renders. It touches no browser global other than the canvas handed to it, so the
// device arms of Phase 4 can drive the same file.
import {
  BoxGeometry,
  type BufferGeometry,
  DirectionalLight,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  type OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGPURenderer,
} from "three/webgpu";
import {
  type IRenderProjectionReport,
  SceneRenderProjection,
} from "../../../packages/core/src/renderProjection.js";
import {
  DEFAULT_AXES,
  type ICubePlacement,
  type IWorkloadAxes,
  type RenderMode,
  assertRungAxesSupported,
  cameraPose,
  createPlacements,
  cubeBobY,
  cubeRotationX,
  cubeRotationY,
  culledOffsetX,
  isMutated,
  latticeExtent,
  positionHash,
} from "./workload.js";

export const VIEWPORT_WIDTH = 1280;
export const VIEWPORT_HEIGHT = 720;

export interface ILoadTestRung {
  mode: RenderMode;
  objectCount: number;
}

export interface ILoadTestFrameStats {
  drawCalls: number;
  triangles: number;
  visibleObjects: number;
}

export interface ILoadTestHarness {
  adapterLabel: string;
  beginCollapse(): void;
  collapseMovingParts(): number;
  collapseMs: number;
  collapseStatus(): string;
  dispose(): void;
  positionHash: string;
  render(): Promise<void>;
  renderer: WebGPURenderer;
  setRung(rung: ILoadTestRung): void;
  stats(): ILoadTestFrameStats;
  step(frameIndex: number): void;
  stepMs: number;
}

interface IRungState {
  collapse: SceneRenderProjection | undefined;
  cubes: Mesh[];
  geometries: BufferGeometry[];
  groups: Group[];
  instanced: InstancedMesh | undefined;
  materials: Material[];
  placements: ICubePlacement[];
  rung: ILoadTestRung;
}

// A hierarchy-depth chain hangs the whole rung under nested groups; depth 0 keeps the cubes direct
// scene children, which is the PRD-117 scene.
function attachHierarchy(scene: Scene, depth: number): { groups: Group[]; parent: Object3D } {
  let parent: Object3D = scene;
  const groups: Group[] = [];
  for (let level = 0; level < depth; level += 1) {
    const group = new Group();
    parent.add(group);
    groups.push(group);
    parent = group;
  }
  return { groups, parent };
}

// The shadow camera has to cover the lattice, whose extent is a function of the rung.
function configureShadowCamera(light: DirectionalLight, objectCount: number): void {
  const extent = latticeExtent(objectCount);
  const shadowCamera = light.shadow.camera as OrthographicCamera;
  shadowCamera.left = -extent;
  shadowCamera.right = extent;
  shadowCamera.top = extent;
  shadowCamera.bottom = -extent;
  shadowCamera.near = 0.1;
  shadowCamera.far = extent * 4 + 200;
  shadowCamera.updateProjectionMatrix();
}

interface IAuthoredCubes {
  cubes: Mesh[];
  geometries: BufferGeometry[];
  materials: Material[];
}

// The authored L1/L3 rung: shared geometry and material by default, per-object clones when either
// uniqueness axis is on, and culled objects pushed past the far plane.
function buildAuthoredCubes(
  placements: readonly ICubePlacement[],
  parent: Object3D,
  axes: IWorkloadAxes,
  cubeGeometry: BoxGeometry,
  material: Material,
  shadowCasterCount: number,
): IAuthoredCubes {
  const cubes: Mesh[] = [];
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index] as ICubePlacement;
    const uniqueGeometry = axes.geometry === "unique";
    const uniqueMaterial = axes.material === "unique";
    const geometry = uniqueGeometry ? cubeGeometry.clone() : cubeGeometry;
    const meshMaterial = uniqueMaterial ? material.clone() : material;
    if (uniqueGeometry) geometries.push(geometry);
    if (uniqueMaterial) materials.push(meshMaterial);
    const cube = new Mesh(geometry, meshMaterial);
    cube.position.set(
      placement.x + culledOffsetX(index, axes.visibleFraction),
      placement.y,
      placement.z,
    );
    if (index < shadowCasterCount) cube.castShadow = true;
    parent.add(cube);
    cubes.push(cube);
  }
  return { cubes, geometries, materials };
}

function writeAuthoredTransforms(
  cubes: readonly Mesh[],
  placements: readonly ICubePlacement[],
  frameIndex: number,
  axes: IWorkloadAxes,
): void {
  for (let index = 0; index < cubes.length; index += 1) {
    if (!isMutated(index, axes.mutationRate)) continue;
    const cube = cubes[index] as Mesh;
    const placement = placements[index] as ICubePlacement;
    cube.position.y = cubeBobY(index, frameIndex, placement.y);
    cube.rotation.x = cubeRotationX(index, frameIndex);
    cube.rotation.y = cubeRotationY(index, frameIndex);
  }
}

// One instance's transform: the lattice pose with the cull offset, bobbed and rotated only when the
// instance is dirty this frame. `mutated` false is the base pose baked into the buffer at `setRung`.
function writeInstanceMatrix(
  target: Matrix4,
  index: number,
  placement: ICubePlacement,
  frameIndex: number,
  mutated: boolean,
  axes: IWorkloadAxes,
  dummy: Object3D,
): void {
  dummy.position.set(
    placement.x + culledOffsetX(index, axes.visibleFraction),
    mutated ? cubeBobY(index, frameIndex, placement.y) : placement.y,
    placement.z,
  );
  dummy.rotation.set(
    mutated ? cubeRotationX(index, frameIndex) : 0,
    mutated ? cubeRotationY(index, frameIndex) : 0,
    0,
  );
  dummy.updateMatrix();
  target.copy(dummy.matrix);
}

// The base pose every instance starts from, written once per rung before the measured window. A
// mutation rate of 0 still draws the lattice because of this; without it the batch would sit at the
// origin. The upload is requested once here, never per frame.
export function initInstanceMatrices(
  instanced: InstancedMesh,
  placements: readonly ICubePlacement[],
  axes: IWorkloadAxes,
  dummy: Object3D,
  instanceMatrix: Matrix4,
): void {
  for (let index = 0; index < placements.length; index += 1) {
    writeInstanceMatrix(
      instanceMatrix,
      index,
      placements[index] as ICubePlacement,
      0,
      false,
      axes,
      dummy,
    );
    instanced.setMatrixAt(index, instanceMatrix);
  }
  instanced.instanceMatrix.needsUpdate = true;
}

// Only the instances the mutation rate selects are rewritten; the return is whether anything moved,
// which gates the GPU upload. At the default 1 every instance is dirty, preserving the old all-dirty
// frame; at 0 the buffer is never touched after `initInstanceMatrices`.
export function writeInstanceMatrices(
  instanced: InstancedMesh,
  placements: readonly ICubePlacement[],
  frameIndex: number,
  axes: IWorkloadAxes,
  dummy: Object3D,
  instanceMatrix: Matrix4,
): boolean {
  let changed = false;
  for (let index = 0; index < placements.length; index += 1) {
    if (!isMutated(index, axes.mutationRate)) continue;
    writeInstanceMatrix(
      instanceMatrix,
      index,
      placements[index] as ICubePlacement,
      frameIndex,
      true,
      axes,
      dummy,
    );
    instanced.setMatrixAt(index, instanceMatrix);
    changed = true;
  }
  return changed;
}

export async function createLoadTestHarness(
  canvas: HTMLCanvasElement,
  adapterLabel = "unknown",
  animateObjects = true,
  axes: IWorkloadAxes = DEFAULT_AXES,
): Promise<ILoadTestHarness> {
  const renderer = new WebGPURenderer({ antialias: false, canvas });
  renderer.setPixelRatio(1);
  renderer.setSize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT, false);
  await renderer.init();
  // three's own rAF clears the per-frame counters even when no animation loop is set, so a
  // harness that reads them after yielding reads zero. This harness owns the reset.
  renderer.info.autoReset = false;

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, VIEWPORT_WIDTH / VIEWPORT_HEIGHT, 0.1, 4000);
  // One shared lit material for ground and cubes, one directional light: two shaders would be two
  // experiments (PRD-117 §3.1). Shadows are off at the default axes and enabled only by the
  // shadow-caster-share axis.
  const material = new MeshStandardMaterial({ color: 0xb8c4cc, metalness: 0, roughness: 0.75 });
  const cubeGeometry = new BoxGeometry(1, 1, 1);
  const ground = new Mesh(new PlaneGeometry(200, 200), material);
  ground.rotation.x = -Math.PI / 2;
  ground.matrixAutoUpdate = false;
  ground.updateMatrix();
  scene.add(ground);
  const light = new DirectionalLight(0xffffff, 2.4);
  light.position.set(40, 80, 25);
  scene.add(light);
  if (axes.shadowCasterShare > 0) {
    renderer.shadowMap.enabled = true;
    light.castShadow = true;
    ground.receiveShadow = true;
  }

  const dummy = new Object3D();
  const instanceMatrix = new Matrix4();
  let state: IRungState | undefined;

  const clearRung = (): void => {
    if (state === undefined) return;
    // Released before the cubes are removed. The projection holds instanced draws built from this
    // rung's geometry; leaving them alive across a rung change would draw the previous rung's
    // objects on top of the next one's.
    state.collapse?.dispose();
    for (const cube of state.cubes) cube.removeFromParent();
    if (state.instanced !== undefined) {
      state.instanced.removeFromParent();
      state.instanced.dispose();
    }
    // The unique-geometry/material axis clones per rung, so the clones are this rung's to release.
    for (const group of state.groups) group.removeFromParent();
    for (const geometry of state.geometries) geometry.dispose();
    for (const owned of state.materials) owned.dispose();
    state = undefined;
  };

  const setRung = (rung: ILoadTestRung): void => {
    // Fail before anything is torn down: an unsupported L2 cell is a configuration error, not a
    // scene to measure.
    assertRungAxesSupported(rung.mode, axes);
    clearRung();
    // Cleared per rung, not per collapse: a stale report made an L2 rung inherit the previous L3
    // rung's `movingParts`, which is the one number the frozen-scene guard reads.
    collapseReport = undefined;
    const placements = createPlacements(rung.objectCount);
    const { groups, parent } = attachHierarchy(scene, axes.hierarchyDepth);
    const cubes: Mesh[] = [];
    const geometries: BufferGeometry[] = [];
    const materials: Material[] = [];
    let instanced: InstancedMesh | undefined;
    const shadowCasterCount = Math.ceil(rung.objectCount * axes.shadowCasterShare);
    if (rung.mode === "L1" || rung.mode === "L3") {
      const authored = buildAuthoredCubes(
        placements,
        parent,
        axes,
        cubeGeometry,
        material,
        shadowCasterCount,
      );
      cubes.push(...authored.cubes);
      geometries.push(...authored.geometries);
      materials.push(...authored.materials);
    } else if (rung.objectCount > 0) {
      instanced = new InstancedMesh(cubeGeometry, material, rung.objectCount);
      // The batch is one cull unit on both engines; leaving it in makes the cull depend on a
      // bounding volume each engine derives differently, which is not what L2 is measuring.
      instanced.frustumCulled = false;
      if (shadowCasterCount > 0) instanced.castShadow = true;
      parent.add(instanced);
      // Base poses baked once, not every frame: the per-frame writer then touches only the dirty
      // subset, so a mutation rate of 0 leaves the batch static and never re-uploads it.
      initInstanceMatrices(instanced, placements, axes, dummy, instanceMatrix);
    }
    if (axes.shadowCasterShare > 0) {
      configureShadowCamera(light, rung.objectCount);
    }
    state = {
      collapse: undefined,
      cubes,
      geometries,
      groups,
      instanced,
      materials,
      placements,
      rung,
    };
  };

  // Driven by the ladder before the measured window opens: the pass watches, bakes across frames,
  // and only then starts refreshing moving parts. A rung that begins measuring mid-bake would time
  // the bake, not the collapsed scene.
  let collapseReport: IRenderProjectionReport | undefined;

  const beginCollapse = (): void => {
    if (state === undefined || state.rung.mode !== "L3") return;
    collapseReport = undefined;
    // No tuning: `defineGame` constructs `new SceneRenderProjection(scene)` with defaults and
    // reconciles it every frame, so L3 must use the same defaults or it measures a hand-tuned
    // optimizer rather than what a ThreeNative game actually gets.
    state.collapse = new SceneRenderProjection(scene, {
      onReport: (value) => {
        collapseReport = value;
      },
    });
  };

  const collapseStatus = (): string =>
    collapseReport === undefined ? "pending" : collapseReport.reasonCode;

  // Integrity check, not a statistic: a collapse that baked every cube as static would render a
  // frozen scene while the animation loop still burned its whole cost, and the rung would publish a
  // fast number for a picture that is not the one L1 drew.
  const collapseMovingParts = (): number => state?.collapse?.report.projectedObjects ?? -1;

  // The game-side half of a frame, timed separately from the renderer's half: without the split
  // an L1 regression cannot be told apart from a scene-graph one. `collapseMs` splits it once more,
  // into the game's own animation and the framework's refresh — only the second is the framework's
  // to fix, and guessing which dominates is how the wrong thing gets optimised.
  let stepMs = 0;
  let collapseMs = 0;

  const step = (frameIndex: number): void => {
    if (state === undefined) throw new Error("TN_BENCH_NO_RUNG");
    const startedAt = performance.now();
    const pose = cameraPose(frameIndex, state.rung.objectCount);
    camera.position.set(pose.x, pose.y, pose.z);
    camera.lookAt(pose.targetX, pose.targetY, pose.targetZ);
    // The mutation-rate axis decides which objects are dirty this frame; at the default 1 every
    // transform moves, which is the honest worst case a game with moving actors pays.
    if (state.rung.mode === "L1" || state.rung.mode === "L3") {
      // Diagnostic only: with the animation off, `stepMs` is the framework's refresh alone, which
      // is what separates "the engine is slow" from "the game's own gameplay loop is slow". A
      // framework fix can only ever address the first.
      if (animateObjects) {
        writeAuthoredTransforms(state.cubes, state.placements, frameIndex, axes);
      }
      // L3 pays this on the game side every frame: the collapse pass reads the same moved meshes
      // and pushes their transforms into the baked draw. It is part of the frame, not a setup cost.
      const collapseStartedAt = performance.now();
      state.collapse?.reconcile();
      collapseMs = performance.now() - collapseStartedAt;
      stepMs = performance.now() - startedAt;
      return;
    }
    const instanced = state.instanced;
    if (instanced === undefined) {
      stepMs = performance.now() - startedAt;
      return;
    }
    if (
      writeInstanceMatrices(instanced, state.placements, frameIndex, axes, dummy, instanceMatrix)
    ) {
      // Only a frame that actually moved an instance asks for the upload.
      instanced.instanceMatrix.needsUpdate = true;
    }
    stepMs = performance.now() - startedAt;
  };

  return {
    adapterLabel,
    dispose: () => {
      clearRung();
      renderer.dispose();
    },
    get positionHash() {
      return positionHash(state?.placements ?? []);
    },
    render: async () => {
      // `info.reset()` is only automatic inside three's own animation loop; this harness drives
      // its own rAF, so the per-frame counters are ours to clear.
      renderer.info.reset();
      // The projection's own render input when L3 has one, the authored scene otherwise. Same
      // resolution `defineGame` performs, so this rung draws what a shipped game draws. The
      // pass-count axis re-renders the same input; the default is one pass.
      const root = state?.collapse?.root ?? scene;
      for (let pass = 0; pass < axes.passCount; pass += 1) await renderer.render(root, camera);
    },
    beginCollapse,
    collapseStatus,
    renderer,
    setRung,
    collapseMovingParts,
    get collapseMs() {
      return collapseMs;
    },
    get stepMs() {
      return stepMs;
    },
    stats: () => {
      const drawCalls = renderer.info.render.drawCalls;
      const triangles = renderer.info.render.triangles;
      // `drawCalls` totals every render pass, so the per-object count divides the pass count.
      const visibleObjects =
        state?.rung.mode === "L1"
          ? Math.max(0, drawCalls / axes.passCount - 1)
          : (state?.rung.objectCount ?? 0);
      // L3's draw count is the finding: if the collapse applied, it is small; if it declined, this
      // is L1 with extra steps and the report must show that rather than hide it.
      return { drawCalls, triangles, visibleObjects };
    },
    step,
  };
}
