import { BinaryReader } from "./binary.js";
import { UAssetError, assertUAsset } from "./errors.js";
import {
  type IUe4AttributeEntry,
  type Ue4AttributeSet,
  readAttributeSet,
} from "./mesh-attributes-ue4.js";

export type { IUe4AttributeEntry, Ue4AttributeSet };

/**
 * The UE4.2x serialization of `FMeshDescription`, which is not the UE5 one in
 * `mesh-description.ts`. Three things differ, and all of them matter:
 *
 *  - The element containers are a **fixed sequence** with no names — vertices, vertex instances,
 *    edges, polygons, polygon groups — each an allocation bit array followed by that element
 *    type's own fields, rather than a named element-type table.
 *  - The **triangles trail the attribute sets**. `MeshDescriptionTriangles` appended the
 *    triangle container and its attribute set after the five attribute sets that were already
 *    being written, so a reader that stops at the last attribute set never sees a corner index.
 *  - A container's **elements are written once per allocated slot**, while its attribute arrays
 *    stay dense over every slot. A mesh whose containers have no holes hides this completely —
 *    the two counts coincide — and a reader that strides by slot count then runs long by one
 *    element per hole and lands inside the next container. Seven Office Pack meshes carry a
 *    holed edge container; the other 134 do not.
 *
 * The attribute entries themselves are read by `mesh-attributes-ue4.ts`.
 */

const MAX_MESH_ELEMENTS = 10_000_000;

export interface IUe4MeshDescription {
  byteLength: number;
  /** Allocated vertices; `vertexSlots` is how many ids the container spans. */
  vertexCount: number;
  vertexSlots: number;
  validVertexIds: readonly number[];
  /** Vertex-instance ids the file allocated, ascending. */
  validVertexInstanceIds: readonly number[];
  /** Vertex index of each vertex-instance **slot**; unallocated slots hold −1. */
  vertexInstanceVertices: Int32Array;
  /** Polygon-group index of each polygon **slot**; unallocated slots hold −1. */
  polygonGroups: Int32Array;
  polygonGroupCount: number;
  /** Triangle ids the file allocated, ascending. */
  validTriangleIds: readonly number[];
  /** Three vertex-instance indices per triangle **slot**. */
  triangleVertexInstances: Int32Array;
  /** Polygon index of each triangle **slot**. */
  trianglePolygons: Int32Array;
  vertexAttributes: Ue4AttributeSet;
  vertexInstanceAttributes: Ue4AttributeSet;
  polygonGroupAttributes: Ue4AttributeSet;
}

function meshError(message: string, details: Record<string, unknown>): UAssetError {
  return new UAssetError("INVALID_MESH_DESCRIPTION", message, details);
}

interface IContainerAllocation {
  /** How many element ids the container spans, holes included. */
  numBits: number;
  /** The ids that carry an element, ascending. One element is serialized for each. */
  validIds: number[];
}

/** An allocation `TBitArray`: a bit count then its words. The set bits are the element ids that
 * exist, and their count — not the bit count — is how many elements follow. */
function readBitArray(reader: BinaryReader, what: string): IContainerAllocation {
  const offset = reader.pos;
  const numBits = reader.int32(`${what} TBitArray NumBits`);
  if (numBits < 0 || numBits > MAX_MESH_ELEMENTS) {
    throw meshError(`Invalid ${what} allocation length`, { offset, numBits });
  }
  const wordCount = Math.ceil(numBits / 32);
  const words = new Uint32Array(wordCount);
  for (let index = 0; index < wordCount; index += 1) {
    words[index] = reader.uint32(`${what} TBitArray word`);
  }
  const validIds: number[] = [];
  for (let id = 0; id < numBits; id += 1) {
    const word = words[id >>> 5];
    if (word !== undefined && (word & (1 << (id & 31))) !== 0) validIds.push(id);
  }
  return { numBits, validIds };
}

function readInt32Array(reader: BinaryReader, count: number, what: string): Int32Array {
  const values = new Int32Array(count);
  for (let index = 0; index < count; index += 1) values[index] = reader.int32(what);
  return values;
}

