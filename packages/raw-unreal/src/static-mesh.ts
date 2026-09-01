import {
  decompressCompressedBuffer,
  findCompressedBufferOffsets,
  parseCompressedBuffer,
} from "./compressed-buffer.js";
import { UAssetError, assertUAsset } from "./errors.js";
import {
  findMeshDescriptionOffsets,
  parseMeshDescription,
  type IAttributeEntry,
  type IMeshDescription,
} from "./mesh-description.js";
import { findRawMeshBlobs, parseRawMesh, type IRawMesh } from "./raw-mesh.js";
import { readPackageSummary } from "./package-summary.js";
import type {
  IDecodedUAssetStaticMesh,
  IUAssetMetadata,
  IUAssetParseOptions,
  IUAssetUnrealInfo,
  IUAssetSection,
  IUAssetSourceStats,
  IUAssetBounds,
  UAssetMeshLayout,
} from "./types.js";

const latin1 = new TextDecoder("latin1");
/** Metadata is scraped from a bounded prefix — the summary and name table live there — never
 * from a full-file pass over a package that can be hundreds of megabytes. */
const METADATA_SCAN_BYTES = 262_144;

function asBytes(input: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError("Expected an ArrayBuffer or ArrayBufferView");
}

function scanMetadata(bytes: Uint8Array): { engineVersion: string; objectPath: string } {
  const text = latin1.decode(bytes.subarray(0, Math.min(bytes.byteLength, METADATA_SCAN_BYTES)));
  const branch = /\+\+UE[45]\+Release-[0-9.]+/.exec(text)?.[0] ?? "unknown";
  const gamePaths = [...text.matchAll(/\/Game\/[A-Za-z0-9_./-]+/g)].map((match) => match[0]);
  const objectPath =
    gamePaths.find((path) => /\/StaticMeshes\//.test(path)) ?? gamePaths[0] ?? "unknown";
  return { engineVersion: branch, objectPath };
}

function convertVector(
  x: number,
  y: number,
  z: number,
  convertCoordinates: boolean,
): [number, number, number] {
  return convertCoordinates ? [x, z, -y] : [x, y, z];
}

function computeBounds(positions: Float32Array): IUAssetBounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let component = 0; component < 3; component += 1) {
      min[component] = Math.min(min[component], positions[index + component]);
      max[component] = Math.max(max[component], positions[index + component]);
    }
  }
  return { min, max };
}

function attribute(
  description: IMeshDescription,
  elementName: string,
  attributeName: string,
  required: true,
): IAttributeEntry;
function attribute(
  description: IMeshDescription,
  elementName: string,
  attributeName: string,
  required: false,
): IAttributeEntry | undefined;
function attribute(
  description: IMeshDescription,
  elementName: string,
  attributeName: string,
  required: boolean,
): IAttributeEntry | undefined {
  const entry = description.elements.get(elementName)?.channels[0]?.attributeSet.attributes.get(attributeName);
  if (entry) return entry;
  if (required) {
    throw new UAssetError("MISSING_MESH_ATTRIBUTE", `MeshDescription is missing ${attributeName}`, {
      element: elementName,
      attribute: attributeName,
    });
  }
  return undefined;
}

function channelValues(entry: IAttributeEntry): Float32Array | Int32Array | Uint8Array | string[] {
  const channel = entry.channels[0];
  assertUAsset(channel !== undefined, "MISSING_MESH_ATTRIBUTE", `${entry.name} has no data channel`, {
    attribute: entry.name,
  });
  return channel.values;
}

function componentAt(
  values: Float32Array | Int32Array | Uint8Array,
  elementId: number,
  extent: number,
  component: number,
): number {
  const value = values[elementId * extent + component];
  if (typeof value !== "number") {
    throw new UAssetError("INVALID_MESH_REFERENCE", "Attribute data ended before its declared element count", {
      elementId,
      extent,
      component,
    });
  }
  return value;
}

