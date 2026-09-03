import { BinaryReader } from "./binary.js";
import { UAssetError, assertUAsset } from "./errors.js";
import type { IPackageLayout } from "./package-summary.js";
import { PACKAGE_FILE_TAG } from "./package-summary.js";
import type {
  IUAssetBulkDataFiles,
  IUAssetBulkDataInfo,
  UAssetBulkDataFile,
  ZlibCodec,
} from "./types.js";

/**
 * Unreal's `EBulkDataFlags`. Only the bits this reader acts on are named; the rest are carried
 * through untouched on `IUAssetBulkDataInfo.flags`.
 */
export const BULK_DATA_FLAG = Object.freeze({
  PAYLOAD_AT_END_OF_FILE: 0x0000_0001,
  SERIALIZE_COMPRESSED_ZLIB: 0x0000_0002,
  FORCE_INLINE_PAYLOAD: 0x0000_0040,
  PAYLOAD_IN_SEPARATE_FILE: 0x0000_0100,
  OPTIONAL_PAYLOAD: 0x0000_0800,
  MEMORY_MAPPED_PAYLOAD: 0x0000_1000,
  SIZE_64_BIT: 0x0000_2000,
  NO_OFFSET_FIX_UP: 0x0001_0000,
});

/** Every flag bit Unreal defines. A header carrying anything outside this mask is not a header,
 * which is what keeps the candidate scan from accepting arbitrary bytes. */
const KNOWN_FLAG_MASK = 0x0001_ffff;

/** A payload smaller than an empty FRawMesh cannot be a source model, and the smallest sensible
 * candidate keeps the scan from burning time on noise. */
const MIN_PAYLOAD_BYTES = 16;

/** `FArchive::SerializeCompressed` never writes a chunk larger than this, so a header claiming
 * one is malformed rather than merely large. */
const MAX_COMPRESSION_CHUNK_BYTES = 64 * 1024 * 1024;

export interface IBulkDataHeader extends IUAssetBulkDataInfo {
  /** First byte after the header — the payload itself for an inline payload. */
  headerEnd: number;
}

function bulkError(message: string, details: Record<string, unknown>): UAssetError {
  return new UAssetError("INVALID_BULK_DATA", message, details);
}

/** Unreal writes exactly one of these; a candidate naming none or several is not a header, which
 * matters most for the separate-file flag, whose payload cannot be range-checked here. */
function storageOf(flags: number): IUAssetBulkDataInfo["storage"] | undefined {
  const named = [
    BULK_DATA_FLAG.PAYLOAD_IN_SEPARATE_FILE,
    BULK_DATA_FLAG.FORCE_INLINE_PAYLOAD,
    BULK_DATA_FLAG.PAYLOAD_AT_END_OF_FILE,
  ].filter((bit) => (flags & bit) !== 0);
  if (named.length !== 1) return undefined;
  if (named[0] === BULK_DATA_FLAG.PAYLOAD_IN_SEPARATE_FILE) return "separate-file";
  if (named[0] === BULK_DATA_FLAG.FORCE_INLINE_PAYLOAD) return "inline";
  return "end-of-file";
}

function fileOf(flags: number, storage: IUAssetBulkDataInfo["storage"]): UAssetBulkDataFile {
  if (storage !== "separate-file") return "uasset";
  return (flags & BULK_DATA_FLAG.OPTIONAL_PAYLOAD) !== 0 ? "uptnl" : "ubulk";
}

/**
 * Parses one `FByteBulkData` header at `offset`: the flags, the element count and size on disk
 * (widened to 64 bits when `BULKDATA_Size64Bit` is set), and the offset the payload sits at.
 * Throws `UAssetError` "INVALID_BULK_DATA" when the fields cannot describe a payload.
 */
