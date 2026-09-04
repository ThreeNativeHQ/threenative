import { UAssetError, assertUAsset } from "./errors.js";
import { type IGeometryBuild, assembleGeometry, convertVector } from "./geometry.js";
import type { IRawMesh } from "./raw-mesh.js";
import type { IUAssetParseOptions } from "./types.js";

type GeometryOptions = Required<
  Pick<IUAssetParseOptions, "convertCoordinates" | "flipWinding" | "flipV">
>;

function rawFloat(values: Float32Array, index: number, what: string): number {
  const value = values[index];
  if (typeof value !== "number") {
    throw new UAssetError("INVALID_RAW_MESH", `${what} ended before its declared element count`, {
      index,
    });
  }
  return value;
}

function rawWedge(values: Uint32Array, index: number): number {
  const value = values[index];
  if (typeof value !== "number") {
    throw new UAssetError(
      "INVALID_RAW_MESH",
      "FRawMesh wedge table ended before its declared count",
      { index },
    );
  }
  return value;
}

function rawInt(values: Int32Array, index: number, what: string): number {
  const value = values[index];
  if (typeof value !== "number") {
    throw new UAssetError("INVALID_RAW_MESH", `${what} ended before its declared element count`, {
      index,
    });
  }
  return value;
}

/** Expands an FRawMesh into render vertices — one output slot per wedge, positioned through the
 * wedge's vertex, with that wedge's own normal and UV. */
export function buildGeometryFromRawMesh(mesh: IRawMesh, options: GeometryOptions): IGeometryBuild {
  const {
    vertexCount,
    vertexPositions,
    wedgeIndices,
    wedgeNormals,
    wedgeUvs,
    faceMaterialIndices,
  } = mesh;
  const wedgeCount = wedgeIndices.length;
  const uvSet = wedgeUvs[0];
  assertUAsset(uvSet !== undefined, "INVALID_RAW_MESH", "FRawMesh has no texture coordinates");

  const positions = new Float32Array(wedgeCount * 3);
  const normals = wedgeNormals ? new Float32Array(wedgeCount * 3) : undefined;
  const uvs = new Float32Array(wedgeCount * 2);

  for (let wedge = 0; wedge < wedgeCount; wedge += 1) {
    const vertexId = rawWedge(wedgeIndices, wedge);
    const [x, y, z] = convertVector(
      rawFloat(vertexPositions, vertexId * 3, "VertexPositions"),
      rawFloat(vertexPositions, vertexId * 3 + 1, "VertexPositions"),
      rawFloat(vertexPositions, vertexId * 3 + 2, "VertexPositions"),
      options.convertCoordinates,
    );
    positions[wedge * 3] = x;
    positions[wedge * 3 + 1] = y;
    positions[wedge * 3 + 2] = z;

    if (normals && wedgeNormals) {
      const [nx, ny, nz] = convertVector(
        rawFloat(wedgeNormals, wedge * 3, "WedgeTangentZ"),
        rawFloat(wedgeNormals, wedge * 3 + 1, "WedgeTangentZ"),
        rawFloat(wedgeNormals, wedge * 3 + 2, "WedgeTangentZ"),
        options.convertCoordinates,
      );
      normals[wedge * 3] = nx;
      normals[wedge * 3 + 1] = ny;
      normals[wedge * 3 + 2] = nz;
    }

    uvs[wedge * 2] = rawFloat(uvSet, wedge * 2, "WedgeTexCoords");
    const v = rawFloat(uvSet, wedge * 2 + 1, "WedgeTexCoords");
    uvs[wedge * 2 + 1] = options.flipV ? 1 - v : v;
  }

  const trianglesByGroup = new Map<number, number[]>();
  for (let face = 0; face < faceMaterialIndices.length; face += 1) {
    // Corners are wedge numbers: every per-wedge array above was expanded one slot per wedge,
    // so indexing by the vertex a wedge points at would address the wrong slot.
    const base = face * 3;
    const a = base;
    const b = options.flipWinding ? base + 2 : base + 1;
    const c = options.flipWinding ? base + 1 : base + 2;
    const materialIndex = rawInt(faceMaterialIndices, face, "FaceMaterialIndices");
    const group = materialIndex >= 0 ? materialIndex : 0;
    const groupTriangles = trianglesByGroup.get(group) ?? [];
    groupTriangles.push(a, b, c);
    trianglesByGroup.set(group, groupTriangles);
  }

  return assembleGeometry(positions, normals, uvs, trianglesByGroup, (group) => String(group), {
    vertices: vertexCount,
    vertexInstances: wedgeCount,
    triangles: faceMaterialIndices.length,
  });
}