function rawFloat(values: Float32Array, index: number, what: string): number {
  const value = values[index];
  if (typeof value !== "number") {
    throw new UAssetError("INVALID_RAW_MESH", `${what} ended before its declared element count`, { index });
  }
  return value;
}

function rawWedge(values: Uint32Array, index: number): number {
  const value = values[index];
  if (typeof value !== "number") {
    throw new UAssetError("INVALID_RAW_MESH", "FRawMesh wedge table ended before its declared count", { index });
  }
  return value;
}

function rawInt(values: Int32Array, index: number, what: string): number {
  const value = values[index];
  if (typeof value !== "number") {
    throw new UAssetError("INVALID_RAW_MESH", `${what} ended before its declared element count`, { index });
  }
  return value;
}

interface IGeometryBuild {
  positions: Float32Array;
  normals: Float32Array | undefined;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
  sections: IUAssetSection[];
  sourceStats: IUAssetSourceStats;
}

function buildGeometryFromMeshDescription(
  description: IMeshDescription,
  options: Required<Pick<IUAssetParseOptions, "convertCoordinates" | "flipWinding" | "flipV">>,
): IGeometryBuild {
  const vertices = description.elements.get("Vertices");
  const vertexInstances = description.elements.get("VertexInstances");
  const triangles = description.elements.get("Triangles");
  assertUAsset(
    vertices !== undefined && vertexInstances !== undefined && triangles !== undefined,
    "INVALID_MESH_DESCRIPTION",
    "MeshDescription lacks required static-mesh element containers",
    { available: [...description.elements.keys()] },
  );

  const positionAttribute = attribute(description, "Vertices", "Position", true);
  const vertexIndexAttribute = attribute(description, "VertexInstances", "VertexIndex", true);
  const uvAttribute = attribute(description, "VertexInstances", "TextureCoordinate", true);
  const normalAttribute = attribute(description, "VertexInstances", "Normal", false);
  const triangleIndexAttribute = attribute(description, "Triangles", "VertexInstanceIndex", true);
  const triangleGroupAttribute = attribute(description, "Triangles", "PolygonGroupIndex", false);
  const materialSlotAttribute = description.elements
    .get("PolygonGroups")
    ?.channels[0]?.attributeSet.attributes.get("ImportedMaterialSlotName");

  const positionsByVertex = channelValues(positionAttribute) as Float32Array;
  const vertexIndices = channelValues(vertexIndexAttribute) as Int32Array;
  const uvsByInstance = channelValues(uvAttribute) as Float32Array;
  const normalsByInstance = normalAttribute ? (channelValues(normalAttribute) as Float32Array) : undefined;
  const triangleVertexInstances = channelValues(triangleIndexAttribute) as Int32Array;
  const triangleGroups = triangleGroupAttribute ? (channelValues(triangleGroupAttribute) as Int32Array) : undefined;
  const materialSlotNames = materialSlotAttribute
    ? (channelValues(materialSlotAttribute) as string[])
    : undefined;

  const verticesChannel = vertices.channels[0];
  const instancesChannel = vertexInstances.channels[0];
  const trianglesChannel = triangles.channels[0];
  if (verticesChannel === undefined || instancesChannel === undefined || trianglesChannel === undefined) {
    throw new UAssetError("INVALID_MESH_DESCRIPTION", "MeshDescription element container has no channels");
  }

  const validVertexIds = new Set(verticesChannel.allocation.validIds);
  const validInstanceIds = instancesChannel.allocation.validIds;
  assertUAsset(
    validVertexIds.size > 0 && validInstanceIds.length > 0,
    "UNSUPPORTED_STATIC_MESH_LAYOUT",
    "Static mesh contains no renderable vertices",
  );
  const instanceToOutput = new Map<number, number>();
  const positions = new Float32Array(validInstanceIds.length * 3);
  const uvs = new Float32Array(validInstanceIds.length * 2);
  const normals = normalsByInstance ? new Float32Array(validInstanceIds.length * 3) : undefined;

  for (let outputIndex = 0; outputIndex < validInstanceIds.length; outputIndex += 1) {
    const instanceId = validInstanceIds[outputIndex];
    if (instanceId === undefined) {
      throw new UAssetError("INVALID_MESH_REFERENCE", "Vertex instance allocation ended early", { outputIndex });
    }
    instanceToOutput.set(instanceId, outputIndex);
    const vertexId = vertexIndices[instanceId * vertexIndexAttribute.extent];
    if (typeof vertexId !== "number" || !validVertexIds.has(vertexId)) {
      throw new UAssetError("INVALID_MESH_REFERENCE", "Vertex instance references an invalid vertex", {
        instanceId,
        vertexId,
      });
    }

    const [x, y, z] = convertVector(
      componentAt(positionsByVertex, vertexId, positionAttribute.extent, 0),
      componentAt(positionsByVertex, vertexId, positionAttribute.extent, 1),
      componentAt(positionsByVertex, vertexId, positionAttribute.extent, 2),
      options.convertCoordinates,
    );
    positions[outputIndex * 3] = x;
    positions[outputIndex * 3 + 1] = y;
    positions[outputIndex * 3 + 2] = z;

    uvs[outputIndex * 2] = componentAt(uvsByInstance, instanceId, uvAttribute.extent, 0);
    const v = componentAt(uvsByInstance, instanceId, uvAttribute.extent, 1);
    uvs[outputIndex * 2 + 1] = options.flipV ? 1 - v : v;

    if (normals && normalsByInstance && normalAttribute) {
      const [nx, ny, nz] = convertVector(
        componentAt(normalsByInstance, instanceId, normalAttribute.extent, 0),
        componentAt(normalsByInstance, instanceId, normalAttribute.extent, 1),
        componentAt(normalsByInstance, instanceId, normalAttribute.extent, 2),
        options.convertCoordinates,
      );
      normals[outputIndex * 3] = nx;
      normals[outputIndex * 3 + 1] = ny;
      normals[outputIndex * 3 + 2] = nz;
    }
  }

  const validTriangleIds = trianglesChannel.allocation.validIds;
  assertUAsset(validTriangleIds.length > 0, "UNSUPPORTED_STATIC_MESH_LAYOUT", "Static mesh contains no triangles");

  const triangleGroupExtent = triangleGroupAttribute?.extent ?? 1;
  const trianglesByGroup = new Map<number, number[]>();
  for (const triangleId of validTriangleIds) {
    const source = triangleId * triangleIndexAttribute.extent;
    const corners: [number, number, number] = [0, 0, 0];
    for (let corner = 0; corner < 3; corner += 1) {
      const instanceId = triangleVertexInstances[source + corner];
      const outputIndex = instanceToOutput.get(instanceId ?? -1);
      if (outputIndex === undefined) {
        throw new UAssetError("INVALID_MESH_REFERENCE", "Triangle references an invalid vertex instance", {
          triangleId,
          instanceId,
        });
      }
      corners[corner] = outputIndex;
    }
    if (options.flipWinding) {
      const second = corners[1];
      corners[1] = corners[2];
      corners[2] = second;
    }

    const rawGroupId = triangleGroups
      ? componentAt(triangleGroups, triangleId, triangleGroupExtent, 0)
      : 0;
    const groupId = rawGroupId >= 0 ? rawGroupId : 0;
    const groupTriangles = trianglesByGroup.get(groupId) ?? [];
    groupTriangles.push(corners[0], corners[1], corners[2]);
    trianglesByGroup.set(groupId, groupTriangles);
  }

  const slotNameStride = materialSlotAttribute?.extent ?? 1;
  return assembleGeometry(
    positions,
    normals,
    uvs,
    trianglesByGroup,
    (groupId) => materialSlotNames?.[groupId * slotNameStride] ?? String(groupId),
    {
      vertices: verticesChannel.allocation.validIds.length,
      vertexInstances: validInstanceIds.length,
      triangles: validTriangleIds.length,
    },
  );
}

