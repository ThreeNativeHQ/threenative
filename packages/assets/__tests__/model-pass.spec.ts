import { readFile } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import type { Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { describe, expect, it, vi } from "vitest";
import {
  FIXTURE_PATH,
  type IFixtureOptions,
  buildFixtureDocument,
  buildFixtureGlb,
} from "../../../test-support/generate-fixture-model.js";
import { assertNoDrift, modelPass, reachableStats } from "../src/passes/model.js";

/** Re-reads pass output exactly as self-verification does: codecs registered. */
async function readVerified(buffer: Buffer): Promise<ReturnType<Document["getRoot"]>> {
  const io = new NodeIO()
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder })
    .registerExtensions((await import("@gltf-transform/extensions")).ALL_EXTENSIONS);
  return (await io.readJSON(await io.binaryToJSON(buffer))).getRoot();
}

function countTriangles(document: ReturnType<Document["getRoot"]>): number {
  return (
    document
      .listMeshes()
      .flatMap((mesh) => mesh.listPrimitives())
      .reduce((total, primitive) => total + (primitive.getIndices()?.getCount() ?? 0), 0) / 3
  );
}

describe("modelPass", () => {
  it("should preserve triangle and vertex counts through the full pass chain", async () => {
    const input = Buffer.from(await buildFixtureGlb());
    const result = await modelPass().apply(input, "character.glb");

    if (Buffer.isBuffer(result)) throw new Error("model pass returned an unchanged buffer");
    const output = await readVerified(result.buffer);
    // The fixture carries one 12-triangle grid plus one 24-index (8-triangle) head.
    expect(countTriangles(output)).toBe(20);
    expect(result.entry?.triangles).toBe(20);
    expect(result.entry?.vertices).toBe(18);
    const extensions = (result.entry?.extensions as readonly string[] | undefined) ?? [];
    expect([...extensions]).toEqual(["EXT_meshopt_compression", "KHR_mesh_quantization"]);
  });

  it("should keep the bounding box within tolerance at default precision", async () => {
    const input = Buffer.from(await buildFixtureGlb());
    const result = await modelPass().apply(input, "character.glb");
    expect(Buffer.isBuffer(result)).toBe(false);
    if (!Buffer.isBuffer(result)) {
      // World-space bind-pose bounds, evaluated exactly as the pass's own self-verify
      // evaluates them (the GPU's reconstruction), source against output.
      const before = reachableStats(await readVerified(input));
      const after = reachableStats(await readVerified(result.buffer));
      const beforeBox = before.boundingBox;
      const afterBox = after.boundingBox;
      expect(beforeBox).toBeDefined();
      expect(afterBox).toBeDefined();
      if (beforeBox === undefined || afterBox === undefined) return;
      for (const axis of [0, 1, 2]) {
        expect(Math.abs((afterBox.min[axis] ?? 0) - (beforeBox.min[axis] ?? 0))).toBeLessThan(1e-3);
        expect(Math.abs((afterBox.max[axis] ?? 0) - (beforeBox.max[axis] ?? 0))).toBeLessThan(1e-3);
      }
    }
  });

  it("should throw naming bounding-box drift when positions quantize to 4 bits", async () => {
    const input = Buffer.from(await buildFixtureGlb());
    await expect(
      modelPass({ quantize: { normalBits: 16, positionBits: 4, uvBits: 12 } }).apply(
        input,
        "character.glb",
      ),
    ).rejects.toThrow(/TN_ASSETS_MODEL_DRIFT.*bounding box drifted/u);
  });

  it("should declare EXT_meshopt_compression and not Draco", async () => {
    const input = Buffer.from(await buildFixtureGlb());
    const result = await modelPass().apply(input, "character.glb");
    if (Buffer.isBuffer(result)) throw new Error("model pass returned an unchanged buffer");
    const output = await readVerified(result.buffer);
    const extensionsUsed = new Set(
      output.listExtensionsUsed().map((extension) => extension.extensionName),
    );
    expect(extensionsUsed.has("EXT_meshopt_compression")).toBe(true);
    expect(extensionsUsed.has("KHR_draco_mesh_compression")).toBe(false);

    // Control twin: switch meshopt off and the declaration disappears, so the assertion
    // above measures the pass rather than the fixture.
    const uncompressed = await modelPass({
      passes: { dedup: false, meshopt: false, prune: false, quantize: false, reorder: false },
    }).apply(Buffer.from(await buildFixtureGlb()), "character.glb");
    expect(Buffer.isBuffer(uncompressed)).toBe(true);
  });

  it("should leave the model byte-identical when every sub-pass is switched off", async () => {
    const input = Buffer.from(await buildFixtureGlb());
    const result = await modelPass({
      passes: { dedup: false, meshopt: false, prune: false, quantize: false, reorder: false },
    }).apply(input, "character.glb");
    expect(Buffer.isBuffer(result)).toBe(true);
    expect((result as Buffer).equals(input)).toBe(true);
  });

  it("should keep joint weights at source float32 precision on a skinned mesh", async () => {
    const input = Buffer.from(await buildFixtureGlb());
    const result = await modelPass().apply(input, "character.glb");
    if (Buffer.isBuffer(result)) throw new Error("model pass returned an unchanged buffer");
    const output = await readVerified(result.buffer);
    const weights = output
      .listMeshes()
      .flatMap((mesh) => mesh.listPrimitives())
      .map((primitive) => primitive.getAttribute("WEIGHTS_0"));
    expect(weights.length).toBeGreaterThan(0);
    for (const attribute of weights) {
      // FLOAT32, exactly as the generator declared — never narrowed by quantization.
      expect(attribute?.getComponentSize()).toBe(4);
    }
  });

  it("decodes normalized ushort joint weights by their own component type in reachableStats", async () => {
    // External exporters ship WEIGHTS_0 as normalized UNSIGNED_SHORT. reachableStats must
    // decode them /65535 like the GPU does; the hardcoded ubyte scale (/255) reads raw
    // integers ~257x heavy and reports a garbage bind-pose bounding box.
    const posed = (options: IFixtureOptions): Document => {
      const doc = buildFixtureDocument(options);
      // Pose the skeleton off its bind pose: at bind, joint matrices collapse to the rigid
      // fallback and every decoding evaluates identically, hiding a wrong scale.
      const torso = doc
        .getRoot()
        .listNodes()
        .find((node) => node.getName() === "torso");
      if (torso === undefined) throw new Error("Fixture lost its torso joint.");
      torso.setTranslation([0.25, 0.35, 0]);
      return doc;
    };
    const floatDoc = posed({ textured: false });
    const ushortDoc = posed({ textured: false });
    for (const mesh of ushortDoc.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        const weights = primitive.getAttribute("WEIGHTS_0");
        if (weights === null) continue;
        const source = weights.getArray();
        const quantized = new Uint16Array(source.length);
        for (let index = 0; index < source.length; index += 1)
          quantized[index] = Math.round((source[index] ?? 0) * 65535);
        const next = ushortDoc
          .createAccessor(`${weights.getName()}-ushort`)
          .setBuffer(weights.getBuffer())
          .setArray(quantized)
          .setType("VEC4")
          .setNormalized(true);
        primitive.setAttribute("WEIGHTS_0", next);
      }
    }

    const floatBox = reachableStats(floatDoc.getRoot()).boundingBox;
    const ushortBox = reachableStats(ushortDoc.getRoot()).boundingBox;
    expect(floatBox).toBeDefined();
    expect(ushortBox).toBeDefined();
    if (floatBox === undefined || ushortBox === undefined) return;
    for (const axis of [0, 1, 2]) {
      expect(Math.abs((ushortBox.min[axis] ?? 0) - (floatBox.min[axis] ?? 0))).toBeLessThan(1e-3);
      expect(Math.abs((ushortBox.max[axis] ?? 0) - (floatBox.max[axis] ?? 0))).toBeLessThan(1e-3);
    }
  });

  it("should reject a regression that narrows joint weights below source precision", async () => {
    const actual = await vi.importActual<typeof import("@gltf-transform/functions")>(
      "@gltf-transform/functions",
    );
    const input = Buffer.from(await buildFixtureGlb());
    // Simulate a future change that turns weight quantization on (the library's own
    // default): the floor must hold.
    vi.doMock("@gltf-transform/functions", () => ({
      ...actual,
      quantize: () => actual.quantize({ quantizeWeight: 8 }),
    }));
    try {
      vi.resetModules();
      const { modelPass: mockedModelPass } = await import("../src/passes/model.js");
      await expect(mockedModelPass().apply(input, "character.glb")).rejects.toThrow(
        /TN_ASSETS_MODEL_JOINT_QUANTIZED/u,
      );
    } finally {
      vi.doUnmock("@gltf-transform/functions");
    }
  });

  it("should throw naming lost geometry when prune drops a referenced primitive", async () => {
    const actual = await vi.importActual<typeof import("@gltf-transform/functions")>(
      "@gltf-transform/functions",
    );
    const input = Buffer.from(await buildFixtureGlb());
    // Simulate a buggy prune that eats referenced geometry: self-verify must catch it.
    vi.doMock("@gltf-transform/functions", () => ({
      ...actual,
      prune:
        () =>
        async (document: Document): Promise<void> => {
          await actual.prune()(document);
          const primitive = document.getRoot().listMeshes()[0]?.listPrimitives()[1];
          // dispose() detaches the primitive from its mesh — geometry the scene can no longer draw.
          primitive?.dispose();
        },
    }));
    try {
      vi.resetModules();
      const { modelPass: mockedModelPass } = await import("../src/passes/model.js");
      await expect(mockedModelPass().apply(input, "character.glb")).rejects.toThrow(
        /TN_ASSETS_MODEL_DRIFT.*triangles 20 -> 12/u,
      );
    } finally {
      vi.doUnmock("@gltf-transform/functions");
    }
  });

  it("should catch every drift kind through the exported comparison", async () => {
    const source = {
      boundingBox: { max: [1, 1, 1], min: [-1, -1, -1] },
      clips: 1,
      joints: 3,
      triangles: 14,
      vertices: 18,
    };
    expect(() => assertNoDrift(source, { ...source, triangles: 6 }, "x.glb")).toThrow(
      /triangles 14 -> 6/u,
    );
    expect(() => assertNoDrift(source, { ...source, vertices: 9 }, "x.glb")).toThrow(
      /vertices 18 -> 9/u,
    );
    expect(() => assertNoDrift(source, { ...source, joints: 0 }, "x.glb")).toThrow(
      /joints 3 -> 0/u,
    );
    expect(() => assertNoDrift(source, { ...source, clips: 0 }, "x.glb")).toThrow(
      /animation clips 1 -> 0/u,
    );
    expect(() =>
      assertNoDrift(
        source,
        { ...source, boundingBox: { max: [1, 1.5, 1], min: [-1, -1, -1] } },
        "x.glb",
      ),
    ).toThrow(/bounding box drifted/u);
    expect(() => assertNoDrift(source, { ...source, boundingBox: undefined }, "x.glb")).toThrow(
      /bounding box lost/u,
    );
  });

  it("should regenerate the committed fixture byte-for-byte (staleness guard)", async () => {
    const committed = await readFile(FIXTURE_PATH);
    expect(Buffer.from(await buildFixtureGlb()).equals(committed)).toBe(true);
  });
});
