import { describe, expect, it } from "vitest";
import { parsePng } from "../src/png.js";

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

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer, crc?: number): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc ?? crc32(body), 0);
  return Buffer.concat([length, body, checksum]);
}

function ihdr(width: number, height: number, colorType = 6): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data.writeUInt8(8, 8); // bit depth
  data.writeUInt8(colorType, 9);
  return chunk("IHDR", data);
}

const IDAT = chunk("IDAT", Buffer.from([1, 2, 3, 4]));
const IEND = chunk("IEND", Buffer.alloc(0));
const IHDR = ihdr(8, 8, 6);

function png(parts: Buffer[]): Buffer {
  return Buffer.concat([SIGNATURE, ...parts]);
}

describe("parsePng", () => {
  it("reads a minimal valid PNG", () => {
    expect(parsePng(Buffer.concat([SIGNATURE, IHDR, IDAT, IEND]))).toEqual({
      width: 8,
      height: 8,
      hasAlpha: true,
    });
  });

  it("rejects input that is not a PNG", () => {
    expect(parsePng(Buffer.from("not a png"))).toBeUndefined();
    expect(parsePng(Buffer.alloc(0))).toBeUndefined();
    expect(parsePng(SIGNATURE.subarray(0, 7))).toBeUndefined();
  });

  it("rejects a chunk whose declared length runs past the buffer", () => {
    expect(parsePng(Buffer.concat([SIGNATURE, IHDR, IDAT.subarray(0, 10)]))).toBeUndefined();
  });

  it("rejects a CRC mismatch", () => {
    const corrupt = chunk("IDAT", Buffer.from([1, 2, 3, 4]), 0xdeadbeef);
    expect(parsePng(Buffer.concat([SIGNATURE, IHDR, corrupt, IEND]))).toBeUndefined();
  });

  it("rejects a duplicate IHDR", () => {
    const duplicate = Buffer.concat([SIGNATURE, IHDR, ihdr(4, 4, 6), IDAT, IEND]);
    expect(parsePng(duplicate)).toBeUndefined();
  });

  it("rejects zero width and zero height", () => {
    expect(parsePng(Buffer.concat([SIGNATURE, ihdr(0, 8, 6), IDAT, IEND]))).toBeUndefined();
    expect(parsePng(Buffer.concat([SIGNATURE, ihdr(8, 0, 6), IDAT, IEND]))).toBeUndefined();
  });

  it("rejects IEND before IDAT and IEND that is not the end of the file", () => {
    expect(parsePng(Buffer.concat([SIGNATURE, IHDR, IEND]))).toBeUndefined();
    expect(
      parsePng(Buffer.concat([SIGNATURE, IHDR, IDAT, IEND, Buffer.from([0x00])])),
    ).toBeUndefined();
  });

  it("rejects a run of chunks that never reaches IEND", () => {
    expect(parsePng(Buffer.concat([SIGNATURE, IHDR, IDAT]).subarray(0, 20))).toBeUndefined();
  });

  it("reads alpha from a tRNS chunk on an opaque colour type", () => {
    const transparency = chunk("tRNS", Buffer.from([0xff, 0x00]));
    const info = parsePng(Buffer.concat([SIGNATURE, ihdr(8, 8, 2), IDAT, transparency, IEND]));
    expect(info).toEqual({ width: 8, height: 8, hasAlpha: true });
  });
});