function buildGeometryFromRawMesh(
  mesh: IRawMesh,
  options: Required<Pick<IUAssetParseOptions, "convertCoordinates" | "flipWinding" | "flipV">>,
): IGeometryBuild {
  const { vertexCount, vertexPositions, wedgeIndices, wedgeNormals, wedgeUvs, faceMaterialIndices } = mesh;
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
    const base = face * 3;
    const a = rawWedge(wedgeIndices, base);
    const b = rawWedge(wedgeIndices, options.flipWinding ? base + 2 : base + 1);
    const c = rawWedge(wedgeIndices, options.flipWinding ? base + 1 : base + 2);
    const materialIndex = rawInt(faceMaterialIndices, face, "FaceMaterialIndices");
    const group = materialIndex >= 0 ? materialIndex : 0;
    const groupTriangles = trianglesByGroup.get(group) ?? [];
    groupTriangles.push(a, b, c);
    trianglesByGroup.set(group, groupTriangles);
  }

  return assembleGeometry(
    positions,
    normals,
    uvs,
    trianglesByGroup,
    (group) => String(group),
    {
      vertices: vertexCount,
      vertexInstances: wedgeCount,
      triangles: faceMaterialIndices.length,
    },
  );
}

function assembleGeometry(
  positions: Float32Array,
  normals: Float32Array | undefined,
  uvs: Float32Array,
  trianglesByGroup: Map<number, number[]>,
  materialNameFor: (group: number) => string,
  sourceStats: IUAssetSourceStats,
): IGeometryBuild {
  const indexCount = [...trianglesByGroup.values()].reduce((sum, group) => sum + group.length, 0);
  const indices =
    positions.length / 3 > 65_535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);

  const sections: IUAssetSection[] = [];
  let cursor = 0;
  for (const [group, groupIndices] of trianglesByGroup) {
    indices.set(groupIndices, cursor);
    sections.push({
      materialIndex: sections.length,
      sectionIndex: group,
      materialName: materialNameFor(group),
      start: cursor,
      count: groupIndices.length,
    });
    cursor += groupIndices.length;
  }

  return { positions, normals, uvs, indices, sections, sourceStats };
}

