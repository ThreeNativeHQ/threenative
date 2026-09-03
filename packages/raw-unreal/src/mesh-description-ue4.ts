import { BinaryReader } from "./binary.js";
import { UAssetError, assertUAsset } from "./errors.js";

/**
 * The UE4.2x serialization of `FMeshDescription`, which is not the UE5 one in
 * `mesh-description.ts`. Two things differ, and both matter:
 *
 *  - The element containers are a **fixed sequence** with no names — vertices, vertex instances,
 *    edges, polygons, polygon groups — each an allocation bit array followed by that element
 *    type's own fields, rather than a named element-type table.
 *  - The **triangles trail the attribute sets**. `MeshDescriptionTriangles` appended the
 *    triangle container and its attribute set after the five attribute sets that were already
 *    being written, so a reader that stops at the last attribute set never sees a corner index.
 *
 * Attribute entries are also one field shorter: UE5's per-attribute and per-channel `extent`
 * does not exist here, so an entry is name, type, element count, channel count, channels.
 */

const MAX_MESH_ELEMENTS = 10_000_000;
const MAX_ATTRIBUTE_VALUES = 100_000_000;

interface IAttributeType {
  readonly name: string;
  readonly components: number;
  readonly byteSize: number | undefined;
  readonly kind: "float" | "int" | "bool" | "name";
}

const ATTRIBUTE_TYPES: readonly IAttributeType[] = Object.freeze([
  { name: "FVector4f", components: 4, byteSize: 16, kind: "float" },
  { name: "FVector3f", components: 3, byteSize: 12, kind: "float" },
  { name: "FVector2f", components: 2, byteSize: 8, kind: "float" },
  { name: "float", components: 1, byteSize: 4, kind: "float" },
  { name: "int32", components: 1, byteSize: 4, kind: "int" },
  { name: "bool", components: 1, byteSize: 1, kind: "bool" },
  { name: "FName", components: 1, byteSize: undefined, kind: "name" },
]);

export interface IUe4AttributeEntry {
  name: string;
  type: string;
  components: number;
  numElements: number;
  values: Float32Array | Int32Array | Uint8Array | string[];
}

export type Ue4AttributeSet = Map<string, IUe4AttributeEntry>;

export interface IUe4MeshDescription {
  byteLength: number;
  vertexCount: number;
  /** Vertex index of each vertex instance. */
  vertexInstanceVertices: Int32Array;
  /** Polygon-group index of each polygon. */
  polygonGroups: Int32Array;
  polygonGroupCount: number;
  /** Three vertex-instance indices per triangle, in file order. */
  triangleVertexInstances: Int32Array;
  /** Polygon index of each triangle. */
  trianglePolygons: Int32Array;
  vertexAttributes: Ue4AttributeSet;
  vertexInstanceAttributes: Ue4AttributeSet;
  polygonGroupAttributes: Ue4AttributeSet;
}

function meshError(message: string, details: Record<string, unknown>): UAssetError {
  return new UAssetError("INVALID_MESH_DESCRIPTION", message, details);
}

/** An allocation `TBitArray`: a bit count then its words. Every container in a saved static
 * mesh is fully allocated, but holes are read rather than assumed. */
function readBitArray(reader: BinaryReader, what: string): { numBits: number; allocated: number } {
  const offset = reader.pos;
  const numBits = reader.int32(`${what} TBitArray NumBits`);
  if (numBits < 0 || numBits > MAX_MESH_ELEMENTS) {
    throw meshError(`Invalid ${what} allocation length`, { offset, numBits });
  }
  const wordCount = Math.ceil(numBits / 32);
  let allocated = 0;
  for (let index = 0; index < wordCount; index += 1) {
    const word = reader.uint32(`${what} TBitArray word`);
    const remaining = numBits - index * 32;
    const mask = remaining >= 32 ? 0xffff_ffff : (1 << remaining) - 1;
    allocated += popCount(word & mask);
  }
  return { numBits, allocated };
}

function popCount(value: number): number {
  let bits = value - ((value >>> 1) & 0x5555_5555);
  bits = (bits & 0x3333_3333) + ((bits >>> 2) & 0x3333_3333);
  return (((bits + (bits >>> 4)) & 0x0f0f_0f0f) * 0x0101_0101) >>> 24;
}

function readInt32Array(reader: BinaryReader, count: number, what: string): Int32Array {
  const values = new Int32Array(count);
  for (let index = 0; index < count; index += 1) values[index] = reader.int32(what);
  return values;
}

