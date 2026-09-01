import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  UAssetError,
  findRawMeshBlobs,
  parseRawMesh,
  parseUAssetStaticMesh,
  readPackageSummary,
} from "../src/index.js";
import { Writer, legacyPackage, rawMeshBlob } from "./fixture-builder.js";

// A wedge diamond: four vertices in Unreal coordinates (Z-up), six wedges, two faces in two
// sections. Face 0's wedges wind (v0, v1, v2) so its geometric normal matches +Z; face 1 winds
// (v0, v3, v1) for +Y.
const DIAMOND = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ] as const,
  wedgeIndices: [0, 1, 2, 0, 3, 1],
  wedgeNormals: [
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
  ] as const,
  uvs: [
    [0, 0],
    [1, 0],
    [0, 1],
    [0, 0],
    [1, 0],
    [0, 1],
  ] as const,
  faceMaterials: [0, 1],
};

describe("parseRawMesh", () => {
  it("parses a synthetic FRawMesh blob exactly and reports its arrays", () => {
    const blob = rawMeshBlob(DIAMOND);
    const parsed = parseRawMesh(blob);

    expect(parsed.byteLength).toBe(blob.byteLength);
    expect(parsed.mesh.vertexCount).toBe(4);
    expect(parsed.mesh.wedgeIndices).toEqual(Uint32Array.from(DIAMOND.wedgeIndices));
    expect(parsed.mesh.faceMaterialIndices).toEqual(Int32Array.from(DIAMOND.faceMaterials));
    expect(parsed.mesh.wedgeNormals?.length).toBe(18);
    expect(parsed.mesh.wedgeUvs.length).toBe(1);
    expect(parsed.mesh.wedgeUvs[0]?.length).toBe(12);
    expect(parsed.mesh.version).toBe(1);
  });

  it("stops at the blob's last array, leaving trailing package bytes unconsumed", () => {
    // A whole-file scan reads blobs out of a package, so "the parse consumed the blob exactly"
    // means the blob's own arrays, not the rest of the file: byteLength must exclude padding.
    const padded = rawMeshBlob({ ...DIAMOND, trailingBytes: 3 });
    const exact = rawMeshBlob(DIAMOND);
    const parsed = parseRawMesh(padded);
    expect(parsed.byteLength).toBe(exact.byteLength);
  });

  it("rejects a wedge index beyond the vertex count", () => {
    const blob = rawMeshBlob({
      ...DIAMOND,
      wedgeIndices: [0, 2, 1, 0, 1, 99],
    });
    try {
      parseRawMesh(blob);
      expect.unreachable("expected INVALID_RAW_MESH");
    } catch (error) {
      expect(error).toBeInstanceOf(UAssetError);
      expect((error as UAssetError).code).toBe("INVALID_RAW_MESH");
    }
  });

  it("rejects a wedge count that is not three per face", () => {
    const writer = new Writer();
    writer.int32(0).int32(0); // version, licensee version
    writer.int32(1); // one face material
    writer.int32(0);
    writer.int32(1); // one smoothing mask
    writer.int32(0);
    writer.int32(3); // three vertices
    for (let index = 0; index < 9; index += 1) writer.float32(index);
    writer.int32(4); // invalid: four wedges for one face
    writer.uint32(0).uint32(1).uint32(2).uint32(0);
    writer.int32(0).int32(0).int32(0); // tangents X/Y/N skipped via empty arrays
    for (let channel = 0; channel < 8; channel += 1) writer.int32(0);
    writer.int32(0); // colors

    try {
      parseRawMesh(writer.concat());
      expect.unreachable("expected INVALID_RAW_MESH");
    } catch (error) {
      expect(error).toBeInstanceOf(UAssetError);
      expect((error as UAssetError).code).toBe("INVALID_RAW_MESH");
    }
  });

  it("finds a blob embedded in noise and returns blobs in file order (LOD0 first)", () => {
    const lod0 = rawMeshBlob(DIAMOND);
    const lod1 = rawMeshBlob({
      ...DIAMOND,
      vertices: [
        [0, 0, 0],
        [2, 0, 0],
        [0, 2, 0],
        [0, 0, 2],
      ] as const,
    });
    const package_ = new Writer();
    package_.bytes(new Uint8Array(137));
    package_.bytes(lod0);
    package_.bytes(new Uint8Array(64));
    package_.bytes(lod1);

    const blobs = findRawMeshBlobs(package_.concat());
    expect(blobs.length).toBe(2);
    expect(blobs[0]?.offset).toBe(137);
    expect(blobs[1]?.offset).toBe(137 + lod0.byteLength + 64);
  });
});

/** Converts −0 to +0 so toEqual comparisons don't trip on the negated zero the coordinate
 * conversion produces for untouched axes. */
function values(array: Float32Array, start: number, length: number): number[] {
  return [...array.slice(start, start + length)].map((value) => (value === 0 ? 0 : value));
}

