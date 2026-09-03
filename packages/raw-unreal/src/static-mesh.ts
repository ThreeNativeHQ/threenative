import { type IBulkSourceModel, selectBulkSourceModel } from "./bulk-source-model.js";
// quality-allow: landed over the file-length threshold with the FAB extraction lane; split owed to that lane
import {
  decompressCompressedBuffer,
  findCompressedBufferOffsets,
  parseCompressedBuffer,
} from "./compressed-buffer.js";
import { UAssetError, assertUAsset } from "./errors.js";
import { type IGeometryBuild, assembleGeometry, computeBounds, convertVector } from "./geometry.js";
import {
  type IAttributeEntry,
  type IMeshDescription,
  findMeshDescriptionOffsets,
  parseMeshDescription,
} from "./mesh-description.js";
import { readPackageLayout, readPackageSummary } from "./package-summary.js";
import { buildGeometryFromRawMesh } from "./raw-mesh-geometry.js";
import { findRawMeshBlobs, parseRawMesh } from "./raw-mesh.js";
import type {
  IDecodedUAssetStaticMesh,
  IUAssetBulkDataInfo,
  IUAssetMetadata,
  IUAssetParseOptions,
  IUAssetSection,
  IUAssetSourceStats,
  IUAssetUnrealInfo,
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
  const entry = description.elements
    .get(elementName)
    ?.channels[0]?.attributeSet.attributes.get(attributeName);
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
  assertUAsset(
    channel !== undefined,
    "MISSING_MESH_ATTRIBUTE",
    `${entry.name} has no data channel`,
    {
      attribute: entry.name,
    },
  );
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
    throw new UAssetError(
      "INVALID_MESH_REFERENCE",
      "Attribute data ended before its declared element count",
      {
        elementId,
        extent,
        component,
      },
    );
  }
  return value;
}

/** Groups triangle corner indices by their polygon-group / section id, in section order. */
function groupTrianglesByInstance(inputs: {
  validTriangleIds: readonly number[];
  triangleExtent: number;
  triangleVertexInstances: Int32Array;
  instanceToOutput: Map<number, number>;
  triangleGroups: Int32Array | undefined;
  triangleGroupExtent: number;
  flipWinding: boolean;
}): Map<number, number[]> {
  const trianglesByGroup = new Map<number, number[]>();
  for (const triangleId of inputs.validTriangleIds) {
    const source = triangleId * inputs.triangleExtent;
    const corners: [number, number, number] = [0, 0, 0];
    for (let corner = 0; corner < 3; corner += 1) {
      const instanceId = inputs.triangleVertexInstances[source + corner];
      const outputIndex = inputs.instanceToOutput.get(instanceId ?? -1);
      if (outputIndex === undefined) {
        throw new UAssetError(
          "INVALID_MESH_REFERENCE",
          "Triangle references an invalid vertex instance",
          {
            triangleId,
            instanceId,
          },
        );
      }
      corners[corner] = outputIndex;
    }
    if (inputs.flipWinding) {
      const second = corners[1];
      corners[1] = corners[2];
      corners[2] = second;
    }

    const rawGroupId = inputs.triangleGroups
      ? componentAt(inputs.triangleGroups, triangleId, inputs.triangleGroupExtent, 0)
      : 0;
    const groupId = rawGroupId >= 0 ? rawGroupId : 0;
    const groupTriangles = trianglesByGroup.get(groupId) ?? [];
    groupTriangles.push(corners[0], corners[1], corners[2]);
    trianglesByGroup.set(groupId, groupTriangles);
  }
  return trianglesByGroup;
}

/** Expands MeshDescription vertices into render vertex instances — one output slot per valid
 * vertex instance, positioned through its vertex, with per-instance UVs and normals. */
