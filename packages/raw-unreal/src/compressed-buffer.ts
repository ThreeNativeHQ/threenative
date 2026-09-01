import { BinaryReader } from "./binary.js";
import { UAssetError, assertUAsset } from "./errors.js";
import type { Lz4Codec, OodleCodec } from "./types.js";

/** `FCompressedBuffer`'s big-endian magic. */
export const COMPRESSED_BUFFER_MAGIC = 0xb7756362;

export const COMPRESSION_METHOD = Object.freeze({
  NONE: 0,
  OODLE: 3,
  LZ4: 4,
} as const);

export interface ICompressedBuffer {
  offset: number;
  crc32: number;
  method: number;
  compressor: number;
  compressionLevel: number;
  blockSizeExponent: number;
  blockCount: number;
  totalRawSize: number;
  totalCompressedSize: number;
  /** BLAKE3 hash the writer recorded; validated by the caller, not here. */
  rawHash: Uint8Array;
  blockSizes: readonly number[];
  payloadBytes: Uint8Array;
}

export interface IUAssetCodecs {
  oodle?: OodleCodec;
  lz4?: Lz4Codec;
}

/** Scans for candidate `FCompressedBuffer` magics. Candidates are speculative — the four magic
 * bytes can appear in a payload — so every candidate goes through the full validating parse. */
export function findCompressedBufferOffsets(bytes: Uint8Array): number[] {
  const offsets: number[] = [];
  for (let offset = 0; offset + 4 <= bytes.byteLength; offset += 1) {
    if (
      bytes[offset] === 0xb7 &&
      bytes[offset + 1] === 0x75 &&
      bytes[offset + 2] === 0x63 &&
      bytes[offset + 3] === 0x62
    ) {
      offsets.push(offset);
    }
  }
  return offsets;
}

export function parseCompressedBuffer(bytes: Uint8Array, offset = 0): ICompressedBuffer {
  const reader = new BinaryReader(bytes, offset);
  const magic = reader.uint32BE("FCompressedBuffer magic");
  assertUAsset(
    magic === COMPRESSED_BUFFER_MAGIC,
    "INVALID_COMPRESSED_BUFFER",
    "Invalid FCompressedBuffer magic",
    {
      offset,
      magic: `0x${magic.toString(16)}`,
    },
  );

  const crc32 = reader.uint32BE("FCompressedBuffer CRC32");
  const method = reader.uint8("compression method");
  const compressor = reader.uint8("compressor");
  const compressionLevel = reader.uint8("compression level");
  const blockSizeExponent = reader.uint8("block size exponent");
  const blockCount = reader.uint32BE("block count");
  const totalRawSize = safeNumber(reader.uint64BE("total raw size"), "Total raw size", offset);
  const totalCompressedSize = safeNumber(
    reader.uint64BE("total compressed size"),
    "Total compressed size",
    offset,
  );
  const rawHash = reader.raw(32, "raw BLAKE3 hash");

  assertUAsset(
    blockCount <= 1_000_000,
    "INVALID_COMPRESSED_BUFFER",
    "Invalid compressed block count",
    {
      offset,
      blockCount,
    },
  );
  assertUAsset(
    totalCompressedSize >= 64,
    "INVALID_COMPRESSED_BUFFER",
    "Compressed buffer is smaller than its header",
    { offset, totalCompressedSize },
  );
  assertUAsset(
    totalCompressedSize <= Number.MAX_SAFE_INTEGER &&
      offset + totalCompressedSize <= bytes.byteLength,
    "TRUNCATED_PACKAGE",
    "Compressed buffer extends past the package",
    { offset, totalCompressedSize, packageSize: bytes.byteLength },
  );

  assertUAsset(
    method === COMPRESSION_METHOD.NONE ||
      method === COMPRESSION_METHOD.OODLE ||
      method === COMPRESSION_METHOD.LZ4,
    "UNSUPPORTED_COMPRESSION_METHOD",
    `Unsupported Unreal compressed-buffer method ${method}`,
    { offset, method },
  );
  assertUAsset(
    method === COMPRESSION_METHOD.NONE || blockCount > 0 || totalRawSize === 0,
    "INVALID_COMPRESSED_BUFFER",
    "Compressed Unreal payload declares no blocks",
    { offset, method, blockCount, totalRawSize },
  );

  const blockSizes: number[] = [];
  if (method === COMPRESSION_METHOD.OODLE || method === COMPRESSION_METHOD.LZ4) {
    for (let index = 0; index < blockCount; index += 1) {
      blockSizes.push(reader.uint32BE(`compressed block ${index} size`));
    }
  }

  const dataOffset = offset + reader.pos;
  const payloadSize =
    method === COMPRESSION_METHOD.NONE
      ? totalRawSize
      : blockSizes.reduce((sum, size) => sum + size, 0);
  assertUAsset(
    reader.pos + payloadSize <= totalCompressedSize,
    "INVALID_COMPRESSED_BUFFER",
    "Compressed payload exceeds its declared buffer size",
    { offset, headerAndTableSize: reader.pos, payloadSize, totalCompressedSize },
  );
  assertUAsset(
    dataOffset + payloadSize <= bytes.byteLength,
    "TRUNCATED_PACKAGE",
    "Compressed payload bytes are truncated",
    { offset, dataOffset, payloadSize, packageSize: bytes.byteLength },
  );

  return {
    offset,
    crc32,
    method,
    compressor,
    compressionLevel,
    blockSizeExponent,
    blockCount,
    totalRawSize,
    totalCompressedSize,
    rawHash: Uint8Array.from(rawHash),
    blockSizes,
    payloadBytes: bytes.subarray(dataOffset, dataOffset + payloadSize),
  };
}