function readAttributeEntry(reader: BinaryReader, rawName: string): IUe4AttributeEntry {
  const name = rawName.trimEnd();
  const typeIndex = reader.uint32(`${name} type`);
  const type = ATTRIBUTE_TYPES[typeIndex];
  assertUAsset(type !== undefined, "INVALID_MESH_DESCRIPTION", "Unknown attribute type", {
    attribute: name,
    typeIndex,
  });
  const numElements = reader.int32(`${name} element count`);
  const numChannels = reader.int32(`${name} channel count`);
  if (numElements < 0 || numElements > MAX_MESH_ELEMENTS || numChannels < 0 || numChannels > 128) {
    throw meshError(`Invalid attribute shape for ${name}`, { name, numElements, numChannels });
  }

  let values: IUe4AttributeEntry["values"] = new Float32Array(0);
  for (let channel = 0; channel < numChannels; channel += 1) {
    const channelValues = readAttributeChannel(reader, type, name, numElements);
    // Only channel 0 is kept: the static-mesh attributes this reader consumes are all
    // single-channel, and a later channel would need an `extent` this format does not have.
    if (channel === 0) values = channelValues;
  }

  readDefaultValue(reader, type);
  reader.uint32(`${name} flags`);
  return { name, type: type.name, components: type.components, numElements, values };
}

function readAttributeChannel(
  reader: BinaryReader,
  type: IAttributeType,
  name: string,
  numElements: number,
): IUe4AttributeEntry["values"] {
  if (type.kind === "name") {
    const count = reader.int32(`${name} FName count`);
    if (count < 0 || count > MAX_ATTRIBUTE_VALUES) {
      throw meshError(`Invalid FName count for ${name}`, { name, count });
    }
    assertUAsset(
      count === numElements,
      "INVALID_MESH_DESCRIPTION",
      `Serialized value count mismatch for ${name}`,
      { name, expected: numElements, actual: count },
    );
    const names: string[] = new Array(count);
    for (let index = 0; index < count; index += 1)
      names[index] = reader.fstring(`${name}[${index}]`);
    return names;
  }

  const elementSize = reader.int32(`${name} bulk element size`);
  const count = reader.int32(`${name} bulk element count`);
  assertUAsset(
    type.byteSize !== undefined && elementSize === type.byteSize,
    "INVALID_MESH_DESCRIPTION",
    `${name} has an unexpected element size`,
    { name, expected: type.byteSize, actual: elementSize },
  );
  assertUAsset(
    count === numElements,
    "INVALID_MESH_DESCRIPTION",
    `Serialized value count mismatch for ${name}`,
    { name, expected: numElements, actual: count },
  );
  const requiredBytes = count * elementSize;
  assertUAsset(
    Number.isSafeInteger(requiredBytes) && requiredBytes <= reader.remaining,
    "INVALID_MESH_DESCRIPTION",
    `${name} exceeds the remaining MeshDescription payload`,
    { name, requiredBytes, remaining: reader.remaining },
  );

  if (type.kind === "float") {
    const values = new Float32Array(count * type.components);
    for (let index = 0; index < values.length; index += 1) values[index] = reader.float32(name);
    return values;
  }
  if (type.kind === "int") return readInt32Array(reader, count, name);
  const values = new Uint8Array(count);
  values.set(reader.raw(count, name));
  return values;
}

function readDefaultValue(reader: BinaryReader, type: IAttributeType): void {
  switch (type.kind) {
    case "float":
      for (let index = 0; index < type.components; index += 1) reader.float32(type.name);
      return;
    case "int":
    case "bool":
      reader.int32(type.name);
      return;
    case "name":
      reader.fstring(type.name);
      return;
  }
}