export function parseBulkDataHeader(
  bytes: Uint8Array,
  offset: number,
  layout: IPackageLayout,
): IBulkDataHeader {
  const reader = new BinaryReader(bytes, offset);
  const flags = reader.uint32("BulkDataFlags");
  if ((flags & ~KNOWN_FLAG_MASK) !== 0) {
    throw bulkError("BulkDataFlags carries bits Unreal does not define", { offset, flags });
  }
  const storage = storageOf(flags);
  if (storage === undefined) {
    throw bulkError("BulkDataFlags names no payload storage", { offset, flags });
  }

  const wide = (flags & BULK_DATA_FLAG.SIZE_64_BIT) !== 0;
  const elementCount = wide ? readInt64(reader, "ElementCount") : reader.int32("ElementCount");
  const sizeOnDisk = wide
    ? readInt64(reader, "BulkDataSizeOnDisk")
    : reader.int32("BulkDataSizeOnDisk");
  const offsetInFile = readInt64(reader, "BulkDataOffsetInFile");
  const headerEnd = offset + reader.pos;

  if (elementCount <= 0 || sizeOnDisk < MIN_PAYLOAD_BYTES || offsetInFile < 0) {
    throw bulkError("Bulk-data header describes no readable payload", {
      offset,
      flags,
      elementCount,
      sizeOnDisk,
      offsetInFile,
    });
  }
  // An `FByteBulkData` element is one byte, so an uncompressed payload occupies exactly its
  // element count on disk. Unreal's own invariant, and the sharpest filter the scan has: it
  // takes SM_Bar_1 from 112 byte patterns that parse as headers to 3.
  const compression =
    (flags & BULK_DATA_FLAG.SERIALIZE_COMPRESSED_ZLIB) !== 0 ? "zlib" : ("none" as const);
  if (compression === "none" && elementCount !== sizeOnDisk) {
    throw bulkError("Uncompressed bulk data does not occupy one byte per element", {
      offset,
      flags,
      elementCount,
      sizeOnDisk,
    });
  }

  // Unreal writes an end-of-file offset relative to the summary's BulkDataStartOffset unless
  // BULKDATA_NoOffsetFixUp says the offset is already absolute.
  const fixUp =
    storage === "end-of-file" && (flags & BULK_DATA_FLAG.NO_OFFSET_FIX_UP) === 0
      ? layout.bulkDataStartOffset
      : 0;
  const payloadOffset = storage === "inline" ? headerEnd : offsetInFile + fixUp;

  return {
    headerOffset: offset,
    headerEnd,
    flags,
    storage,
    file: fileOf(flags, storage),
    compression,
    elementCount,
    sizeOnDisk,
    offsetInFile,
    payloadOffset,
  };
}

function readInt64(reader: BinaryReader, context: string): number {
  reader.ensure(8, context);
  const value = reader.view.getBigInt64(reader.pos, true);
  reader.pos += 8;
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw bulkError(`${context} exceeds the safe integer range`, { value: value.toString() });
  }
  return Number(value);
}

/**
 * Scans the package's export-data region for `FByteBulkData` headers. Export data is where
 * Unreal serializes them, so the scan is bounded by the summary's own offsets rather than
 * sweeping the whole file. Every candidate is decided by `parseBulkDataHeader` plus a range
 * check against the file the payload claims to live in; anything else is dropped silently,
 * because a rejected candidate is a byte pattern, not a defect.
 */
export function findBulkDataHeaders(
  bytes: Uint8Array,
  layout: IPackageLayout,
  files: IUAssetBulkDataFiles = {},
): IBulkDataHeader[] {
  const headers: IBulkDataHeader[] = [];
  const scanEnd = Math.min(layout.bulkDataStartOffset, bytes.byteLength);
  for (let offset = layout.totalHeaderSize; offset + 20 <= scanEnd; offset += 1) {
    let header: IBulkDataHeader;
    try {
      header = parseBulkDataHeader(bytes, offset, layout);
    } catch (error) {
      if (!(error instanceof UAssetError)) throw error;
      continue;
    }
    if (!payloadFits(header, bytes, files, layout)) continue;
    headers.push(header);
  }
  return headers;
}

/**
 * Whether the payload range lands inside the file it names.
 *
 * A separate-file candidate whose sibling bytes the caller did not supply is **dropped**, not
 * kept as a maybe. Nothing in the `.uasset` can range-check it, so a byte run that happens to
 * parse as a header is indistinguishable from a real one — and this scan finds plenty. One
 * material asset in the Paragon pack yielded eleven such patterns claiming payloads of up to
 * eight terabytes; acting on any of them would have told a caller to go and find a `.ubulk` for
 * a package that has never had one. The `supported:` line on the unsupported-layout error is
 * where a caller learns that these payloads need `bulkDataFiles`, because that statement is
 * true of the format rather than a claim about the package in hand.
 */
function payloadFits(
  header: IBulkDataHeader,
  bytes: Uint8Array,
  files: IUAssetBulkDataFiles,
  layout: IPackageLayout,
): boolean {
  if (header.storage === "separate-file") {
    const sibling = siblingBytes(files, header.file);
    if (sibling === undefined) return false;
    return header.payloadOffset + header.sizeOnDisk <= sibling.byteLength;
  }
  if (header.storage === "inline") {
    return header.payloadOffset + header.sizeOnDisk <= layout.bulkDataStartOffset;
  }
  return (
    header.payloadOffset >= layout.bulkDataStartOffset &&
    header.payloadOffset + header.sizeOnDisk <= bytes.byteLength
  );
}

