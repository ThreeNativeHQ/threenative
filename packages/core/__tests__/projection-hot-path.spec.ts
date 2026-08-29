import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type BatchedMesh,
  BoxGeometry,
  BufferAttribute,
  Group,
  InstancedMesh,
  LOD,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  SkinnedMesh,
  Sprite,
  SpriteMaterial,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type IProjectionExactEntry,
  createProjectionScanWorkspace,
  exactLaneReason,
  scanProjection,
} from "../src/projection-plan.js";
import { SceneRenderProjection } from "../src/renderProjection.js";

/**
 * Steady-state per-frame cost of the render projection and the frame instruments.
 *
 * These are allocation/call-count proofs, not timing benches: a scene that changes nothing
 * between frames must not re-derive work per frame that a single derivation could answer.
 */

function projectedScene(meshCount: number, depth: number): Scene {
  const scene = new Scene();
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshBasicMaterial();
  for (let index = 0; index < meshCount; index += 1) {
    let parent: Object3D = scene;
    for (let level = 0; level < depth; level += 1) {
      const group = new Group();
      parent.add(group);
      parent = group;
    }
    parent.add(new Mesh(geometry, material));
  }
  return scene;
}

function projectionOver(scene: Scene): SceneRenderProjection {
  const projection = new SceneRenderProjection(scene, {
    minMeshes: 4,
    onReport: () => undefined,
  });
  projection.reconcile();
  return projection;
}

function materialBatchProbe(): {
  batch: BatchedMesh;
  camera: PerspectiveCamera;
  group: Group;
  projection: SceneRenderProjection;
  root: Scene;
} {
  const source = new Scene();
  const material = new MeshBasicMaterial();
  const anchorGeometry = new BoxGeometry(1, 1, 1);
  for (let index = 0; index < 64; index += 1) {
    source.add(new Mesh(anchorGeometry, material));
  }
  for (let index = 0; index < 64; index += 1) {
    const mesh = new Mesh(new BoxGeometry(1, 1 + index * 0.001, 1), material);
    mesh.position.z = index < 16 ? 0 : 1_000;
    source.add(mesh);
  }

  const projection = projectionOver(source);

  let batch: BatchedMesh | undefined;
  projection.root.traverse((object) => {
    if ((object as BatchedMesh).isBatchedMesh === true) batch = object as BatchedMesh;
  });
  if (batch === undefined) throw new Error("Projection mirror did not build a material batch");

  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  projection.root.updateMatrixWorld(true);
  return { batch, camera, group: new Group(), projection, root: projection.root };
}

function instancedBatchProbe(): {
  batch: InstancedMesh;
  camera: PerspectiveCamera;
  group: Group;
  projection: SceneRenderProjection;
  root: Scene;
} {
  const source = new Scene();
  const geometry = new BoxGeometry(1, 1, 1);
  geometry.computeBoundingSphere();
  const material = new MeshBasicMaterial();
  for (let index = 0; index < 1_024; index += 1) {
    const mesh = new Mesh(geometry, material);
    mesh.position.z = index < 256 ? 0 : 1_000;
    source.add(mesh);
  }
  const projection = projectionOver(source);
  let batch: InstancedMesh | undefined;
  projection.root.traverse((object) => {
    if ((object as InstancedMesh).isInstancedMesh === true) batch = object as InstancedMesh;
  });
  if (batch === undefined) throw new Error("Projection mirror did not build an instanced batch");

  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  projection.root.updateMatrixWorld(true);
  return { batch, camera, group: new Group(), projection, root: projection.root };
}

function countCollectionConstructors(run: () => void): { maps: number; sets: number } {
  const originalMap = globalThis.Map;
  const originalSet = globalThis.Set;
  let maps = 0;
  let sets = 0;

  class CountingMap<K, V> extends originalMap<K, V> {
    constructor(entries?: Iterable<readonly [K, V]> | null) {
      super(entries);
      maps += 1;
    }
  }
  class CountingSet<T> extends originalSet<T> {
    constructor(values?: Iterable<T> | null) {
      super(values);
      sets += 1;
    }
  }

  globalThis.Map = CountingMap;
  globalThis.Set = CountingSet;
  try {
    run();
  } finally {
    globalThis.Map = originalMap;
    globalThis.Set = originalSet;
  }
  return { maps, sets };
}

