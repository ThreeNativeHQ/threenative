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
  dispose(): void;
  positionHash: string;
  render(): Promise<void>;
  setRung(rung: ILoadTestRung): void;
  stats(): ILoadTestFrameStats;
  step(frameIndex: number): void;
}

interface IRungState {
  cubes: Mesh[];
  instanced: InstancedMesh | undefined;
  placements: ICubePlacement[];
  rung: ILoadTestRung;
}

export async function createLoadTestHarness(
  canvas: HTMLCanvasElement,
  adapterLabel = "unknown",
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
    for (const cube of state.cubes) scene.remove(cube);
    if (state.instanced !== undefined) {
      scene.remove(state.instanced);
      state.instanced.dispose();
    }
    state = undefined;
  };

  const setRung = (rung: ILoadTestRung): void => {
    clearRung();
    const placements = createPlacements(rung.objectCount);
    const cubes: Mesh[] = [];
    let instanced: InstancedMesh | undefined;
    if (rung.mode === "L1") {
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
    state = { cubes, instanced, placements, rung };
  };

  const step = (frameIndex: number): void => {
    if (state === undefined) throw new Error("TN_BENCH_NO_RUNG");
    const pose = cameraPose(frameIndex, state.rung.objectCount);
    camera.position.set(pose.x, pose.y, pose.z);
    camera.lookAt(pose.targetX, pose.targetY, pose.targetZ);
    // 100% dirty transforms every frame — the honest worst case a game with moving actors pays.
    if (state.rung.mode === "L1") {
      for (let index = 0; index < state.cubes.length; index += 1) {
        const cube = state.cubes[index] as Mesh;
        const placement = state.placements[index] as ICubePlacement;
        cube.position.y = cubeBobY(index, frameIndex, placement.y);
        cube.rotation.x = cubeRotationX(index, frameIndex);
        cube.rotation.y = cubeRotationY(index, frameIndex);
      }
      return;
    }
    const instanced = state.instanced;
    if (instanced === undefined) return;
    for (let index = 0; index < state.placements.length; index += 1) {
      const placement = state.placements[index] as ICubePlacement;
      dummy.position.set(placement.x, cubeBobY(index, frameIndex, placement.y), placement.z);
      dummy.rotation.set(cubeRotationX(index, frameIndex), cubeRotationY(index, frameIndex), 0);
      dummy.updateMatrix();
      instanceMatrix.copy(dummy.matrix);
      instanced.setMatrixAt(index, instanceMatrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
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
    setRung,
    stats: () => {
      const drawCalls = renderer.info.render.drawCalls;
      const triangles = renderer.info.render.triangles;
      const visibleObjects =
        state?.rung.mode === "L1" ? Math.max(0, drawCalls - 1) : (state?.rung.objectCount ?? 0);
      return { drawCalls, triangles, visibleObjects };
    },
    step,
  };
}
