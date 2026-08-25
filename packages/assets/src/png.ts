const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface IPngInfo {
  readonly width: number;
  readonly height: number;
  readonly hasAlpha: boolean;
}

function crc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Parses the PNG structure needed by config validation and asset health reporting. */
export function parsePng(value: Buffer): IPngInfo | undefined {
  if (value.length < PNG_SIGNATURE.length || !value.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return undefined;
  }

  let offset = PNG_SIGNATURE.length;
  let hasHeader = false;
  let hasData = false;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let hasTransparencyChunk = false;
  while (offset + 12 <= value.length) {
    const length = value.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > value.length) return undefined;
    const type = value.toString("ascii", offset + 4, offset + 8);
    const chunk = value.subarray(offset + 4, offset + 8 + length);
    if (crc32(chunk) !== value.readUInt32BE(offset + 8 + length)) return undefined;
    if (type === "IHDR") {
      if (hasHeader || length !== 13) return undefined;
      width = value.readUInt32BE(offset + 8);
      height = value.readUInt32BE(offset + 12);
      colorType = value.readUInt8(offset + 17);
      if (width === 0 || height === 0) return undefined;
      hasHeader = true;
    } else if (type === "IDAT") {
      hasData = true;
    } else if (type === "tRNS") {
      hasTransparencyChunk = true;
    } else if (type === "IEND") {
      if (length !== 0 || !hasHeader || !hasData || chunkEnd !== value.length) return undefined;
      return {
        width,
        height,
        hasAlpha: colorType === 4 || colorType === 6 || hasTransparencyChunk,
      };
    }
    offset = chunkEnd;
  }
  return undefined;
}