function readAttributeSet(
  reader: BinaryReader,
  what: string,
  expectedElements: number,
): Ue4AttributeSet {
  const numElements = reader.int32(`${what} attribute-set element count`);
  const attributeCount = reader.int32(`${what} attribute count`);
  if (
    numElements < 0 ||
    numElements > MAX_MESH_ELEMENTS ||
    attributeCount < 0 ||
    attributeCount > 1024
  ) {
    throw meshError(`Invalid ${what} attribute set`, { what, numElements, attributeCount });
  }
  assertUAsset(
    numElements === expectedElements,
    "INVALID_MESH_DESCRIPTION",
    `${what} attribute set disagrees with its element container`,
    { what, numElements, expectedElements },
  );
  const attributes: Ue4AttributeSet = new Map();
  for (let index = 0; index < attributeCount; index += 1) {
    const rawName = reader.fstring(`${what} attribute name ${index}`);
    const entry = readAttributeEntry(reader, rawName);
    assertUAsset(
      entry.numElements === numElements,
      "INVALID_MESH_DESCRIPTION",
      `${what} attribute "${entry.name}" disagrees with its set`,
      { what, attribute: entry.name, numElements: entry.numElements, expected: numElements },
    );
    attributes.set(entry.name, entry);
  }
  return attributes;
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
  const vertexInstanceVertices = readInt32Array(
    reader,
    vertexInstances.numBits,
    "FMeshVertexInstance.VertexID",
  );
  const edges = readBitArray(reader, "EdgeArray");
  reader.skip(edges.numBits * 8, "FMeshEdge.VertexIDs");

  const polygons = readBitArray(reader, "PolygonArray");
  const polygonGroups = new Int32Array(polygons.numBits);
  for (let index = 0; index < polygons.numBits; index += 1) {
    // A polygon's triangulation is rebuilt on load, so the array is written empty; reading it as
    // an array rather than skipping four bytes keeps a non-empty one from silently derailing.
    const triangleCount = reader.int32("FMeshPolygon.TriangleIDs count");
    if (triangleCount < 0 || triangleCount > MAX_MESH_ELEMENTS) {
      throw meshError("Invalid polygon triangulation count", { polygon: index, triangleCount });
    }
    reader.skip(triangleCount * 4, "FMeshPolygon.TriangleIDs");
    polygonGroups[index] = reader.int32("FMeshPolygon.PolygonGroupID");
  }
  const polygonGroupArray = readBitArray(reader, "PolygonGroupArray");

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
  const triangleVertexInstances = new Int32Array(triangles.numBits * 3);
  const trianglePolygons = new Int32Array(triangles.numBits);
  for (let index = 0; index < triangles.numBits; index += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      triangleVertexInstances[index * 3 + corner] = reader.int32("FMeshTriangle.VertexInstanceIDs");
    }
    trianglePolygons[index] = reader.int32("FMeshTriangle.PolygonID");
  }
  readAttributeSet(reader, "Triangle", triangles.numBits);

  validateReferences({
    vertexCount: vertices.numBits,
    vertexInstanceCount: vertexInstances.numBits,
    polygonCount: polygons.numBits,
    polygonGroupCount: polygonGroupArray.numBits,
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
    vertexCount: vertices.numBits,
    vertexInstanceVertices,
    polygonGroups,
    polygonGroupCount: polygonGroupArray.numBits,
    triangleVertexInstances,
    trianglePolygons,
    vertexAttributes,
    vertexInstanceAttributes,
    polygonGroupAttributes,
  };
}

/** Every index a triangle, vertex instance or polygon carries must land inside the container it
 * names. A payload that fails this walked cleanly and still describes geometry that cannot be
 * drawn, which is the failure mode worth catching before any array is built. */
function validateReferences(counts: {
  vertexCount: number;
  vertexInstanceCount: number;
  polygonCount: number;
  polygonGroupCount: number;
  vertexInstanceVertices: Int32Array;
  polygonGroups: Int32Array;
  triangleVertexInstances: Int32Array;
  trianglePolygons: Int32Array;
}): void {
  assertUAsset(
    counts.vertexCount > 0 && counts.vertexInstanceCount > 0 && counts.polygonCount > 0,
    "INVALID_MESH_DESCRIPTION",
    "UE4 MeshDescription contains no renderable geometry",
    {
      vertexCount: counts.vertexCount,
      vertexInstanceCount: counts.vertexInstanceCount,
      polygonCount: counts.polygonCount,
    },
  );
  const inRange = (values: Int32Array, limit: number, what: string, container: string): void => {
    for (const value of values) {
      if (value < 0 || value >= limit) {
        throw meshError(`${what} references an index outside ${container}`, {
          value,
          limit,
          container,
        });
      }
    }
  };
  inRange(counts.vertexInstanceVertices, counts.vertexCount, "Vertex instance", "VertexArray");
  inRange(counts.polygonGroups, counts.polygonGroupCount, "Polygon", "PolygonGroupArray");
  inRange(
    counts.triangleVertexInstances,
    counts.vertexInstanceCount,
    "Triangle",
    "VertexInstanceArray",
  );
  inRange(counts.trianglePolygons, counts.polygonCount, "Triangle", "PolygonArray");
}

/** The serialized signature of a UE4 MeshDescription payload: a fully allocated vertex bit
 * array followed by a second bit array whose own words start where the first one ends. Strong
 * enough to gate a full parse attempt, not strong enough to trust alone. */
export function looksLikeMeshDescriptionUe4(bytes: Uint8Array, offset = 0): boolean {
  if (offset < 0 || offset + 12 > bytes.byteLength) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vertexBits = view.getInt32(offset, true);
  if (vertexBits <= 0 || vertexBits > MAX_MESH_ELEMENTS) return false;
  const instanceOffset = offset + 4 + Math.ceil(vertexBits / 32) * 4;
  if (instanceOffset + 4 > bytes.byteLength) return false;
  const instanceBits = view.getInt32(instanceOffset, true);
  return instanceBits > 0 && instanceBits <= MAX_MESH_ELEMENTS && instanceBits % 3 === 0;
}