describe("projection hot path", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the culling benchmark on the production projection consumer", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../../examples/engine-load-test/src/main.ts", import.meta.url)),
      "utf8",
    );

    expect(source).toContain("SceneRenderProjection");
    expect(source).toContain("projection.reconcile()");
    expect(source).not.toContain("ProjectionMirror");
    expect(source).not.toContain("IProjectionProjectPlan");
    expect(source).not.toMatch(/(?:mirror|projectionMirror)\.apply\(/u);
  });

  // RED: walkProjection never descends into an LOD (projection-plan.ts skips the subtree), so
  // no object the scan visits can have an LOD ancestor. specializedLaneReason still walks every
  // ancestor of every renderable on every scan checking isLOD — work that can never fire. The
  // legitimate isLOD reads are two per visited group (classify on visit, decide descent), so
  // anything beyond 2 per group is the dead ancestor walk.
  // Mutation: give the walk an internal lane-reason variant without the ancestor loop (the
  // exported exactLaneReason keeps its behaviour for out-of-walk callers).
  it("reads isLOD at most twice per visited group per projected scan", () => {
    const meshCount = 300;
    const depth = 5;
    const scene = projectedScene(meshCount, depth);
    const projection = projectionOver(scene);
    expect(projection.deoptimized).toBe(false);

    const original = Object.getOwnPropertyDescriptor(Object3D.prototype, "isLOD");
    let groupIsLodReads = 0;
    Object.defineProperty(Object3D.prototype, "isLOD", {
      configurable: true,
      get(this: Object3D) {
        if ((this as Mesh).isMesh !== true) groupIsLodReads += 1;
        return false;
      },
    });
    try {
      projection.reconcile();
    } finally {
      if (original === undefined)
        Reflect.deleteProperty(Object3D.prototype as { isLOD?: unknown }, "isLOD");
      else Object.defineProperty(Object3D.prototype, "isLOD", original);
    }
    expect(groupIsLodReads).toBeLessThanOrEqual(2 * meshCount * depth);
  });

  // RED: a projected scene that changed nothing still scans every batch instance twice per
  // frame for retirement — #retireBatches (#retire's seen.has per instance) plus #retireState
  // (seen.has per #state entry). Every #state entry belongs to a live batch instance, whose
  // departure #retireBatches already deleted, so the second whole-population sweep deletes
  // nothing, ever. Mutation: delete the #retireState call (and method) in projection-apply.ts.
  it("spends fewer than 3.5 retirement lookups per instance per steady frame", () => {
    const meshCount = 300;
    const scene = projectedScene(meshCount, 0);
    const projection = projectionOver(scene);
    expect(projection.deoptimized).toBe(false);

    const realGet = WeakMap.prototype.get;
    let lookups = 0;
    const spy = vi.spyOn(WeakMap.prototype, "get");
    spy.mockImplementation(function (this: WeakMap<object, unknown>, value: object) {
      lookups += 1;
      return realGet.call(this, value);
    });
    try {
      projection.reconcile();
    } finally {
      spy.mockRestore();
    }
    expect(lookups).toBeLessThan(meshCount * 3.5);
  });

  // RED mutation: change PER_OBJECT_FRUSTUM_CULLED to false in projection-apply.ts; the setting
  // assertion fails and the companion sub-draw test returns the uncompacted count.
  it("should still allocate nothing per frame with culling enabled", () => {
    const { batch, camera, group, projection, root } = materialBatchProbe();
    try {
      expect(batch.perObjectFrustumCulled).toBe(true);
      const allocations = countCollectionConstructors(() => {
        for (let frame = 0; frame < 10; frame += 1) {
          batch.onBeforeRender(
            undefined as never,
            root,
            camera,
            batch.geometry,
            batch.material as MeshBasicMaterial,
            group,
          );
        }
      });
      expect(allocations).toEqual({ maps: 0, sets: 0 });
    } finally {
      projection.dispose();
    }
  });

  it("should still allocate nothing per frame while syncing instanced batches", () => {
    const { batch, camera, group, projection, root } = instancedBatchProbe();
    try {
      const allocations = countCollectionConstructors(() => {
        for (let frame = 0; frame < 10; frame += 1) {
          batch.onBeforeRender(
            undefined as never,
            root,
            camera,
            batch.geometry,
            batch.material as MeshBasicMaterial,
            group,
          );
        }
      });
      expect(batch.count).toBe(1_024);
      expect(allocations).toEqual({ maps: 0, sets: 0 });
    } finally {
      projection.dispose();
    }
  });

  // The scan classifies through an internal variant that skips the LOD ancestor walk (the walk
  // never descends into an LOD, so no scanned object can have one). This pins the two
  // classifications together across every lane-reason branch: if the internal variant ever
  // drops or narrows a branch the exported reason carries, a projected frame batches or
  // draws the wrong objects, and this fails.
  it("classifies every scanned object exactly as the exported exactLaneReason would", () => {
    const scene = new Scene();
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshBasicMaterial();
    for (let index = 0; index < 8; index += 1) scene.add(new Mesh(geometry, material));

    const transparent = new Mesh(geometry, new MeshBasicMaterial());
    transparent.material.transparent = true;
    scene.add(transparent);
    const ordered = new Mesh(geometry, material);
    ordered.renderOrder = 3;
    scene.add(ordered);
    const morphed = new Mesh(geometry, material);
    morphed.geometry = geometry.clone();
    morphed.geometry.morphAttributes.position = [new BufferAttribute(new Float32Array(24), 3)];
    scene.add(morphed);
    const ranged = new Mesh(geometry.clone(), material);
    ranged.geometry.setDrawRange(0, 6);
    scene.add(ranged);
    scene.add(new InstancedMesh(geometry, material, 4));
    scene.add(new SkinnedMesh(geometry, material));
    scene.add(new Sprite(new SpriteMaterial()));
    const lod = new LOD();
    lod.addLevel(new Mesh(geometry, material), 0);
    scene.add(lod);
    scene.add(new Mesh(geometry, [material, material]));

    const workspace = createProjectionScanWorkspace();
    const result = scanProjection(scene, 4, workspace);
    for (let index = 0; index < result.exactLaneCount; index += 1) {
      const entry = result.exactLane[index] as IProjectionExactEntry;
      expect(entry.object).toBeDefined();
      expect(entry.reason).toBe(exactLaneReason(entry.object as Object3D));
    }
    expect(result.plan.action).toBe("project");
    if (result.plan.action !== "project") return;
    for (const group of result.plan.batchGroups) {
      if (group === undefined) continue;
      for (let index = 0; index < group.memberCount; index += 1)
        expect(exactLaneReason(group.members[index] as Mesh)).toBeUndefined();
    }
    for (let index = 0; index < result.plan.belowFloorCount; index += 1)
      expect(exactLaneReason(result.plan.belowFloor[index] as Mesh)).toBeUndefined();
  });
});