function siblingBytes(
  files: IUAssetBulkDataFiles,
  file: UAssetBulkDataFile,
): Uint8Array | undefined {
  const input = file === "uasset" ? undefined : files[file];
  if (input === undefined) return undefined;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

/**
 * Inverts `FArchive::SerializeCompressed`: the package tag and the loading chunk size, the
 * compressed and raw totals, one `FCompressedChunkInfo` per chunk, then the chunk data. The
 * zlib codec is the caller's; a payload whose codec was not supplied throws `MISSING_CODEC`
 * rather than returning a partial buffer.
 */
export function decompressBulkData(
  container: Uint8Array,
  codecs: { zlib?: ZlibCodec },
): Uint8Array {
  const reader = new BinaryReader(container);
  const tag = readInt64(reader, "compressed-chunk tag");
  assertUAsset(
    tag === PACKAGE_FILE_TAG,
    "INVALID_BULK_DATA",
    "Compressed bulk data does not start with the package tag",
    { tag: `0x${tag.toString(16)}` },
  );
  const chunkSize = readInt64(reader, "loading compression chunk size");
  const totalCompressed = readInt64(reader, "total compressed size");
  const totalRaw = readInt64(reader, "total uncompressed size");
  assertUAsset(
    chunkSize > 0 &&
      chunkSize <= MAX_COMPRESSION_CHUNK_BYTES &&
      totalCompressed > 0 &&
      totalRaw > 0,
    "INVALID_BULK_DATA",
    "Compressed bulk-data totals are not readable sizes",
    { chunkSize, totalCompressed, totalRaw },
  );

  const chunkCount = Math.ceil(totalRaw / chunkSize);
  const chunks: { compressed: number; raw: number }[] = [];
  let compressedSum = 0;
  let rawSum = 0;
  for (let index = 0; index < chunkCount; index += 1) {
    const compressed = readInt64(reader, `chunk ${index} compressed size`);
    const raw = readInt64(reader, `chunk ${index} uncompressed size`);
    assertUAsset(
      compressed > 0 && raw > 0 && raw <= chunkSize,
      "INVALID_BULK_DATA",
      `Compressed bulk-data chunk ${index} has an unreadable size`,
      { index, compressed, raw, chunkSize },
    );
    compressedSum += compressed;
    rawSum += raw;
    chunks.push({ compressed, raw });
  }
  assertUAsset(
    compressedSum === totalCompressed && rawSum === totalRaw,
    "INVALID_BULK_DATA",
    "Compressed bulk-data chunk sizes disagree with the container totals",
    { compressedSum, totalCompressed, rawSum, totalRaw },
  );

  if (codecs.zlib === undefined) {
    throw new UAssetError(
      "MISSING_CODEC",
      "This bulk-data payload is zlib-compressed and no `zlib` codec was supplied",
      { compression: "zlib", totalCompressed, totalRaw },
    );
  }

  const out = new Uint8Array(totalRaw);
  let written = 0;
  for (const [index, chunk] of chunks.entries()) {
    const block = reader.raw(chunk.compressed, `chunk ${index} data`);
    const inflated = codecs.zlib(block, chunk.raw);
    assertUAsset(
      inflated.byteLength === chunk.raw,
      "CODEC_SIZE_MISMATCH",
      `zlib codec returned ${inflated.byteLength} bytes for chunk ${index}, expected ${chunk.raw}`,
      { index, expected: chunk.raw, actual: inflated.byteLength },
    );
    out.set(inflated, written);
    written += inflated.byteLength;
  }
  assertUAsset(
    written === totalRaw,
    "INCOMPLETE_DECOMPRESSION",
    "Compressed bulk data did not decompress to its declared size",
    { written, totalRaw },
  );
  return out;
}

/**
 * Resolves one header's payload bytes: reads them out of the `.uasset`, the sibling file the
 * flags name, or the compressed container, and hands back plain bytes. Throws
 * `MISSING_BULK_DATA_FILE` when the payload lives beside the package and the caller did not
 * supply that file, and `MISSING_CODEC` when it is compressed with a codec that was not.
 */
export function resolveBulkDataPayload(
  bytes: Uint8Array,
  header: IBulkDataHeader,
  options: { files?: IUAssetBulkDataFiles; zlib?: ZlibCodec } = {},
): Uint8Array {
  const files = options.files ?? {};
  let source = bytes;
  if (header.storage === "separate-file") {
    const sibling = siblingBytes(files, header.file);
    if (sibling === undefined) {
      throw new UAssetError(
        "MISSING_BULK_DATA_FILE",
        `This package's bulk payload was written to its sibling .${header.file} file, whose bytes were not supplied`,
        {
          file: header.file,
          flags: header.flags,
          sizeOnDisk: header.sizeOnDisk,
          offsetInFile: header.offsetInFile,
        },
      );
    }
    source = sibling;
  }

  const end = header.payloadOffset + header.sizeOnDisk;
  assertUAsset(
    header.payloadOffset >= 0 && end <= source.byteLength,
    "INVALID_BULK_DATA",
    "Bulk-data payload runs past the file it was read from",
    {
      file: header.file,
      payloadOffset: header.payloadOffset,
      sizeOnDisk: header.sizeOnDisk,
      byteLength: source.byteLength,
    },
  );

  const stored = source.subarray(header.payloadOffset, end);
  if (header.compression === "none") return stored;
  return decompressBulkData(stored, { zlib: options.zlib });
}