function expandVertexInstances(inputs: {
  validInstanceIds: readonly number[];
  validVertexIds: ReadonlySet<number>;
  vertexIndices: Int32Array;
  vertexExtent: number;
  positionsByVertex: Float32Array;
  positionExtent: number;
  uvsByInstance: Float32Array;
  uvExtent: number;
  normalsByInstance: Float32Array | undefined;
  normalExtent: number;
  options: Required<Pick<IUAssetParseOptions, "convertCoordinates" | "flipWinding" | "flipV">>;
}): {
  positions: Float32Array;
  normals: Float32Array | undefined;
  uvs: Float32Array;
  instanceToOutput: Map<number, number>;
} {
  const instanceToOutput = new Map<number, number>();
  const positions = new Float32Array(inputs.validInstanceIds.length * 3);
  const uvs = new Float32Array(inputs.validInstanceIds.length * 2);
  const normals = inputs.normalsByInstance
    ? new Float32Array(inputs.validInstanceIds.length * 3)
    : undefined;

  for (let outputIndex = 0; outputIndex < inputs.validInstanceIds.length; outputIndex += 1) {
    const instanceId = inputs.validInstanceIds[outputIndex];
    if (instanceId === undefined) {
      throw new UAssetError("INVALID_MESH_REFERENCE", "Vertex instance allocation ended early", {
        outputIndex,
      });
    }
    instanceToOutput.set(instanceId, outputIndex);
    const vertexId = inputs.vertexIndices[instanceId * inputs.vertexExtent];
    if (typeof vertexId !== "number" || !inputs.validVertexIds.has(vertexId)) {
      throw new UAssetError(
        "INVALID_MESH_REFERENCE",
        "Vertex instance references an invalid vertex",
        {
          instanceId,
          vertexId,
        },
      );
    }

    const [x, y, z] = convertVector(
      componentAt(inputs.positionsByVertex, vertexId, inputs.positionExtent, 0),
      componentAt(inputs.positionsByVertex, vertexId, inputs.positionExtent, 1),
      componentAt(inputs.positionsByVertex, vertexId, inputs.positionExtent, 2),
      inputs.options.convertCoordinates,
    );
    positions[outputIndex * 3] = x;
    positions[outputIndex * 3 + 1] = y;
    positions[outputIndex * 3 + 2] = z;

    uvs[outputIndex * 2] = componentAt(inputs.uvsByInstance, instanceId, inputs.uvExtent, 0);
    const v = componentAt(inputs.uvsByInstance, instanceId, inputs.uvExtent, 1);
    uvs[outputIndex * 2 + 1] = inputs.options.flipV ? 1 - v : v;

    if (normals && inputs.normalsByInstance) {
      const [nx, ny, nz] = convertVector(
        componentAt(inputs.normalsByInstance, instanceId, inputs.normalExtent, 0),
        componentAt(inputs.normalsByInstance, instanceId, inputs.normalExtent, 1),
        componentAt(inputs.normalsByInstance, instanceId, inputs.normalExtent, 2),
        inputs.options.convertCoordinates,
      );
      normals[outputIndex * 3] = nx;
      normals[outputIndex * 3 + 1] = ny;
      normals[outputIndex * 3 + 2] = nz;
    }
  }

  return { positions, normals, uvs, instanceToOutput };
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
  const normalsByInstance = normalAttribute
    ? (channelValues(normalAttribute) as Float32Array)
    : undefined;
  const triangleVertexInstances = channelValues(triangleIndexAttribute) as Int32Array;
  const triangleGroups = triangleGroupAttribute
    ? (channelValues(triangleGroupAttribute) as Int32Array)
    : undefined;
  const materialSlotNames = materialSlotAttribute
    ? (channelValues(materialSlotAttribute) as string[])
    : undefined;

  const verticesChannel = vertices.channels[0];
  const instancesChannel = vertexInstances.channels[0];
  const trianglesChannel = triangles.channels[0];
  if (
    verticesChannel === undefined ||
    instancesChannel === undefined ||
    trianglesChannel === undefined
  ) {
    throw new UAssetError(
      "INVALID_MESH_DESCRIPTION",
      "MeshDescription element container has no channels",
    );
  }

  const validVertexIds = new Set(verticesChannel.allocation.validIds);
  const validInstanceIds = instancesChannel.allocation.validIds;
  assertUAsset(
    validVertexIds.size > 0 && validInstanceIds.length > 0,
    "UNSUPPORTED_STATIC_MESH_LAYOUT",
    "Static mesh contains no renderable vertices",
  );

  const expanded = expandVertexInstances({
    validInstanceIds,
    validVertexIds,
    vertexIndices,
    vertexExtent: vertexIndexAttribute.extent,
    positionsByVertex,
    positionExtent: positionAttribute.extent,
    uvsByInstance,
    uvExtent: uvAttribute.extent,
    normalsByInstance,
    normalExtent: normalAttribute?.extent ?? 1,
    options,
  });
  const instanceToOutput = expanded.instanceToOutput;

  const validTriangleIds = trianglesChannel.allocation.validIds;
  assertUAsset(
    validTriangleIds.length > 0,
    "UNSUPPORTED_STATIC_MESH_LAYOUT",
    "Static mesh contains no triangles",
  );

  const trianglesByGroup = groupTrianglesByInstance({
    validTriangleIds,
    triangleExtent: triangleIndexAttribute.extent,
    triangleVertexInstances,
    instanceToOutput,
    triangleGroups,
    triangleGroupExtent: triangleGroupAttribute?.extent ?? 1,
    flipWinding: options.flipWinding,
  });

  const slotNameStride = materialSlotAttribute?.extent ?? 1;
  return assembleGeometry(
    expanded.positions,
    expanded.normals,
    expanded.uvs,
    trianglesByGroup,
    (groupId) => materialSlotNames?.[groupId * slotNameStride] ?? String(groupId),
    {
      vertices: verticesChannel.allocation.validIds.length,
      vertexInstances: validInstanceIds.length,
      triangles: validTriangleIds.length,
    },
  );
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
        return {
          description,
          offset,
          build: buildGeometryFromMeshDescription(description, options),
        };
      }
    } catch (error) {
      // Candidate scans are speculative; only unexpected (programmer) failures may surface.
      if (!(error instanceof UAssetError)) throw error;
    }
  }
  return undefined;
}