function tryMeshDescriptionPayload(
  payload: Uint8Array,
  options: Required<Pick<IUAssetParseOptions, "convertCoordinates" | "flipWinding" | "flipV">>,
): { description: IMeshDescription; offset: number; build: IGeometryBuild } | undefined {
  for (const offset of findMeshDescriptionOffsets(payload)) {
    try {
      const description = parseMeshDescription(payload, offset);
      if (
        description.elements.has("Vertices") &&
        description.elements.has("VertexInstances") &&
        description.elements.has("Triangles")
      ) {
        return { description, offset, build: buildGeometryFromMeshDescription(description, options) };
      }
    } catch (error) {
      // Candidate scans are speculative; only unexpected (programmer) failures may surface.
      if (!(error instanceof UAssetError)) throw error;
    }
  }
  return undefined;
}

/** Parses a raw Unreal editor `.uasset` into validated, plain static-mesh data — no interchange
 * conversion, no Three.js objects, no fallback geometry invented for unsupported layouts. */
export function parseUAssetStaticMesh(
  input: ArrayBuffer | ArrayBufferView,
  options: IUAssetParseOptions = {},
): IDecodedUAssetStaticMesh {
  const bytes = asBytes(input);
  const resolved = {
    convertCoordinates: options.convertCoordinates ?? true,
    flipWinding: options.flipWinding ?? true,
    flipV: options.flipV ?? false,
  };
  const codecs = { oodle: options.oodle, lz4: options.lz4 };

  const summary = readPackageSummary(bytes);
  const metadataScan = scanMetadata(bytes);

  let selected:
    | {
        layout: UAssetMeshLayout;
        payload: { frame: "package" | "decompressed"; offset: number; byteLength: number };
        build: IGeometryBuild;
        compressedBuffer?: ReturnType<typeof parseCompressedBuffer>;
      }
    | undefined;
  let missingCodecError: UAssetError | undefined;

  // UE5 path: FCompressedBuffer payloads near the package trailer, Oodle- or LZ4-compressed.
  for (const offset of findCompressedBufferOffsets(bytes)) {
    let buffer;
    try {
      buffer = parseCompressedBuffer(bytes, offset);
    } catch (error) {
      if (!(error instanceof UAssetError)) throw error;
      continue;
    }
    try {
      const payload = decompressCompressedBuffer(buffer, codecs);
      const found = tryMeshDescriptionPayload(payload, resolved);
      if (found) {
        selected = {
          layout: "mesh-description",
          payload: { frame: "decompressed", offset: found.offset, byteLength: found.description.byteLength },
          build: found.build,
          compressedBuffer: buffer,
        };
        break;
      }
    } catch (error) {
      if (!(error instanceof UAssetError)) throw error;
      if (error.code === "MISSING_CODEC") missingCodecError ??= error;
    }
  }

  // Inline (uncompressed) MeshDescription, then the UE4.18 FRawMesh layout.
  if (!selected) {
    const inline = tryMeshDescriptionPayload(bytes, resolved);
    if (inline) {
      selected = {
        layout: "mesh-description",
        payload: { frame: "package", offset: inline.offset, byteLength: inline.description.byteLength },
        build: inline.build,
      };
    }
  }
  if (!selected) {
    const blobs = findRawMeshBlobs(bytes);
    const blob = blobs[0];
    if (blob !== undefined) {
      // Serialized order is LOD order; the first blob is LOD0.
      selected = {
        layout: "raw-mesh",
        payload: { frame: "package", offset: blob.offset, byteLength: blob.byteLength },
        build: buildGeometryFromRawMesh(blob.mesh, resolved),
      };
    }
  }

  if (!selected) {
    if (missingCodecError) throw missingCodecError;
    throw new UAssetError("UNSUPPORTED_STATIC_MESH_LAYOUT", "No supported static-mesh payload was found in this package", {
      fileVersionUE4: summary.fileVersionUE4,
      editorObjectVersion: summary.editorObjectVersion,
      supported:
        "UE4.26–5.x editor static meshes with serialized FMeshDescription data (UE5 compressed-buffer payloads need an `oodle` codec), and UE4.18-era packages with inline uncompressed FRawMesh source models",
    });
  }

  const compressedInfo = selected.compressedBuffer;
  const unreal: IUAssetUnrealInfo = {
    packageTag: summary.packageTag,
    legacyFileVersion: summary.legacyFileVersion,
    ...(summary.fileVersionUE4 === undefined ? {} : { fileVersionUE4: summary.fileVersionUE4 }),
    ...(summary.fileVersionUE5 === undefined ? {} : { fileVersionUE5: summary.fileVersionUE5 }),
    ...(summary.licenseeVersion === undefined ? {} : { licenseeVersion: summary.licenseeVersion }),
    ...(summary.editorObjectVersion === undefined ? {} : { editorObjectVersion: summary.editorObjectVersion }),
    layout: selected.layout,
    payload: selected.payload,
    ...(compressedInfo === undefined
      ? {}
      : {
          compressedBuffer: {
            offset: compressedInfo.offset,
            method: compressedInfo.method,
            compressor: compressedInfo.compressor,
            compressionLevel: compressedInfo.compressionLevel,
            rawSize: compressedInfo.totalRawSize,
            compressedSize: compressedInfo.totalCompressedSize,
            blockCount: compressedInfo.blockCount,
          },
        }),
  };

  const metadata: IUAssetMetadata = {
    assetClass: "StaticMesh",
    engineVersion: metadataScan.engineVersion,
    objectPath: metadataScan.objectPath,
    packageByteLength: bytes.byteLength,
  };

  return {
    positions: selected.build.positions,
    normals: selected.build.normals,
    uvs: selected.build.uvs,
    indices: selected.build.indices,
    sections: selected.build.sections,
    bounds: computeBounds(selected.build.positions),
    metadata,
    unreal,
    sourceStats: selected.build.sourceStats,
  };
}
