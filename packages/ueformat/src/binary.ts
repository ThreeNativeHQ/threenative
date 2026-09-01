import { UEFormatError } from "./errors.js";
import type { IQuaternion, IVector2, IVector3 } from "./types.js";

export interface IReaderLimits {
  maxStringBytes: number;
  maxArrayElements: number;
  maxAttributes: number;
}

export class BinaryReader {
  readonly bytes: Uint8Array;
  readonly limits: IReaderLimits;
  readonly baseOffset: number;
  private readonly view: DataView;
  offset = 0;

  constructor(bytes: Uint8Array, limits: IReaderLimits, baseOffset = 0) {
    this.bytes = bytes;
    this.limits = limits;
    this.baseOffset = baseOffset;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  get absoluteOffset(): number {
    return this.baseOffset + this.offset;
  }

  ensure(size: number): void {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.remaining) {
      throw new UEFormatError(
        "TRUNCATED_FILE",
        `Need ${size} byte(s), but only ${this.remaining} remain`,
        this.absoluteOffset,
      );
    }
  }

  uint8(): number {
    this.ensure(1);
    return this.view.getUint8(this.offset++);
  }

  bool(): boolean {
    const value = this.uint8();
    if (value > 1) {
      throw new UEFormatError(
        "INVALID_LENGTH",
        `Invalid boolean value ${value}`,
        this.absoluteOffset - 1,
      );
    }
    return value === 1;
  }

  uint16(): number {
    this.ensure(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  int32(): number {
    this.ensure(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  uint32(): number {
    this.ensure(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  float32(): number {
    this.ensure(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  raw(size: number): Uint8Array {
    this.ensure(size);
    const result = this.bytes.subarray(this.offset, this.offset + size);
    this.offset += size;
    return result;
  }

  fixedString(size: number): string {
    return new TextDecoder("utf-8", { fatal: true }).decode(this.raw(size)).replace(/\0+$/, "");
  }

  string(): string {
    const start = this.absoluteOffset;
    const size = this.int32();
    if (size < 0 || size > this.limits.maxStringBytes) {
      throw new UEFormatError("INVALID_LENGTH", `Invalid string byte length ${size}`, start);
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(this.raw(size)).replace(/\0+$/, "");
    } catch (error) {
      if (error instanceof UEFormatError) throw error;
      throw new UEFormatError("INVALID_LENGTH", "String is not valid UTF-8", start, error);
    }
  }

  count(label: string): number {
    const start = this.absoluteOffset;
    const count = this.int32();
    if (count < 0 || count > this.limits.maxArrayElements) {
      throw new UEFormatError("INVALID_COUNT", `Invalid ${label} count ${count}`, start);
    }
    return count;
  }

  vector2(): IVector2 {
    return { u: this.float32(), v: this.float32() };
  }

  vector3(): IVector3 {
    return { x: this.float32(), y: this.float32(), z: this.float32() };
  }

  quaternion(): IQuaternion {
    return { ...this.vector3(), w: this.float32() };
  }

  array<T>(label: string, read: (reader: BinaryReader, index: number) => T): T[] {
    const count = this.count(label);
    const values = new Array<T>(count);
    for (let index = 0; index < count; index++) values[index] = read(this, index);
    return values;
  }

  chunk(size: number): BinaryReader {
    const start = this.absoluteOffset;
    return new BinaryReader(this.raw(size), this.limits, start);
  }
}

export function toUint8Array(input: ArrayBuffer | ArrayBufferView): Uint8Array {
  return input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}
