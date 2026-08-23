import { deflateSync } from "node:zlib";

/**
 * Builds a minimal valid 8-bit RGBA PNG entirely deterministically: every pixel is
 * `(r, g, b, a)` from the four functions of its coordinates. Test fixtures for the asset
 * pipeline need real decodable images — the encoders reject garbage bytes — without
 * committing binary blobs or depending on an image library.
 */
export function rgbaPng(options: {
  readonly alpha?: (x: number, y: number) => number;
  readonly blue?: (x: number, y: number) => number;
  readonly green?: (x: number, y: number) => number;
  readonly height: number;
  readonly red?: (x: number, y: number) => number;
  readonly width: number;
}): Buffer {
  const { width, height } = options;
  const red = options.red ?? (() => 200);
  const green = options.green ?? (() => 30);
  const blue = options.blue ?? (() => 40);
  const alpha = options.alpha ?? (() => 255);

  // Scanlines are filtered with filter type 0 (None): raw RGBA prefixed by one filter byte.
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = row + 1 + x * 4;
      raw[pixel] = red(x, y) & 0xff;
      raw[pixel + 1] = green(x, y) & 0xff;
      raw[pixel + 2] = blue(x, y) & 0xff;
      raw[pixel + 3] = alpha(x, y) & 0xff;
    }
  }

  const header = Buffer.alloc(8);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA

  return Buffer.concat([
    header,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
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

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