/** One successfully decoded source-model payload, before the result object is assembled. */
interface IPayloadSelection {
  layout: UAssetMeshLayout;
  payload: {
    frame: "package" | "decompressed" | "bulk-data";
    offset: number;
    byteLength: number;
  };
  build: IGeometryBuild;
  compressedBuffer?: ReturnType<typeof parseCompressedBuffer>;
  bulkData?: IUAssetBulkDataInfo;
}

/** Probes one `FCompressedBuffer` candidate for a MeshDescription payload; a codec error is
 * reported to the caller rather than thrown, so a later candidate may still decode. */
function probeCompressedBuffer(
  buffer: ReturnType<typeof parseCompressedBuffer>,
  codecs: { oodle?: IUAssetParseOptions["oodle"]; lz4?: IUAssetParseOptions["lz4"] },
  options: Required<Pick<IUAssetParseOptions, "convertCoordinates" | "flipWinding" | "flipV">>,
): { selection?: IPayloadSelection; missingCodecError?: UAssetError } {
  try {
    const payload = decompressCompressedBuffer(buffer, codecs);
    const found = tryMeshDescriptionPayload(payload, options);
    if (found) {
      return {
        selection: {
          layout: "mesh-description",
          payload: {
            frame: "decompressed",
            offset: found.offset,
            byteLength: found.description.byteLength,
          },
          build: found.build,
          compressedBuffer: buffer,
        },
      };
    }
    return {};
  } catch (error) {
    if (!(error instanceof UAssetError)) throw error;
    return { missingCodecError: error.code === "MISSING_CODEC" ? error : undefined };
  }
}

/** UE5 path: probes each `FCompressedBuffer` candidate for a MeshDescription payload, keeping
 * the first codec error so an Oodle package without its codec reports that instead of "layout
 * unsupported". */
function selectCompressedMeshDescription(
  bytes: Uint8Array,
  codecs: { oodle?: IUAssetParseOptions["oodle"]; lz4?: IUAssetParseOptions["lz4"] },
  options: Required<Pick<IUAssetParseOptions, "convertCoordinates" | "flipWinding" | "flipV">>,
): { selection?: IPayloadSelection; missingCodecError?: UAssetError } {
  let missingCodecError: UAssetError | undefined;
  for (const offset of findCompressedBufferOffsets(bytes)) {
    let buffer: ReturnType<typeof parseCompressedBuffer> | undefined;
    try {
      buffer = parseCompressedBuffer(bytes, offset);
    } catch (error) {
      if (!(error instanceof UAssetError)) throw error;
      continue;
    }
    if (buffer === undefined) continue;
    const probed = probeCompressedBuffer(buffer, codecs, options);
    if (probed.selection) return probed;
    missingCodecError ??= probed.missingCodecError;
  }
  return { missingCodecError };
}

/** UE4.18 path: the first self-validating FRawMesh blob in file order is LOD0. */
function selectRawMesh(
  bytes: Uint8Array,
  options: Required<Pick<IUAssetParseOptions, "convertCoordinates" | "flipWinding" | "flipV">>,
): IPayloadSelection | undefined {
  const blob = findRawMeshBlobs(bytes)[0];
  if (blob === undefined) return undefined;
  return {
    layout: "raw-mesh",
    payload: { frame: "package", offset: blob.offset, byteLength: blob.byteLength },
    build: buildGeometryFromRawMesh(blob.mesh, options),
  };
}

/** The bulk-data path: an editor package that keeps its source model in `FByteBulkData` needs
 * the whole summary walked before any offset in it means anything, so a package whose summary
 * cannot be walked simply skips this probe rather than reading at a guessed anchor. */
function selectBulkData(
  bytes: Uint8Array,
  parseOptions: IUAssetParseOptions,
  options: Required<Pick<IUAssetParseOptions, "convertCoordinates" | "flipWinding" | "flipV">>,
): { selection?: IPayloadSelection; blockingError?: UAssetError } {
  const layout = readPackageLayout(bytes);
  if (layout === undefined) return {};
  const found = selectBulkSourceModel(bytes, layout, parseOptions, options);
  if (found.selection === undefined) {
    return found.blockingError === undefined ? {} : { blockingError: found.blockingError };
  }
  return { selection: toPayloadSelection(found.selection) };
}

