import { UAssetError } from "./errors.js";

const utf8 = new TextDecoder("utf-8");
const utf16 = new TextDecoder("utf-16le");

/** Bounds-checked little-endian reader over a byte range. Every read either lands inside the
 * range or throws; nothing reads past the buffer it was handed. */
export class BinaryReader {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  pos = 0;

  constructor(input: Uint8Array, offset = 0, length = input.byteLength - offset) {
    if (offset < 0 || length < 0 || offset + length > input.byteLength) {
      throw new UAssetError("TRUNCATED_PACKAGE", "Invalid binary reader range", {
        offset,
        length,
        byteLength: input.byteLength,
      });
    }
    this.bytes = input.subarray(offset, offset + length);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
  }

  get byteLength(): number {
    return this.bytes.byteLength;
  }

  get remaining(): number {
    return this.byteLength - this.pos;
  }

  ensure(size: number, context: string): void {
    if (!Number.isInteger(size) || size < 0 || this.pos + size > this.byteLength) {
      throw new UAssetError("TRUNCATED_PACKAGE", `Unexpected end of ${context}`, {
        offset: this.pos,
        requested: size,
        remaining: this.remaining,
      });
    }
  }

  seek(offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.byteLength) {
      throw new UAssetError("TRUNCATED_PACKAGE", "Invalid binary seek", {
        offset,
        byteLength: this.byteLength,
      });
    }
    this.pos = offset;
  }

  skip(size: number, context: string): void {
    this.ensure(size, context);
    this.pos += size;
  }

  uint8(context: string): number {
    this.ensure(1, context);
    return this.view.getUint8(this.pos++);
  }

  int32(context: string): number {
    this.ensure(4, context);
    const value = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return value;
  }

  uint32(context: string): number {
    this.ensure(4, context);
    const value = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return value;
  }

  uint32BE(context: string): number {
    this.ensure(4, context);
    const value = this.view.getUint32(this.pos, false);
    this.pos += 4;
    return value;
  }

  uint64BE(context: string): bigint {
    this.ensure(8, context);
    const value = this.view.getBigUint64(this.pos, false);
    this.pos += 8;
    return value;
  }

  float32(context: string): number {
    this.ensure(4, context);
    const value = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return value;
  }

  raw(size: number, context: string): Uint8Array {
    this.ensure(size, context);
    const value = this.bytes.subarray(this.pos, this.pos + size);
    this.pos += size;
    return value;
  }

  /** An FString: positive length is UTF-8 bytes, negative is UTF-16 code units, zero is empty. */
  fstring(context: string): string {
    const start = this.pos;
    const length = this.int32(`${context} length`);
    if (length === 0) return "";
    if (Math.abs(length) > 16_777_216) {
      throw new UAssetError("TRUNCATED_PACKAGE", `Unreasonable ${context} length`, {
        offset: start,
        length,
      });
    }
    if (length > 0) {
      const data = this.raw(length, context);
      const end = data.length > 0 && data[data.length - 1] === 0 ? data.length - 1 : data.length;
      return utf8.decode(data.subarray(0, end));
    }
    const charCount = -length;
    const data = this.raw(charCount * 2, context);
    const hasNull = data.length >= 2 && data[data.length - 1] === 0 && data[data.length - 2] === 0;
    return utf16.decode(data.subarray(0, hasNull ? data.length - 2 : data.length));
  }
}
