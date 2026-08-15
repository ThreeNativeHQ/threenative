// The portable half of the PRD-117 ThreeNative arm: it builds the scene, steps it from a frame
// index, and renders. It touches no browser global other than the canvas handed to it, so the
// device arms of Phase 4 can drive the same file.
import {
  BoxGeometry,
  DirectionalLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGPURenderer,
} from "three/webgpu";
import { type ISceneCollapseReport, SceneCollapse } from "../../../packages/core/src/collapse.js";
import {
  type ICubePlacement,
  type RenderMode,
  cameraPose,
  createPlacements,
  cubeBobY,
  cubeRotationX,
  cubeRotationY,
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
  collapse: SceneCollapse | undefined;
  cubes: Mesh[];
  instanced: InstancedMesh | undefined;
  placements: ICubePlacement[];
  rung: ILoadTestRung;
}

export async function createLoadTestHarness(
  canvas: HTMLCanvasElement,
  adapterLabel = "unknown",
  animateObjects = true,
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
  // One shared lit material for ground and cubes, one directional light, no shadows: two shaders
  // would be two experiments (PRD-117 §3.1).
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

  const dummy = new Object3D();
  const instanceMatrix = new Matrix4();
  let state: IRungState | undefined;

  const clearRung = (): void => {
    if (state === undefined) return;
    // Restore first, remove second. `restore()` puts the collapsed pass's source meshes back into
    // the scene, so undoing it after the removal loop re-inserts every cube and the next rung
    // renders the previous rung's leftovers on top of its own.
    state.collapse?.restore();
    for (const cube of state.cubes) scene.remove(cube);
    if (state.instanced !== undefined) {
      scene.remove(state.instanced);
      state.instanced.dispose();
    }
    state = undefined;
  };

  const setRung = (rung: ILoadTestRung): void => {
    clearRung();
    // Cleared per rung, not per collapse: a stale report made an L2 rung inherit the previous L3
    // rung's `movingParts`, which is the one number the frozen-scene guard reads.
    collapseReport = undefined;
    const placements = createPlacements(rung.objectCount);
    const cubes: Mesh[] = [];
    let instanced: InstancedMesh | undefined;
    if (rung.mode === "L1" || rung.mode === "L3") {
      for (const placement of placements) {
        const cube = new Mesh(cubeGeometry, material);
        cube.position.set(placement.x, placement.y, placement.z);
        scene.add(cube);
        cubes.push(cube);
      }
    } else if (rung.objectCount > 0) {
      instanced = new InstancedMesh(cubeGeometry, material, rung.objectCount);
      // The batch is one cull unit on both engines; leaving it in makes the cull depend on a
      // bounding volume each engine derives differently, which is not what L2 is measuring.
      instanced.frustumCulled = false;
      scene.add(instanced);
    }
    state = { collapse: undefined, cubes, instanced, placements, rung };
  };

  // Driven by the ladder before the measured window opens: the pass watches, bakes across frames,
  // and only then starts refreshing moving parts. A rung that begins measuring mid-bake would time
  // the bake, not the collapsed scene.
  let collapseReport: ISceneCollapseReport | undefined;

  const beginCollapse = (): void => {
    if (state === undefined || state.rung.mode !== "L3") return;
    collapseReport = undefined;
    // No tuning: `defineGame` constructs `new SceneCollapse(scene)` with defaults and calls
    // `frame()` every frame, so L3 must use the same defaults or it measures a hand-tuned pass
    // rather than what a ThreeNative game actually gets.
    state.collapse = new SceneCollapse(scene as never, {
      onReport: (value) => {
        collapseReport = value;
      },
    });
  };

  const collapseStatus = (): string =>
    collapseReport === undefined ? "pending" : collapseReport.status;

  // Integrity check, not a statistic: a collapse that baked every cube as static would render a
  // frozen scene while the animation loop still burned its whole cost, and the rung would publish a
  // fast number for a picture that is not the one L1 drew.
  const collapseMovingParts = (): number => collapseReport?.movingParts ?? -1;

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
    // 100% dirty transforms every frame — the honest worst case a game with moving actors pays.
    if (state.rung.mode === "L1" || state.rung.mode === "L3") {
      // Diagnostic only: with the animation off, `stepMs` is the framework's refresh alone, which
      // is what separates "the engine is slow" from "the game's own gameplay loop is slow". A
      // framework fix can only ever address the first.
      if (animateObjects) {
        for (let index = 0; index < state.cubes.length; index += 1) {
          const cube = state.cubes[index] as Mesh;
          const placement = state.placements[index] as ICubePlacement;
          cube.position.y = cubeBobY(index, frameIndex, placement.y);
          cube.rotation.x = cubeRotationX(index, frameIndex);
          cube.rotation.y = cubeRotationY(index, frameIndex);
        }
      }
      // L3 pays this on the game side every frame: the collapse pass reads the same moved meshes
      // and pushes their transforms into the baked draw. It is part of the frame, not a setup cost.
      const collapseStartedAt = performance.now();
      state.collapse?.frame();
      collapseMs = performance.now() - collapseStartedAt;
      stepMs = performance.now() - startedAt;
      return;
    }
    const instanced = state.instanced;
    if (instanced === undefined) {
      stepMs = performance.now() - startedAt;
      return;
    }
    for (let index = 0; index < state.placements.length; index += 1) {
      const placement = state.placements[index] as ICubePlacement;
      dummy.position.set(placement.x, cubeBobY(index, frameIndex, placement.y), placement.z);
      dummy.rotation.set(cubeRotationX(index, frameIndex), cubeRotationY(index, frameIndex), 0);
      dummy.updateMatrix();
      instanceMatrix.copy(dummy.matrix);
      instanced.setMatrixAt(index, instanceMatrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
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
      await renderer.render(scene, camera);
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
      const visibleObjects =
        state?.rung.mode === "L1" ? Math.max(0, drawCalls - 1) : (state?.rung.objectCount ?? 0);
      // L3's draw count is the finding: if the collapse applied, it is small; if it declined, this
      // is L1 with extra steps and the report must show that rather than hide it.
      return { drawCalls, triangles, visibleObjects };
    },
    step,
  };
}