/**
 * Parses one UE4.2x `FMeshDescription` payload, validating that the walk consumes it exactly and
 * that every index lands inside the container it references. Throws `UAssetError`
 * "INVALID_MESH_DESCRIPTION" when anything disagrees; nothing is inferred.
 */
export function parseMeshDescriptionUe4(input: Uint8Array, offset = 0): IUe4MeshDescription {
  const reader = new BinaryReader(input, offset);

  const vertices = readBitArray(reader, "VertexArray");
  const vertexInstances = readBitArray(reader, "VertexInstanceArray");
  const vertexInstanceVertices = new Int32Array(vertexInstances.numBits).fill(-1);
  for (const instanceId of vertexInstances.validIds) {
    vertexInstanceVertices[instanceId] = reader.int32("FMeshVertexInstance.VertexID");
  }
  const edges = readBitArray(reader, "EdgeArray");
  reader.skip(edges.validIds.length * 8, "FMeshEdge.VertexIDs");

  const polygons = readBitArray(reader, "PolygonArray");
  const polygonGroups = new Int32Array(polygons.numBits).fill(-1);
  for (const polygonId of polygons.validIds) {
    // A polygon's triangulation is rebuilt on load, so the array is written empty; reading it as
    // an array rather than skipping four bytes keeps a non-empty one from silently derailing.
    const triangleCount = reader.int32("FMeshPolygon.TriangleIDs count");
    if (triangleCount < 0 || triangleCount > MAX_MESH_ELEMENTS) {
      throw meshError("Invalid polygon triangulation count", { polygonId, triangleCount });
    }
    reader.skip(triangleCount * 4, "FMeshPolygon.TriangleIDs");
    polygonGroups[polygonId] = reader.int32("FMeshPolygon.PolygonGroupID");
  }
  const polygonGroupArray = readBitArray(reader, "PolygonGroupArray");

  // Attribute arrays are dense over slots even where the container is holed, so they are sized
  // by the bit count while the elements above were sized by the allocated count.
  const vertexAttributes = readAttributeSet(reader, "Vertex", vertices.numBits);
  const vertexInstanceAttributes = readAttributeSet(
    reader,
    "VertexInstance",
    vertexInstances.numBits,
  );
  readAttributeSet(reader, "Edge", edges.numBits);
  readAttributeSet(reader, "Polygon", polygons.numBits);
  const polygonGroupAttributes = readAttributeSet(
    reader,
    "PolygonGroup",
    polygonGroupArray.numBits,
  );

  // The triangle container and its attribute set trail the five attribute sets above.
  const triangles = readBitArray(reader, "TriangleArray");
  const triangleVertexInstances = new Int32Array(triangles.numBits * 3).fill(-1);
  const trianglePolygons = new Int32Array(triangles.numBits).fill(-1);
  for (const triangleId of triangles.validIds) {
    for (let corner = 0; corner < 3; corner += 1) {
      triangleVertexInstances[triangleId * 3 + corner] = reader.int32(
        "FMeshTriangle.VertexInstanceIDs",
      );
    }
    trianglePolygons[triangleId] = reader.int32("FMeshTriangle.PolygonID");
  }
  readAttributeSet(reader, "Triangle", triangles.numBits);

  validateReferences({
    vertices,
    vertexInstances,
    polygons,
    polygonGroupCount: polygonGroupArray.numBits,
    triangles,
    vertexInstanceVertices,
    polygonGroups,
    triangleVertexInstances,
    trianglePolygons,
  });

  // The walk must land on the payload's last byte. A short walk means a layout variant this
  // reader does not model, and geometry read from a mis-walked payload would be plausible junk.
  assertUAsset(
    reader.remaining === 0,
    "INVALID_MESH_DESCRIPTION",
    "UE4 MeshDescription walk did not consume its payload exactly",
    { consumed: reader.pos, byteLength: reader.byteLength, trailing: reader.remaining },
  );

  return {
    byteLength: reader.pos,
    vertexCount: vertices.validIds.length,
    vertexSlots: vertices.numBits,
    validVertexIds: vertices.validIds,
    validVertexInstanceIds: vertexInstances.validIds,
    vertexInstanceVertices,
    polygonGroups,
    polygonGroupCount: polygonGroupArray.numBits,
    validTriangleIds: triangles.validIds,
    triangleVertexInstances,
    trianglePolygons,
    vertexAttributes,
    vertexInstanceAttributes,
    polygonGroupAttributes,
  };
}

