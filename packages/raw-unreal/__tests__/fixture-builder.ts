/** Builders for synthetic fixtures: a minimal legacy package wrapper and hand-built FRawMesh
 * and FMeshDescription blocks. Nothing here derives from licensed pack data. */

export class Writer {
  readonly chunks: Uint8Array[] = [];

  bytes(value: Uint8Array | number[]): this {
    this.chunks.push(value instanceof Uint8Array ? value : Uint8Array.from(value));
    return this;
  }

  uint8(value: number): this {
    return this.bytes([value]);
  }

  int32(value: number): this {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setInt32(0, value, true);
    return this.bytes(bytes);
  }

  uint32(value: number): this {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    return this.bytes(bytes);
  }

  uint32BE(value: number): this {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, false);
    return this.bytes(bytes);
  }

  uint64BE(value: bigint): this {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, value, false);
    return this.bytes(bytes);
  }

  uint16(value: number): this {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    return this.bytes(bytes);
  }

  /** A little-endian signed 64-bit field, as Unreal writes `int64` offsets and sizes. */
  int64(value: number): this {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigInt64(0, BigInt(value), true);
    return this.bytes(bytes);
  }

  float32(value: number): this {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, value, true);
    return this.bytes(bytes);
  }

  vec3(x: number, y: number, z: number): this {
    return this.float32(x).float32(y).float32(z);
  }

  vec2(u: number, v: number): this {
    return this.float32(u).float32(v);
  }

  /** An FString in the UTF-8 positive-length form, NUL included. */
  fstring(value: string): this {
    const encoded = new TextEncoder().encode(value);
    return this.int32(encoded.length + 1)
      .bytes(encoded)
      .uint8(0);
  }

  concat(): Uint8Array {
    const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

export interface IRawMeshFixture {
  /** Per-vertex positions (Unreal coordinates, Z-up). */
  vertices: readonly (readonly [number, number, number])[];
  /** Per-wedge vertex indices, three per face. */
  wedgeIndices: readonly number[];
  /** Per-wedge normals, same length as wedges. */
  wedgeNormals: readonly (readonly [number, number, number])[];
  /** First UV channel, two floats per wedge. */
  uvs: readonly (readonly [number, number])[];
  /** Per-face material (section) index. */
  faceMaterials: readonly number[];
  version?: number;
  /** Extra bytes appended after the blob, to prove the parse consumes the blob exactly. */
  trailingBytes?: number;
}

/** Writes the fixed-stride per-wedge arrays: WedgeIndices, both tangents, the normals, all
 * eight UV channels (only channel 0 populated), and WedgeColors. */
function writeWedgeArrays(writer: Writer, fixture: IRawMeshFixture, wedgeCount: number): void {
  writer.int32(wedgeCount);
  for (const wedge of fixture.wedgeIndices) writer.uint32(wedge);
  for (const [tx, ty, tz] of [
    [1, 0, 0],
    [0, 1, 0],
  ] as const) {
    writer.int32(wedgeCount);
    for (let wedge = 0; wedge < wedgeCount; wedge += 1) writer.vec3(tx, ty, tz);
  }
  writer.int32(wedgeCount); // WedgeTangentZ (the normals)
  for (const [x, y, z] of fixture.wedgeNormals) writer.vec3(x, y, z);
  for (let channel = 0; channel < 8; channel += 1) {
    if (channel === 0) {
      writer.int32(wedgeCount);
      for (const [u, v] of fixture.uvs) writer.vec2(u, v);
    } else {
      writer.int32(0);
    }
  }
  writer.int32(0); // WedgeColors
}

/** Builds an FRawMesh blob per `operator<<(FArchive&, FRawMesh&)`: version pair, then the
 * fixed-order TArrays including all eight UV channels and (from version 1) the import map. */
export function rawMeshBlob(fixture: IRawMeshFixture): Uint8Array {
  const version = fixture.version ?? 1;
  const wedgeCount = fixture.wedgeIndices.length;
  if (fixture.wedgeNormals.length !== wedgeCount)
    throw new Error("fixture normals must match wedges");
  if (fixture.uvs.length !== wedgeCount) throw new Error("fixture uvs must match wedges");
  if (fixture.faceMaterials.length * 3 !== wedgeCount)
    throw new Error("fixture faces must be wedges/3");

  const writer = new Writer();
  writer.int32(version).int32(0);
  writer.int32(fixture.faceMaterials.length);
  for (const material of fixture.faceMaterials) writer.int32(material);
  writer.int32(fixture.faceMaterials.length); // FaceSmoothingMasks, one per face
  for (let face = 0; face < fixture.faceMaterials.length; face += 1) writer.int32(0);
  writer.int32(fixture.vertices.length);
  for (const [x, y, z] of fixture.vertices) writer.vec3(x, y, z);
  writeWedgeArrays(writer, fixture, wedgeCount);
  if (version >= 1) {
    writer.int32(0); // ImportedMaterialNames
  }
  if (fixture.trailingBytes) {
    writer.bytes(new Uint8Array(fixture.trailingBytes));
  }
  return writer.concat();
}

/** Wraps payload bytes in a minimal legacy package: tag, a −7 summary with the given versions,
 * a one-entry custom-version list, and then the payload. */
export function legacyPackage(
  payload: Uint8Array,
  options: {
    fileVersionUE4?: number;
    licenseeVersion?: number;
    editorObjectVersion?: number;
    nameTable?: string;
  } = {},
): Uint8Array {
  const writer = new Writer();
  writer.uint32(0x9e2a83c1);
  writer.int32(-7); // LegacyFileVersion
  writer.int32(864); // LegacyUE3Version
  writer.int32(options.fileVersionUE4 ?? 514); // FileVersionUE4
  writer.int32(options.licenseeVersion ?? 0); // FileVersionLicenseeUE
  writer.int32(1); // CustomVersions count
  // FEditorObjectVersion GUID, serialized as four little-endian uint32 words.
  writer.uint32(0xe4b068ed).uint32(0xf49442e9).uint32(0xa231da0b).uint32(0x2e46bb41);
  writer.int32(options.editorObjectVersion ?? 27); // below StaticMeshDeprecatedRawMesh
  if (options.nameTable !== undefined) {
    writer.fstring(options.nameTable);
  }
  writer.bytes(payload);
  return writer.concat();
}

/** Flag bits of Unreal's `EBulkDataFlags`, as an editor package serializes them. */
export const BULK = {
  PAYLOAD_AT_END_OF_FILE: 0x0001,
  SERIALIZE_COMPRESSED_ZLIB: 0x0002,
  FORCE_INLINE_PAYLOAD: 0x0040,
  PAYLOAD_IN_SEPARATE_FILE: 0x0100,
  SERIALIZE_COMPRESSED_BIT_WINDOW: 0x0200,
  SIZE_64_BIT: 0x2000,
  NO_OFFSET_FIX_UP: 0x10000,
} as const;

/** Writes one `FByteBulkData` header: flags, element count, size on disk, offset in file. */
export function bulkDataHeader(fields: {
  flags: number;
  elementCount: number;
  sizeOnDisk: number;
  offsetInFile: number;
}): Uint8Array {
  const writer = new Writer();
  writer.uint32(fields.flags);
  if ((fields.flags & BULK.SIZE_64_BIT) !== 0) {
    writer.int64(fields.elementCount).int64(fields.sizeOnDisk);
  } else {
    writer.int32(fields.elementCount).int32(fields.sizeOnDisk);
  }
  writer.int64(fields.offsetInFile);
  return writer.concat();
}

/** Wraps payload bytes the way `FArchive::SerializeCompressed` does: the package tag and the
 * loading chunk size, the totals, one `FCompressedChunkInfo` per chunk, then the chunk data.
 * `compress` stands in for a real deflate; the reader only has to invert it. */
export function compressedChunks(
  payload: Uint8Array,
  compress: (block: Uint8Array) => Uint8Array,
  chunkSize = 131_072,
): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (let start = 0; start < payload.byteLength; start += chunkSize) {
    blocks.push(payload.subarray(start, Math.min(start + chunkSize, payload.byteLength)));
  }
  const compressed = blocks.map(compress);
  const writer = new Writer();
  writer.int64(0x9e2a83c1).int64(chunkSize);
  writer.int64(compressed.reduce((sum, block) => sum + block.byteLength, 0));
  writer.int64(payload.byteLength);
  for (let index = 0; index < blocks.length; index += 1) {
    writer.int64(compressed[index]?.byteLength ?? 0).int64(blocks[index]?.byteLength ?? 0);
  }
  for (const block of compressed) writer.bytes(block);
  return writer.concat();
}

