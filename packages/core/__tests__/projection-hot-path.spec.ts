import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Scene } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("projection hot path", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
        if (this.isMesh !== true) groupIsLodReads += 1;
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
});