/** Every index a triangle, vertex instance or polygon carries must name an **allocated** id in
 * the container it points at. A payload that fails this walked cleanly and still describes
 * geometry that cannot be drawn, which is the failure worth catching before any array is built. */
function validateReferences(inputs: {
  vertices: IContainerAllocation;
  vertexInstances: IContainerAllocation;
  polygons: IContainerAllocation;
  polygonGroupCount: number;
  triangles: IContainerAllocation;
  vertexInstanceVertices: Int32Array;
  polygonGroups: Int32Array;
  triangleVertexInstances: Int32Array;
  trianglePolygons: Int32Array;
}): void {
  assertUAsset(
    inputs.vertices.validIds.length > 0 &&
      inputs.vertexInstances.validIds.length > 0 &&
      inputs.triangles.validIds.length > 0,
    "INVALID_MESH_DESCRIPTION",
    "UE4 MeshDescription contains no renderable geometry",
    {
      vertices: inputs.vertices.validIds.length,
      vertexInstances: inputs.vertexInstances.validIds.length,
      triangles: inputs.triangles.validIds.length,
    },
  );

  const allocatedVertices = new Set(inputs.vertices.validIds);
  const allocatedInstances = new Set(inputs.vertexInstances.validIds);
  const allocatedPolygons = new Set(inputs.polygons.validIds);

  for (const instanceId of inputs.vertexInstances.validIds) {
    const vertexId = inputs.vertexInstanceVertices[instanceId];
    if (vertexId === undefined || !allocatedVertices.has(vertexId)) {
      throw meshError("Vertex instance references a vertex the file did not allocate", {
        instanceId,
        vertexId,
      });
    }
  }
  for (const polygonId of inputs.polygons.validIds) {
    const groupId = inputs.polygonGroups[polygonId];
    if (groupId === undefined || groupId < 0 || groupId >= inputs.polygonGroupCount) {
      throw meshError("Polygon references an invalid polygon group", {
        polygonId,
        groupId,
        polygonGroupCount: inputs.polygonGroupCount,
      });
    }
  }
  for (const triangleId of inputs.triangles.validIds) {
    for (let corner = 0; corner < 3; corner += 1) {
      const instanceId = inputs.triangleVertexInstances[triangleId * 3 + corner];
      if (instanceId === undefined || !allocatedInstances.has(instanceId)) {
        throw meshError("Triangle references a vertex instance the file did not allocate", {
          triangleId,
          corner,
          instanceId,
        });
      }
    }
    const polygonId = inputs.trianglePolygons[triangleId];
    if (polygonId === undefined || !allocatedPolygons.has(polygonId)) {
      throw meshError("Triangle references a polygon the file did not allocate", {
        triangleId,
        polygonId,
      });
    }
  }
}

/** The serialized signature of a UE4 MeshDescription payload: a vertex allocation bit array
 * followed by a second one whose own bit count starts exactly where the first one ends. Strong
 * enough to gate a full parse attempt, not strong enough to trust alone — the parse decides. */
export function looksLikeMeshDescriptionUe4(bytes: Uint8Array, offset = 0): boolean {
  if (offset < 0 || offset + 12 > bytes.byteLength) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vertexBits = view.getInt32(offset, true);
  if (vertexBits <= 0 || vertexBits > MAX_MESH_ELEMENTS) return false;
  const instanceOffset = offset + 4 + Math.ceil(vertexBits / 32) * 4;
  if (instanceOffset + 4 > bytes.byteLength) return false;
  const instanceBits = view.getInt32(instanceOffset, true);
  return instanceBits >= vertexBits && instanceBits <= MAX_MESH_ELEMENTS;
}
