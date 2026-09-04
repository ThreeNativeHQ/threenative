import type { BinaryReader } from "./binary.js";
import { UAssetError, assertUAsset } from "./errors.js";

/**
 * The attribute half of the UE4.2x `FMeshDescription` serialization: a set is an element count,
 * an attribute count, then one entry each. An entry is shorter than UE5's — there is no
 * per-attribute or per-channel `extent`, so it reads name, type, element count, channel count,
 * then the channels, a default value and a flags word.
 *
 * Attribute arrays are dense over element **slots**, holes included, even though the elements
 * themselves are written once per allocated slot. That pairing is the whole reason this reader
 * takes the slot count from its caller rather than inferring one.
 */

const MAX_MESH_ELEMENTS = 10_000_000;
const MAX_ATTRIBUTE_VALUES = 100_000_000;

function readInt32Array(reader: BinaryReader, count: number, what: string): Int32Array {
  const values = new Int32Array(count);
  for (let index = 0; index < count; index += 1) values[index] = reader.int32(what);
  return values;
}

function meshError(message: string, details: Record<string, unknown>): UAssetError {
  return new UAssetError("INVALID_MESH_DESCRIPTION", message, details);
}

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

export function readAttributeSet(
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