function toPayloadSelection(model: IBulkSourceModel): IPayloadSelection {
  return {
    layout: model.layout,
    payload: { frame: "bulk-data", offset: 0, byteLength: model.payloadByteLength },
    build: model.build,
    bulkData: model.bulkData,
  };
}

/** Assembles the provenance block from the summary and the selected payload. */
function buildUnrealInfo(
  summary: ReturnType<typeof readPackageSummary>,
  selected: IPayloadSelection,
): IUAssetUnrealInfo {
  const compressedInfo = selected.compressedBuffer;
  return {
    packageTag: summary.packageTag,
    legacyFileVersion: summary.legacyFileVersion,
    ...(summary.fileVersionUE4 === undefined ? {} : { fileVersionUE4: summary.fileVersionUE4 }),
    ...(summary.fileVersionUE5 === undefined ? {} : { fileVersionUE5: summary.fileVersionUE5 }),
    ...(summary.licenseeVersion === undefined ? {} : { licenseeVersion: summary.licenseeVersion }),
    ...(summary.editorObjectVersion === undefined
      ? {}
      : { editorObjectVersion: summary.editorObjectVersion }),
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
    ...(selected.bulkData === undefined ? {} : { bulkData: selected.bulkData }),
  };
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

  const summary = readPackageSummary(bytes);
  const metadataScan = scanMetadata(bytes);

  // UE5 compressed payloads first, then an inline MeshDescription, then the FRawMesh layout.
  const compressed = selectCompressedMeshDescription(
    bytes,
    { oodle: options.oodle, lz4: options.lz4 },
    resolved,
  );
  let selected: IPayloadSelection | undefined = compressed.selection;
  if (selected === undefined) {
    const inlineFound = tryMeshDescriptionPayload(bytes, resolved);
    if (inlineFound) {
      selected = {
        layout: "mesh-description",
        payload: {
          frame: "package",
          offset: inlineFound.offset,
          byteLength: inlineFound.description.byteLength,
        },
        build: inlineFound.build,
      };
    }
  }
  let bulk: ReturnType<typeof selectBulkData> = {};
  if (selected === undefined) {
    bulk = selectBulkData(bytes, options, resolved);
    selected = bulk.selection;
  }
  selected ??= selectRawMesh(bytes, resolved);

  if (selected === undefined) {
    // A payload the caller can still reach — its codec or its sibling file is simply missing —
    // is reported as that, never as an unsupported layout: one is fixable, the other is not.
    if (bulk.blockingError) throw bulk.blockingError;
    if (compressed.missingCodecError) throw compressed.missingCodecError;
    throw new UAssetError(
      "UNSUPPORTED_STATIC_MESH_LAYOUT",
      "No supported static-mesh payload was found in this package",
      {
        fileVersionUE4: summary.fileVersionUE4,
        editorObjectVersion: summary.editorObjectVersion,
        // What was looked for, rather than a version range. A real UE4.27 pack reached here and
        // was told the parser covers "UE4.26–5.x editor static meshes with serialized
        // FMeshDescription data" — a claim that describes the file in front of it, so the only
        // conclusion left to the caller was that the asset is corrupt. Naming the three probes
        // that ran and matched nothing says the true thing: this is a coverage gap in the
        // payload forms, not a broken package.
        probed: "compressed-buffer, inline mesh-description, bulk-data, raw-mesh — none matched",
        supported:
          "UE4.26–5.x editor static meshes whose FMeshDescription is serialized inline or in a compressed buffer (UE5 compressed payloads need an `oodle` codec); UE4.2x editor packages whose FMeshDescription or FRawMesh source model is kept in FByteBulkData, inline, at the end of the package, or in a sibling .ubulk/.uptnl file whose bytes the caller supplies (zlib-compressed payloads need a `zlib` codec); and UE4.18-era packages with inline uncompressed FRawMesh source models. IoStore containers, PAK archives, cooked render buffers, Nanite clusters and skeletal meshes are not read.",
      },
    );
  }

  return {
    positions: selected.build.positions,
    normals: selected.build.normals,
    uvs: selected.build.uvs,
    indices: selected.build.indices,
    sections: selected.build.sections,
    bounds: computeBounds(selected.build.positions),
    metadata: {
      assetClass: "StaticMesh",
      engineVersion: metadataScan.engineVersion,
      objectPath: metadataScan.objectPath,
      packageByteLength: bytes.byteLength,
    },
    unreal: buildUnrealInfo(summary, selected),
    sourceStats: selected.build.sourceStats,
  };
}
