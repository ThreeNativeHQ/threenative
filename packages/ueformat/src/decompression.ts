import { gunzipSync } from "fflate";

import { UEFormatError } from "./errors.js";
import type { ZstdDecoder } from "./types.js";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validateGzipTrailer(compressed: Uint8Array, decoded: Uint8Array): void {
  if (compressed.length < 18)
    throw new TypeError("GZIP payload is shorter than its minimum header and trailer");
  const trailer = new DataView(
    compressed.buffer,
    compressed.byteOffset + compressed.byteLength - 8,
    8,
  );
  const expectedCrc = trailer.getUint32(0, true);
  const expectedSize = trailer.getUint32(4, true);
  if (crc32(decoded) !== expectedCrc || decoded.length >>> 0 !== expectedSize) {
    throw new TypeError("GZIP CRC32 or ISIZE trailer check failed");
  }
}

export function decompressBody(
  format: string,
  compressed: Uint8Array,
  uncompressedSize: number,
  zstdDecoder?: ZstdDecoder,
): Uint8Array {
  let result: Uint8Array;
  try {
    if (format === "GZIP") {
      result = gunzipSync(compressed);
      validateGzipTrailer(compressed, result);
    } else if (format === "ZSTD") {
      if (!zstdDecoder) {
        throw new UEFormatError(
          "INVALID_COMPRESSION",
          "ZSTD body requires ParseUEModelOptions.zstdDecoder",
        );
      }
      result = zstdDecoder(compressed, uncompressedSize);
      if (!(result instanceof Uint8Array)) {
        throw new TypeError("ZSTD decoder must return Uint8Array");
      }
    } else {
      throw new UEFormatError(
        "INVALID_COMPRESSION",
        `Unsupported compression format ${JSON.stringify(format)}`,
      );
    }
  } catch (error) {
    if (error instanceof UEFormatError) throw error;
    throw new UEFormatError(
      "DECOMPRESSION_FAILED",
      `Failed to decompress ${format} body`,
      -1,
      error,
    );
  }

  if (result.length !== uncompressedSize) {
    throw new UEFormatError(
      "SIZE_MISMATCH",
      `Decoded body has ${result.length} byte(s); header declares ${uncompressedSize}`,
    );
  }
  return result;
}
