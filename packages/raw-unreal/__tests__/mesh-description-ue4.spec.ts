import { describe, expect, it } from "vitest";

import { type UAssetError, parseMeshDescriptionUe4, parseUAssetStaticMesh } from "../src/index.js";
import {
  BULK,
  Writer,
  bulkDataHeader,
  editorPackage,
  ue4MeshDescription,
} from "./fixture-builder.js";

/**
 * Two triangles sharing an edge, in the UE4.2x MeshDescription layout. The edge container is
 * deliberately holed — five slots, four allocated — because that is the case a real pack
 * exposes and a fully allocated one hides: elements are serialized once per **allocated** slot
 * while attribute arrays stay dense over every slot, so a reader that walks elements by slot
 * count runs four bytes long per hole and lands in the middle of the next container.
 */
const HOLED = {
  vertices: [
    [0, 0, 0],
    [10, 0, 0],
    [10, 10, 0],
    [0, 10, 0],
  ],
  instanceVertices: [0, 1, 2, 0, 2, 3],
  instanceUvs: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0],
    [1, 1],
    [0, 1],
  ],
  edgeSlots: 5,
  allocatedEdges: [0, 1, 3, 4],
  polygonGroups: [0, 1],
  triangles: [
    [0, 1, 2, 0],
    [3, 4, 5, 1],
  ],
} as const;

function bulkPackage(payload: Uint8Array): Uint8Array {
  return editorPackage({
    exportData: new Writer()
      .bytes(
        bulkDataHeader({
          flags: BULK.PAYLOAD_AT_END_OF_FILE,
          elementCount: payload.byteLength,
          sizeOnDisk: payload.byteLength,
          offsetInFile: 0,
        }),
      )
      .concat(),
    bulkRegion: payload,
  });
}

describe("parseMeshDescriptionUe4", () => {
  it("walks a container with holes, whose elements are written once per allocated slot", () => {
    const payload = ue4MeshDescription({ ...HOLED, vertices: [...HOLED.vertices] } as never);
    const description = parseMeshDescriptionUe4(payload);

    expect(description.byteLength).toBe(payload.byteLength);
    expect(description.vertexCount).toBe(4);
    expect(description.validTriangleIds).toEqual([0, 1]);
    expect([...description.triangleVertexInstances]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("skips a triangle slot the file never allocated", () => {
    const payload = ue4MeshDescription({
      ...HOLED,
      vertices: [...HOLED.vertices],
      triangleSlots: 3,
      allocatedTriangles: [0, 2],
    } as never);
    const description = parseMeshDescriptionUe4(payload);
    expect(description.validTriangleIds).toEqual([0, 2]);
  });

  it("rejects a payload the walk does not consume to its last byte", () => {
    const payload = ue4MeshDescription({ ...HOLED, vertices: [...HOLED.vertices] } as never);
    const padded = new Uint8Array(payload.byteLength + 4);
    padded.set(payload);
    try {
      parseMeshDescriptionUe4(padded);
      expect.unreachable("expected INVALID_MESH_DESCRIPTION");
    } catch (error) {
      expect((error as UAssetError).code).toBe("INVALID_MESH_DESCRIPTION");
    }
  });
});

describe("parseUAssetStaticMesh over a UE4 MeshDescription in bulk data", () => {
  it("builds one output vertex per allocated instance and sections by polygon group", () => {
    const decoded = parseUAssetStaticMesh(
      bulkPackage(ue4MeshDescription({ ...HOLED, vertices: [...HOLED.vertices] } as never)),
    );

    expect(decoded.unreal.layout).toBe("mesh-description-ue4");
    expect(decoded.sourceStats).toEqual({ vertices: 4, vertexInstances: 6, triangles: 2 });
    expect(decoded.sections.map((section) => section.materialName)).toEqual([
      "Material_0",
      "Material_1",
    ]);
    expect(decoded.indices.length).toBe(6);
    // Default winding flips corners 1 and 2: (0,1,2) and (3,4,5) become (0,2,1) and (3,5,4).
    expect([...decoded.indices]).toEqual([0, 2, 1, 3, 5, 4]);
  });
});