function safeNumber(value: bigint, label: string, offset: number): number {
  const number = Number(value);
  assertUAsset(Number.isSafeInteger(number), "INVALID_COMPRESSED_BUFFER", `${label} is too large`, {
    offset,
    value: value.toString(),
  });
  return number;
}

/** Decompresses a parsed `FCompressedBuffer` block-by-block. Uncompressed payloads are copied
 * natively; Oodle and LZ4 payloads require the caller's codec. */
export function decompressCompressedBuffer(
  buffer: ICompressedBuffer,
  codecs: IUAssetCodecs,
): Uint8Array {
  if (buffer.method === COMPRESSION_METHOD.NONE) {
    return Uint8Array.from(buffer.payloadBytes.subarray(0, buffer.totalRawSize));
  }

  const isOodle = buffer.method === COMPRESSION_METHOD.OODLE;
  const codec = isOodle ? codecs.oodle : codecs.lz4;
  const codecName = isOodle ? "Oodle" : "LZ4";
  if (typeof codec !== "function") {
    throw new UAssetError(
      "MISSING_CODEC",
      `${codecName} decompression is required for this Unreal payload`,
      {
        method: buffer.method,
        offset: buffer.offset,
      },
    );
  }

  const output = new Uint8Array(buffer.totalRawSize);
  const maximumBlockSize =
    buffer.blockSizeExponent > 0 && buffer.blockSizeExponent < 31
      ? 2 ** buffer.blockSizeExponent
      : buffer.totalRawSize;
  let sourceOffset = 0;
  let targetOffset = 0;

  for (let index = 0; index < buffer.blockSizes.length; index += 1) {
    const compressedSize = buffer.blockSizes[index];
    if (compressedSize === undefined) {
      throw new UAssetError("INVALID_COMPRESSED_BUFFER", "Compressed block table ended early", {
        block: index,
      });
    }
    const rawBlockSize = Math.min(maximumBlockSize, buffer.totalRawSize - targetOffset);
    const compressed = buffer.payloadBytes.subarray(sourceOffset, sourceOffset + compressedSize);
    const decompressed = codec(compressed, rawBlockSize);
    assertUAsset(
      decompressed.byteLength === rawBlockSize,
      "CODEC_SIZE_MISMATCH",
      `${codecName} returned the wrong size`,
      { block: index, expected: rawBlockSize, actual: decompressed.byteLength },
    );
    output.set(decompressed, targetOffset);
    sourceOffset += compressedSize;
    targetOffset += rawBlockSize;
  }

  assertUAsset(
    targetOffset === buffer.totalRawSize,
    "INCOMPLETE_DECOMPRESSION",
    "Compressed payload did not produce the declared raw size",
    { expected: buffer.totalRawSize, actual: targetOffset },
  );
  return output;
}
