import {
  BoxGeometry,
  Color,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  REVISION,
  Scene,
  WebGPURenderer,
} from "three/webgpu";
import {
  MESH_FIXTURE,
  MESH_VIEWPORT,
  type MeshVariant,
  meshCamera,
  meshMaterialColor,
  meshMaterialCount,
  meshObjects,
  meshRotation,
} from "./mesh-fixture.js";

export interface IMeshProjection {
  dispose(): void;
  reconcile(): void;
  report: { reasonCode: string; projectedObjects: number; resultDrawCandidates: number };
  root: Object3D;
}

export interface IMeshScene {
  camera: PerspectiveCamera;
  dispose(): void;
  independentlyUpdatedObjects: number;
  materialCount: number;
  objectCount: number;
  scene: Scene;
  step(frameId: number): void;
}

/** Scene construction is shared by plain Three and TN; only the projection hook differs. */
export function buildMeshScene(count: number, variant: MeshVariant): IMeshScene {
  const objects = meshObjects(count, variant);
  const scene = new Scene();
  scene.background = new Color(MESH_FIXTURE.backgroundColor);
  const camera = new PerspectiveCamera(
    MESH_FIXTURE.cameraFov,
    MESH_VIEWPORT.width / MESH_VIEWPORT.height,
    MESH_FIXTURE.cameraNear,
    MESH_FIXTURE.cameraFar,
  );
  const pose = meshCamera(count);
  camera.position.set(pose.x, pose.y, pose.z);
  camera.lookAt(MESH_FIXTURE.cameraTargetX, MESH_FIXTURE.cameraTargetY, MESH_FIXTURE.cameraTargetZ);
  const geometry = new BoxGeometry(
    MESH_FIXTURE.boxSize,
    MESH_FIXTURE.boxSize,
    MESH_FIXTURE.boxSize,
  );
  const materials = Array.from(
    { length: meshMaterialCount(variant) },
    (_, index) => new MeshBasicMaterial({ color: meshMaterialColor(index) }),
  );
  const instanced = variant === "rotating-instanced";
  const meshes: Mesh[] = [];
  let batch: InstancedMesh | undefined;
  const dummy = new Object3D();
  if (instanced) {
    batch = new InstancedMesh(geometry, materials[0] as MeshBasicMaterial, count);
    batch.frustumCulled = false;
    scene.add(batch);
  } else {
    for (const object of objects) {
      const mesh = new Mesh(geometry, materials[object.material] as MeshBasicMaterial);
      mesh.position.set(object.x, object.y, object.z);
      scene.add(mesh);
      meshes.push(mesh);
    }
  }
  const step = (frameId: number): void => {
    if (!Number.isInteger(frameId) || frameId < 0) throw new Error("TN_BENCH_BAD_FRAME_ID");
    if (batch !== undefined) {
      for (const object of objects) {
        const [x, y] = meshRotation(object.id, frameId, variant);
        dummy.position.set(object.x, object.y, object.z);
        dummy.rotation.set(x, y, 0);
        dummy.updateMatrix();
        batch.setMatrixAt(object.id, dummy.matrix);
      }
      batch.instanceMatrix.needsUpdate = true;
      return;
    }
    for (const object of objects) {
      const [x, y] = meshRotation(object.id, frameId, variant);
      (meshes[object.id] as Mesh).rotation.set(x, y, 0);
    }
  };
  step(0);
  return {
    camera,
    dispose: () => {
      batch?.dispose();
      geometry.dispose();
      for (const material of materials) material.dispose();
    },
    independentlyUpdatedObjects: variant === "static" ? 0 : count,
    materialCount: materials.length,
    objectCount: count,
    scene,
    step,
  };
}

export interface IMeshHarness extends IMeshScene {
  adapter: IMeshAdapterIdentity;
  drain(): Promise<void>;
  projectionReport(): IMeshProjection["report"] | null;
  render(): Promise<void>;
  stats(): { drawCalls: number; triangles: number };
  threeRevision: string;
}

/**
 * `GPUAdapterInfo` keeps its fields on the prototype, so a bare `JSON.stringify(info)` is `{}` and
 * the run would carry no identity at all; each field is read by name. `null` means the backend did
 * not report it, which the collector refuses rather than passing off as an adapter.
 */
export interface IMeshAdapterIdentity {
  architecture: string | null;
  description: string | null;
  device: string | null;
  vendor: string | null;
}

/**
 * Read from the adapter the browser actually handed out, never assumed, and the same way the
 * ladder arms in `main.ts` do: `three`'s WebGPU backend keeps its adapter in a local, so a run that
 * read the backend would record nothing and a software fallback would look like a clean run.
 */
async function describeAdapter(): Promise<IMeshAdapterIdentity> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (gpu === undefined) throw new Error("TN_BENCH_IDENTITY_MISSING:gpu");
  const adapter = (await gpu.requestAdapter()) as {
    info?: {
      architecture?: string;
      description?: string;
      device?: string;
      vendor?: string;
    };
  } | null;
  const info = adapter?.info;
  if (info === undefined || info === null) throw new Error("TN_BENCH_IDENTITY_MISSING:gpu");
  const read = (value: string | undefined): string | null =>
    value === undefined || value.length === 0 ? null : value;
  const identity: IMeshAdapterIdentity = {
    architecture: read(info.architecture),
    description: read(info.description),
    device: read(info.device),
    vendor: read(info.vendor),
  };
  if (Object.values(identity).every((value) => value === null))
    throw new Error("TN_BENCH_IDENTITY_MISSING:gpu");
  return identity;
}

export async function createMeshHarness(
  canvas: HTMLCanvasElement,
  count: number,
  variant: MeshVariant,
  createProjection?: (scene: Scene) => IMeshProjection,
): Promise<IMeshHarness> {
  const renderer = new WebGPURenderer({ antialias: MESH_FIXTURE.antialias, canvas });
  renderer.setPixelRatio(MESH_FIXTURE.pixelRatio);
  renderer.setSize(MESH_VIEWPORT.width, MESH_VIEWPORT.height, false);
  await renderer.init();
  renderer.info.autoReset = false;
  const built = buildMeshScene(count, variant);
  const projection = createProjection?.(built.scene);
  const backend = renderer.backend as unknown as {
    device?: { queue?: { onSubmittedWorkDone?: () => Promise<void> } };
  };
  const adapter = await describeAdapter();
  const drain = async (): Promise<void> => {
    if (backend.device?.queue?.onSubmittedWorkDone === undefined)
      throw new Error("TN_BENCH_GPU_COMPLETION_UNAVAILABLE");
    await backend.device.queue.onSubmittedWorkDone();
  };
  return {
    ...built,
    adapter,
    dispose: () => {
      projection?.dispose();
      built.dispose();
      renderer.dispose();
    },
    drain,
    projectionReport: () => projection?.report ?? null,
    render: async () => {
      renderer.info.reset();
      await renderer.render(projection?.root ?? built.scene, built.camera);
    },
    stats: () => ({
      drawCalls: renderer.info.render.drawCalls,
      triangles: renderer.info.render.triangles,
    }),
    step: (frameId) => {
      built.step(frameId);
      projection?.reconcile();
    },
    threeRevision: REVISION,
  };
}
