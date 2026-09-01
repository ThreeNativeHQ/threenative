import { BinaryReader } from "./binary.js";
import { UAssetError, assertUAsset } from "./errors.js";

const MAX_MESH_ELEMENTS = 10_000_000;
const MAX_ATTRIBUTE_VALUES = 100_000_000;

interface IAttributeType {
  readonly name: string;
  readonly components: number;
  /** Serialized byte size of one bulk element; `undefined` for FName, which is length-prefixed. */
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

export interface IBitArray {
  numBits: number;
  validIds: number[];
}

export interface IAttributeChannel {
  extent: number;
  values: Float32Array | Int32Array | Uint8Array | string[];
  serializedCount: number;
}

export interface IAttributeEntry {
  name: string;
  type: string;
  components: number;
  extent: number;
  numElements: number;
  channels: readonly IAttributeChannel[];
}

export interface IElementContainer {
  allocation: IBitArray;
  attributeSet: {
    numElements: number;
    attributes: Map<string, IAttributeEntry>;
  };
}

export interface IMeshDescription {
  byteLength: number;
  trailingBytes: number;
  elements: Map<string, { name: string; channels: readonly IElementContainer[] }>;
}

function readBitArray(reader: BinaryReader): IBitArray {
  const numBits = reader.int32("TBitArray NumBits");
  assertUAsset(
    numBits >= 0 && numBits <= MAX_MESH_ELEMENTS,
    "INVALID_MESH_DESCRIPTION",
    "Invalid Unreal bit-array length",
    { offset: reader.pos - 4, numBits },
  );
  const wordCount = Math.ceil(numBits / 32);
  const words = new Uint32Array(wordCount);
  for (let index = 0; index < wordCount; index += 1) {
    words[index] = reader.uint32("TBitArray word");
  }
  const validIds: number[] = [];
  for (let id = 0; id < numBits; id += 1) {
    const word = words[id >>> 5];
    if (word !== undefined && (word & (1 << (id & 31))) !== 0) validIds.push(id);
  }
  return { numBits, validIds };
}

function readBulkValues(
  reader: BinaryReader,
  type: IAttributeType,
  context: string,
): { values: Float32Array | Int32Array | Uint8Array; serializedCount: number } {
  const serializedElementSize = reader.int32(`${context} bulk element size`);
  const serializedCount = reader.int32(`${context} bulk element count`);
  assertUAsset(
    type.byteSize !== undefined && serializedElementSize === type.byteSize,
    "INVALID_MESH_DESCRIPTION",
    `${context} has an unexpected element size`,
    { expected: type.byteSize, actual: serializedElementSize, type: type.name },
  );
  assertUAsset(
    serializedCount >= 0 && serializedCount <= MAX_ATTRIBUTE_VALUES,
    "INVALID_MESH_DESCRIPTION",
    `${context} has an invalid value count`,
    { count: serializedCount },
  );

  const requiredBytes = serializedCount * serializedElementSize;
  assertUAsset(
    Number.isSafeInteger(requiredBytes) && requiredBytes <= reader.remaining,
    "INVALID_MESH_DESCRIPTION",
    `${context} exceeds the remaining MeshDescription payload`,
    { requiredBytes, remaining: reader.remaining, serializedCount, serializedElementSize },
  );

  if (type.kind === "float") {
    const values = new Float32Array(serializedCount * type.components);
    for (let index = 0; index < values.length; index += 1) {
      values[index] = reader.float32(context);
    }
    return { values, serializedCount };
  }
  if (type.kind === "int") {
    const values = new Int32Array(serializedCount);
    for (let index = 0; index < values.length; index += 1) {
      values[index] = reader.int32(context);
    }
    return { values, serializedCount };
  }
  const values = new Uint8Array(serializedCount);
  values.set(reader.raw(serializedCount, context));
  return { values, serializedCount };
}

function readAttributeEntry(reader: BinaryReader, rawName: string): IAttributeEntry {
  const name = rawName.trimEnd();
  const typeIndex = reader.uint32(`${name} type`);
  const type = ATTRIBUTE_TYPES[typeIndex];
  assertUAsset(
    type !== undefined,
    "INVALID_MESH_DESCRIPTION",
    "Unknown MeshDescription attribute type",
    {
      attribute: name,
      typeIndex,
    },
  );
  const extent = reader.uint32(`${name} extent`);
  assertUAsset(
    extent >= 1 && extent <= 64,
    "INVALID_MESH_DESCRIPTION",
    `Invalid extent for ${name}`,
    {
      extent,
    },
  );
  const numElements = reader.int32(`${name} number of elements`);
  const numChannels = reader.int32(`${name} channel count`);
  assertUAsset(
    numElements >= 0 && numElements <= MAX_MESH_ELEMENTS,
    "INVALID_MESH_DESCRIPTION",
    `Invalid element count for ${name}`,
    { numElements },
  );
  assertUAsset(
    numChannels >= 0 && numChannels <= 128,
    "INVALID_MESH_DESCRIPTION",
    `Invalid channel count for ${name}`,
    { numChannels },
  );

  const channels: IAttributeChannel[] = [];
  for (let channelIndex = 0; channelIndex < numChannels; channelIndex += 1) {
    const channelExtent = reader.uint32(`${name} channel extent`);
    assertUAsset(
      channelExtent === extent,
      "INVALID_MESH_DESCRIPTION",
      `Channel extent mismatch for ${name}`,
      { extent, channelExtent },
    );

    let channel: IAttributeChannel;
    if (type.kind === "name") {
      const count = reader.int32(`${name} FName count`);
      assertUAsset(
        count >= 0 && count <= MAX_ATTRIBUTE_VALUES,
        "INVALID_MESH_DESCRIPTION",
        `Invalid FName count for ${name}`,
        { count },
      );
      const values: string[] = new Array(count);
      for (let index = 0; index < count; index += 1) {
        values[index] = reader.fstring(`${name}[${index}]`);
      }
      channel = { extent: channelExtent, values, serializedCount: count };
    } else {
      channel = {
        extent: channelExtent,
        ...readBulkValues(reader, type, `${name}[${channelIndex}]`),
      };
    }
    const expectedCount = numElements * extent;
    assertUAsset(
      channel.serializedCount === expectedCount,
      "INVALID_MESH_DESCRIPTION",
      `Serialized value count mismatch for ${name}`,
      {
        channelIndex,
        expected: expectedCount,
        actual: channel.serializedCount,
        numElements,
        extent,
      },
    );
    channels.push(channel);
  }

  // The per-attribute default value and flags close the entry; they are consumed for the walk
  // and recorded only when a caller needs them.
  readDefaultValue(reader, type);
  reader.uint32(`${name} flags`);
  return {
    name,
    type: type.name,
    components: type.components,
    extent,
    numElements,
    channels,
  };
}

function readDefaultValue(
  reader: BinaryReader,
  type: IAttributeType,
): number | boolean | string | number[] {
  switch (type.kind) {
    case "float": {
      const values: number[] = [];
      for (let index = 0; index < type.components; index += 1) {
        values.push(reader.float32(type.name));
      }
      return type.components === 1 ? (values[0] ?? 0) : values;
    }
    case "int":
      return reader.int32(type.name);
    case "bool":
      return reader.uint32(type.name) !== 0;
    case "name":
      return reader.fstring(type.name);
  }
}

function readAttributesSet(reader: BinaryReader): IElementContainer["attributeSet"] {
  const numElements = reader.int32("attribute-set number of elements");
  const attributeCount = reader.int32("attribute map count");
  assertUAsset(
    numElements >= 0 &&
      numElements <= MAX_MESH_ELEMENTS &&
      attributeCount >= 0 &&
      attributeCount <= 1024,
    "INVALID_MESH_DESCRIPTION",
    "Invalid attribute-set size",
    { numElements, attributeCount },
  );
  const attributes = new Map<string, IAttributeEntry>();
  for (let index = 0; index < attributeCount; index += 1) {
    const rawName = reader.fstring(`attribute name ${index}`);
    const entry = readAttributeEntry(reader, rawName);
    attributes.set(entry.name, entry);
  }
  return { numElements, attributes };
}

function readElementContainer(
  reader: BinaryReader,
  elementName: string,
  channelIndex: number,
): IElementContainer {
  const allocation = readBitArray(reader);
  const numHoles = reader.int32(`${elementName} NumHoles`);
  const attributeSet = readAttributesSet(reader);
  assertUAsset(
    attributeSet.numElements === allocation.numBits,
    "INVALID_MESH_DESCRIPTION",
    `Allocation and attribute count disagree for ${elementName}`,
    {
      channelIndex,
      allocatedSlots: allocation.numBits,
      attributeElements: attributeSet.numElements,
    },
  );
  assertUAsset(
    numHoles >= 0 && numHoles <= allocation.numBits,
    "INVALID_MESH_DESCRIPTION",
    `Invalid hole count for ${elementName}`,
    { channelIndex, numHoles, numBits: allocation.numBits },
  );
  assertUAsset(
    allocation.validIds.length === allocation.numBits - numHoles,
    "INVALID_MESH_DESCRIPTION",
    `Bit array and hole count disagree for ${elementName}`,
    { validIds: allocation.validIds.length, numBits: allocation.numBits, numHoles },
  );
  return { allocation, attributeSet };
}

/** Parses a serialized `FMeshDescription` — element containers, allocation bit arrays, and
 * attribute sets — into typed arrays, validating every count against its neighbors. */
export function parseMeshDescription(input: Uint8Array, offset = 0): IMeshDescription {
  const reader = new BinaryReader(input, offset);
  const start = reader.pos;
  const elementTypeCount = reader.int32("MeshDescription element type count");
  assertUAsset(
    elementTypeCount >= 1 && elementTypeCount <= 32,
    "INVALID_MESH_DESCRIPTION",
    "Invalid MeshDescription element-type count",
    { offset, elementTypeCount },
  );

  const elements = new Map<string, { name: string; channels: IElementContainer[] }>();
  for (let elementIndex = 0; elementIndex < elementTypeCount; elementIndex += 1) {
    const name = reader.fstring(`element type ${elementIndex}`);
    assertUAsset(
      name.length > 0 && name.length < 128,
      "INVALID_MESH_DESCRIPTION",
      "Invalid MeshDescription element name",
      { elementIndex, name },
    );
    const channelCount = reader.int32(`${name} channel count`);
    assertUAsset(
      channelCount >= 1 && channelCount <= 128,
      "INVALID_MESH_DESCRIPTION",
      `Invalid channel count for ${name}`,
      { channelCount },
    );
    const channels: IElementContainer[] = [];
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      channels.push(readElementContainer(reader, name, channelIndex));
    }
    elements.set(name, { name, channels });
  }

  return {
    byteLength: reader.pos - start,
    trailingBytes: reader.remaining,
    elements,
  };
}

/** The serialized MeshDescription signature: an element-type count followed by the FString
 * "Vertices". Strong enough to gate a full parse attempt, not strong enough to trust alone. */
export function looksLikeMeshDescription(bytes: Uint8Array, offset = 0): boolean {
  if (offset < 0 || offset + 17 > bytes.byteLength) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getInt32(offset, true);
  const stringLength = view.getInt32(offset + 4, true);
  if (count < 1 || count > 32 || stringLength !== 9) return false;
  const expected = "Vertices";
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + 8 + index] !== expected.charCodeAt(index)) return false;
  }
  return bytes[offset + 16] === 0;
}

export function findMeshDescriptionOffsets(bytes: Uint8Array): number[] {
  const offsets: number[] = [];
  for (let offset = 0; offset + 17 <= bytes.byteLength; offset += 1) {
    if (looksLikeMeshDescription(bytes, offset)) offsets.push(offset);
  }
  return offsets;
}