export interface IEditorPackageFixture {
  /** Bytes placed in the export-data region, where `FByteBulkData` headers live. */
  exportData: Uint8Array;
  /** Bytes placed in the bulk-data region, which starts at the summary's BulkDataStartOffset. */
  bulkRegion?: Uint8Array;
  fileVersionUE4?: number;
  editorObjectVersion?: number;
  engineBranch?: string;
  objectPath?: string;
}

/** Builds a legacy editor package with a **complete** `FPackageFileSummary` — the header sizes
 * and `BulkDataStartOffset` a bulk-data reader needs, which `legacyPackage` does not write. */
export function editorPackage(fixture: IEditorPackageFixture): Uint8Array {
  const ue4 = fixture.fileVersionUE4 ?? 522;
  const branch = fixture.engineBranch ?? "++UE4+Release-4.26";
  const objectPath = fixture.objectPath ?? "/Game/Fixtures/StaticMeshes/SM_fixture";

  // The name table is the only header section after the summary; the offsets below name it.
  const names = new Writer();
  names.fstring(objectPath).fstring("StaticMesh");
  const nameTable = names.concat();

  const build = (nameOffset: number, totalHeaderSize: number, bulkDataStartOffset: number) => {
    const writer = new Writer();
    writer.uint32(0x9e2a83c1);
    writer.int32(-7).int32(864).int32(ue4).int32(0);
    writer.int32(1);
    writer.uint32(0xe4b068ed).uint32(0xf49442e9).uint32(0xa231da0b).uint32(0x2e46bb41);
    writer.int32(fixture.editorObjectVersion ?? 40);
    writer.int32(totalHeaderSize);
    writer.fstring("None");
    writer.uint32(0);
    writer.int32(2).int32(nameOffset);
    if (ue4 >= 516) writer.fstring("");
    if (ue4 >= 459) writer.int32(0).int32(0);
    writer.int32(1).int32(nameOffset + nameTable.byteLength);
    writer.int32(0).int32(nameOffset + nameTable.byteLength);
    writer.int32(nameOffset + nameTable.byteLength);
    if (ue4 >= 384) writer.int32(0).int32(0);
    if (ue4 >= 510) writer.int32(0);
    writer.int32(0);
    writer.bytes(new Uint8Array(16));
    if (ue4 >= 518) {
      writer.bytes(new Uint8Array(16));
      if (ue4 < 520) writer.bytes(new Uint8Array(16));
    }
    writer.int32(0);
    writer.uint16(4).uint16(26).uint16(2).uint32(0).fstring(branch);
    if (ue4 >= 444) writer.uint16(4).uint16(26).uint16(2).uint32(0).fstring(branch);
    writer.uint32(0).int32(0);
    writer.uint32(0).int32(0);
    writer.int32(0);
    writer.int64(bulkDataStartOffset);
    if (ue4 >= 224) writer.int32(0);
    if (ue4 >= 326) writer.int32(0);
    if (ue4 >= 507) writer.int32(0).int32(0);
    return writer.concat();
  };

  // The summary's own length depends on the offsets it carries, so it is written twice: once to
  // measure, once with the offsets the measurement produced. The lengths are stable because
  // every field written is fixed-width or a fixed string.
  const measured = build(0, 0, 0).byteLength;
  const nameOffset = measured;
  const totalHeaderSize = nameOffset + nameTable.byteLength;
  const bulkDataStartOffset = totalHeaderSize + fixture.exportData.byteLength;
  const summary = build(nameOffset, totalHeaderSize, bulkDataStartOffset);
  if (summary.byteLength !== measured) throw new Error("fixture summary length is unstable");

  const out = new Writer();
  out.bytes(summary).bytes(nameTable).bytes(fixture.exportData);
  if (fixture.bulkRegion) out.bytes(fixture.bulkRegion);
  out.uint32(0x9e2a83c1); // Unreal's end-of-file tag
  return out.concat();
}
