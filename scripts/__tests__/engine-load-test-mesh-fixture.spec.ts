import { describe, expect, it } from "vitest";
import { parseMeshBrowserOptions } from "../../examples/engine-load-test/src/mesh-browser.js";
import {
  meshCamera,
  meshFixtureHash,
  meshMaterialColor,
  meshObjects,
  meshRotation,
} from "../../examples/engine-load-test/src/mesh-fixture.js";
import { buildMeshScene } from "../../examples/engine-load-test/src/mesh-harness.js";
import { SceneRenderProjection } from "../../packages/core/src/renderProjection.js";

describe("independent-mesh fixture", () => {
  it("keeps the same visual input across ordinary and projection-off authoring", async () => {
    const normal = meshObjects(1000, "rotating");
    const unprojected = meshObjects(1000, "rotating-projection-off");
    const instanced = meshObjects(1000, "rotating-instanced");
    expect(normal).toEqual(unprojected);
    expect(normal).toEqual(instanced);
    expect(await meshFixtureHash(normal, "rotating")).toBe(
      await meshFixtureHash(unprojected, "rotating-projection-off"),
    );
    expect(await meshFixtureHash(normal, "rotating")).toBe(
      await meshFixtureHash(instanced, "rotating-instanced"),
    );
    expect(meshRotation(9, 60, "rotating")).toEqual(meshRotation(9, 60, "rotating-instanced"));
    expect(meshRotation(9, 60, "static")).toEqual([0, 0]);
  });

  it("counts every object and detects a changed object beyond the legacy first-eight window", async () => {
    const objects = meshObjects(20_000, "rotating");
    expect(objects).toHaveLength(20_000);
    expect(new Set(objects.map((object) => object.id)).size).toBe(20_000);
    const before = await meshFixtureHash(objects, "rotating");
    const changed = objects.map((object) => ({ ...object }));
    const ninth = changed[8];
    if (ninth === undefined) throw new Error("missing ninth fixture object");
    ninth.x += 0.01;
    expect(await meshFixtureHash(changed, "rotating")).not.toBe(before);
    expect(meshCamera(20_000).z).toBeGreaterThan(0);
  });

  it("makes the 64-material diagnostic a distinct fixture", async () => {
    const shared = meshObjects(1000, "rotating");
    const varied = meshObjects(1000, "rotating-64-materials");
    expect(new Set(shared.map((object) => object.material)).size).toBe(1);
    expect(new Set(varied.map((object) => object.material)).size).toBe(64);
    expect(new Set(varied.map((object) => meshMaterialColor(object.material))).size).toBe(64);
    expect(await meshFixtureHash(shared, "rotating")).not.toBe(
      await meshFixtureHash(varied, "rotating-64-materials"),
    );
    expect(() => meshObjects(0, "static")).toThrow(/BAD_MESH_COUNT/u);
  });

  it("builds independent meshes and an instanced counterpart with identical transforms", () => {
    const plain = buildMeshScene(16, "rotating");
    const instanced = buildMeshScene(16, "rotating-instanced");
    try {
      expect(plain.scene.children).toHaveLength(16);
      expect(instanced.scene.children).toHaveLength(1);
      expect(plain.independentlyUpdatedObjects).toBe(16);
      plain.step(60);
      instanced.step(60);
      const mesh = plain.scene.children[9] as (typeof plain.scene.children)[number] & {
        isMesh?: boolean;
      };
      const batch = instanced.scene.children[0] as (typeof instanced.scene.children)[number] & {
        isInstancedMesh?: boolean;
        getMatrixAt(index: number, matrix: typeof mesh.matrix): void;
      };
      if (mesh?.isMesh !== true || batch?.isInstancedMesh !== true)
        throw new Error("wrong scene authoring");
      mesh.updateMatrix();
      const matrix = mesh.matrix.clone();
      batch.getMatrixAt(9, matrix);
      for (const [index, value] of matrix.elements.entries()) {
        expect(Math.abs(value - (mesh.matrix.elements[index] as number))).toBeLessThan(0.00001);
      }
      expect(() => plain.step(-1)).toThrow(/BAD_FRAME_ID/u);
    } finally {
      plain.dispose();
      instanced.dispose();
    }
  });

  it("rejects malformed browser workload requests before scene construction", () => {
    expect(
      parseMeshBrowserOptions("?count=20000&variant=rotating-instanced&frames=600&warmup=120"),
    ).toMatchObject({ count: 20000, variant: "rotating-instanced", frames: 600, warmup: 120 });
    expect(() => parseMeshBrowserOptions("?count=0")).toThrow(/count/u);
    expect(() => parseMeshBrowserOptions("?variant=unknown")).toThrow(/variant/u);
    expect(() => parseMeshBrowserOptions("?frames=1.5")).toThrow(/frames/u);
  });

  it("checks the TN default projection on ordinary independent authoring", () => {
    const built = buildMeshScene(1000, "rotating");
    const projection = new SceneRenderProjection(built.scene);
    try {
      built.step(0);
      projection.reconcile();
      expect(projection.report.reasonCode).toBe("projected");
      expect(projection.report.sourceRenderables).toBe(1000);
      expect(projection.report.projectedObjects).toBe(1000);
      built.step(60);
      projection.reconcile();
      expect(projection.report.reasonCode).toBe("projected");
      expect(projection.report.resultDrawCandidates).toBeLessThan(1000);
    } finally {
      projection.dispose();
      built.dispose();
    }
  });
});