describe("parseUAssetStaticMesh over the FRawMesh layout", () => {
  it("decodes a synthetic v514 package: layout, winding, conversion, and sections", () => {
    const blob = rawMeshBlob(DIAMOND);
    const bytes = legacyPackage(blob, {
      nameTable: "/Game/Test/SM_Test",
    });

    const decoded = parseUAssetStaticMesh(bytes);
    expect(decoded.unreal.layout).toBe("raw-mesh");
    expect(decoded.unreal.fileVersionUE4).toBe(514);
    expect(decoded.unreal.editorObjectVersion).toBe(27);
    expect(decoded.unreal.payload).toEqual({
      frame: "package",
      offset: expect.any(Number),
      byteLength: blob.byteLength,
    });

    // Two sections from two face-material groups, draw ranges in index order.
    expect(decoded.sections).toEqual([
      { materialIndex: 0, sectionIndex: 0, materialName: "0", start: 0, count: 3 },
      { materialIndex: 1, sectionIndex: 1, materialName: "1", start: 3, count: 3 },
    ]);
    expect(decoded.sourceStats).toEqual({ vertices: 4, vertexInstances: 6, triangles: 2 });

    // Default options: (x, z, −y) conversion and flipped winding. Wedges expand one output
    // vertex each: w0→v0 (0,0,0)→(0,0,0); w1→v1 (1,0,0)→(1,0,−0); w2→v2 (0,1,0)→(0,0,−1).
    expect(values(decoded.positions, 0, 9)).toEqual([0, 0, 0, 1, 0, 0, 0, 0, -1]);
    // Default winding flips corners 1 and 2 of each face: (0,1,2),(0,3,1) → (0,2,1),(0,1,3).
    expect([...decoded.indices.slice(0, 6)]).toEqual([0, 2, 1, 0, 1, 3]);
    // w4→v3 is Unreal (0,0,1) → three (0,1,0).
    expect(values(decoded.positions, 12, 3)).toEqual([0, 1, 0]);
    expect(decoded.normals?.length).toBe(18);
    expect(decoded.uvs.length).toBe(12);
  });

  it("passes convertCoordinates: false and flipWinding: false straight through", () => {
    const blob = rawMeshBlob(DIAMOND);
    const bytes = legacyPackage(blob);
    const decoded = parseUAssetStaticMesh(bytes, {
      convertCoordinates: false,
      flipWinding: false,
    });
    // Without conversion, Unreal Z-up values arrive untouched: w2→v2 is (0, 1, 0).
    expect(values(decoded.positions, 6, 3)).toEqual([0, 1, 0]);
    // Without the flip, face 0 keeps the package's wedge order.
    expect([...decoded.indices.slice(0, 3)]).toEqual([0, 1, 2]);
  });

  it("scrapes engine version and object path metadata from the package prefix", () => {
    // The engine branch lives in the summary region; a /Game path in the name table.
    const blob = rawMeshBlob(DIAMOND);
    const branch = "++UE4+Release-4.18";
    const writer = new Writer();
    writer.fstring(branch);
    writer.bytes(blob);
    const bytes = legacyPackage(writer.concat(), { nameTable: "/Game/Pines/SM_pine01" });

    const decoded = parseUAssetStaticMesh(bytes);
    expect(decoded.metadata.engineVersion).toBe(branch);
    expect(decoded.metadata.objectPath).toBe("/Game/Pines/SM_pine01");
  });
});

// Real-data conformance: the licensed Landscape Pro pack is never committed, so this leg runs
// only when the pack exists on disk. Its expected numbers were measured from the file itself.
const PINE_PATH =
  "/home/joao/projects/threenative/sandbox/.fab-source/landscape-pro/Content/STF/Pack03-LandscapePro/Environment/Foliage/Pines/pine01/SM_pine01.uasset";

describe("real-pack conformance (skipped without the licensed pack)", () => {
  it.skipIf(!existsSync(PINE_PATH))("decodes SM_pine01.uasset's LOD0 FRawMesh blob", async () => {
    const bytes = new Uint8Array(await readFile(PINE_PATH));
    const summary = readPackageSummary(bytes);
    expect(summary.fileVersionUE4).toBe(514);
    expect(summary.editorObjectVersion).toBeLessThan(28);

    const decoded = parseUAssetStaticMesh(bytes);
    expect(decoded.unreal.layout).toBe("raw-mesh");
    expect(decoded.sourceStats).toEqual({
      vertices: 9_950,
      vertexInstances: 39_099,
      triangles: 13_033,
    });
    expect(decoded.sections.length).toBe(2);
    expect(decoded.normals?.length).toBe(39_099 * 3);
    expect(decoded.uvs.length).toBe(39_099 * 2);
    expect(decoded.positions.every(Number.isFinite)).toBe(true);
    // Verified LOD0 extents, converted to three.js Y-up (three Y = Unreal Z).
    expect(decoded.bounds.min[0]).toBeCloseTo(-267.9, 0);
    expect(decoded.bounds.max[1]).toBeCloseTo(992.6, 0);
    // Uint16 indices: 39,099 instances fit below the 65,535 threshold.
    expect(decoded.indices).toBeInstanceOf(Uint16Array);
    expect(decoded.indices.length).toBe(13_033 * 3);
  });
});
