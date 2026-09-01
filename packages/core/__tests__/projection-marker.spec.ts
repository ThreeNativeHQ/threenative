import {
  BoxGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Scene,
  SkinnedMesh,
} from "three";
import { describe, expect, it } from "vitest";
import { formatProjectionWindow, rankExactReasons } from "../src/projection-marker.js";
import { SceneRenderProjection } from "../src/renderProjection.js";

const GEOMETRY = new BoxGeometry(1, 1, 1);

/** A scene with enough ordinary props to clear the mesh floor, so the projection engages. */
function scenery(count: number): Scene {
  const scene = new Scene();
  const material = new MeshStandardMaterial();
  for (let index = 0; index < count; index += 1) {
    const mesh = new Mesh(GEOMETRY, material);
    mesh.position.set(index % 10, 0, Math.floor(index / 10));
    scene.add(mesh);
  }
  return scene;
}

function payload(line: string): Record<string, unknown> {
  const marker = "TN_PROJECTION:";
  expect(line.startsWith(marker)).toBe(true);
  return JSON.parse(line.slice(marker.length)) as Record<string, unknown>;
}

describe("projection window marker", () => {
  it("should report a per-reason count for every exact-lane object", () => {
    const scene = scenery(300);
    const instanced = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 3);
    instanced.position.set(0, 0, 40);
    const skinned = new SkinnedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    skinned.position.set(0, 0, 44);
    const multiMaterial = new Mesh(new BoxGeometry(1, 1, 1), [
      new MeshBasicMaterial(),
      new MeshBasicMaterial(),
    ]);
    multiMaterial.position.set(0, 0, 48);
    scene.add(instanced, skinned, multiMaterial);

    const projection = new SceneRenderProjection(scene, { minMeshes: 8 });
    projection.reconcile();
    const line = payload(formatProjectionWindow(projection.report, 3, 41));

    expect(line.projecting).toBe(true);
    expect(line.window).toBe(3);
    expect(line.exactObjects).toBe(3);
    expect(line.exact).toMatchObject({ instanced: 1, multiMaterial: 1, skinned: 1 });
    expect(line.sourceRenderables).toBe(303);
  });

  it("should report actual draws separately from planned draws", () => {
    const projection = new SceneRenderProjection(scenery(300), { minMeshes: 8 });
    projection.reconcile();
    const line = payload(formatProjectionWindow(projection.report, 2, 41));

    // Two distinct fields, never aliased: on WebGPU a BatchedMesh issues one drawIndexed per
    // visible member, so a plan of one draw per batch is a claim the renderer need not honour.
    expect(line.drawsPlanned).toBe(projection.report.drawsPlanned);
    expect(line.drawsActual).toBe(41);
    expect(line.drawsPlanned).not.toBe(line.drawsActual);
  });

  it("should omit the measured count rather than report zero when nothing measured it", () => {
    const projection = new SceneRenderProjection(scenery(300), { minMeshes: 8 });
    projection.reconcile();
    const line = payload(formatProjectionWindow(projection.report, 1, undefined));

    expect(line.drawsActual).toBeUndefined();
    expect("drawsActual" in line).toBe(false);
  });

  it("should emit the marker with its reason when the projection declines", () => {
    // Four meshes is below any sane floor, so the projection refuses to build a mirror.
    const projection = new SceneRenderProjection(scenery(4), { minMeshes: 64 });
    projection.reconcile();
    const line = payload(formatProjectionWindow(projection.report, 1, 4));

    expect(line.projecting).toBe(false);
    expect(line.reasonCode).toBe("belowMeshFloor");
    expect(typeof line.reason).toBe("string");
    // A declined frame draws the authored scene, so its plan is the authored count, not zero —
    // zero would read as "this frame cost nothing".
    expect(line.drawsPlanned).toBe(4);
  });

  it("should rank the exact lane by the draws each reason costs", () => {
    expect(rankExactReasons({ instanced: 2, multiMaterial: 9, skinned: 40 })).toEqual([
      { count: 40, reason: "skinned" },
      { count: 9, reason: "multiMaterial" },
      { count: 2, reason: "instanced" },
    ]);
  });

  it("should drop reasons that cost nothing and order ties by name", () => {
    expect(rankExactReasons({ instanced: 0, lod: 3, skinned: 3 })).toEqual([
      { count: 3, reason: "lod" },
      { count: 3, reason: "skinned" },
    ]);
    expect(rankExactReasons({})).toEqual([]);
  });
});
