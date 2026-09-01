import { gzipSync } from "fflate";

export class Writer {
  readonly chunks: Uint8Array[] = [];

  bytes(value: Uint8Array | number[]): this {
    this.chunks.push(value instanceof Uint8Array ? value : Uint8Array.from(value));
    return this;
  }

  uint8(value: number): this {
    return this.bytes([value]);
  }

  uint16(value: number): this {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    return this.bytes(bytes);
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

  float32(value: number): this {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, value, true);
    return this.bytes(bytes);
  }

  string(value: string): this {
    const bytes = new TextEncoder().encode(value);
    return this.int32(bytes.length).bytes(bytes);
  }

  vector(x: number, y: number, z: number): this {
    return this.float32(x).float32(y).float32(z);
  }

  quat(x: number, y: number, z: number, w: number): this {
    return this.float32(x).float32(y).float32(z).float32(w);
  }

  array<T>(values: readonly T[], write: (writer: Writer, value: T) => void): this {
    this.int32(values.length);
    for (const value of values) write(this, value);
    return this;
  }

  finish(): Uint8Array {
    const length = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}

export function attributeSet(attributes: Record<string, Uint8Array>): Uint8Array {
  const writer = new Writer().int32(Object.keys(attributes).length);
  for (const [name, payload] of Object.entries(attributes)) {
    writer.string(name).int32(payload.length).bytes(payload);
  }
  return writer.finish();
}

export interface IFixtureOptions {
  compressed?: false | "GZIP" | "ZSTD";
  zstdBytes?: Uint8Array;
  version?: number;
  identifier?: string;
  body?: Uint8Array;
  objectName?: string;
  objectPath?: string;
  compressionFormat?: string;
  declaredUncompressedSize?: number;
  declaredCompressedSize?: number;
}

export function modelFile(options: IFixtureOptions = {}): Uint8Array {
  const body = options.body ?? attributeSet({});
  const compression = options.compressed ?? false;
  const writer = new Writer()
    .bytes(new TextEncoder().encode("UEFORMAT"))
    .string(options.identifier ?? "UEMODEL")
    .uint8(options.version ?? 10)
    .string(options.objectName ?? "SM_Test")
    .string(options.objectPath ?? "/Game/Test/SM_Test.SM_Test")
    .uint8(compression ? 1 : 0);

  if (!compression) return writer.bytes(body).finish();

  const compressed =
    compression === "GZIP" ? gzipSync(body) : (options.zstdBytes ?? Uint8Array.of(1, 2, 3));
  return writer
    .string(options.compressionFormat ?? compression)
    .int32(options.declaredUncompressedSize ?? body.length)
    .int32(options.declaredCompressedSize ?? compressed.length)
    .bytes(compressed)
    .finish();
}

export function triangleLod(
  name = "LOD0",
  extraAttributes: Record<string, Uint8Array> = {},
): Uint8Array {
  const vertices = new Writer()
    .array(
      [
        [0, 0, 0],
        [100, 0, 0],
        [0, 100, 0],
      ] as const,
      (writer, value) => writer.vector(value[0], value[1], value[2]),
    )
    .finish();
  const normals = new Writer()
    .array(
      [
        [1, 0, 0, 1],
        [1, 0, 0, 1],
        [1, 0, 0, 1],
      ] as const,
      (writer, value) => writer.float32(value[0]).vector(value[1], value[2], value[3]),
    )
    .finish();
  const tangents = new Writer()
    .array(
      [
        [1, 0, 0],
        [1, 0, 0],
        [1, 0, 0],
      ] as const,
      (writer, value) => writer.vector(value[0], value[1], value[2]),
    )
    .finish();
  const texcoords = new Writer()
    .int32(1)
    .string("UV0")
    .array(
      [
        [0, 0],
        [1, 0],
        [0, 1],
      ] as const,
      (writer, value) => writer.float32(value[0]).float32(value[1]),
    )
    .finish();
  const indices = new Writer().array([0, 1, 2], (writer, value) => writer.uint32(value)).finish();
  const colors = new Writer()
    .int32(1)
    .string("Color")
    .int32(3)
    .bytes([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255])
    .finish();
  const materials = new Writer()
    .int32(1)
    .string("M_Table")
    .string("/Game/Materials/M_Table.M_Table")
    .int32(0)
    .int32(1)
    .finish();

  return new Writer()
    .string(name)
    .bytes(
      attributeSet({
        VERTICES: vertices,
        NORMALS: normals,
        TANGENTS: tangents,
        TEXCOORDS: texcoords,
        INDICES: indices,
        VERTEXCOLORS: colors,
        MATERIALS: materials,
        ...extraAttributes,
      }),
    )
    .finish();
}

export function staticModelBody(lods = [triangleLod()]): Uint8Array {
  return attributeSet({
    LODS: new Writer().array(lods, (writer, lod) => writer.bytes(lod)).finish(),
  });
}

export function skinAttributes(): Record<string, Uint8Array> {
  const weights = new Writer()
    .int32(3)
    .uint16(0)
    .int32(0)
    .float32(1)
    .uint16(1)
    .int32(1)
    .float32(0.75)
    .uint16(0)
    .int32(1)
    .float32(0.25)
    .finish();
  const morphs = new Writer()
    .int32(1)
    .string("Bent")
    .int32(1)
    .vector(0, 0, 5)
    .vector(0, 0, 0.1)
    .uint32(2)
    .finish();
  return { WEIGHTS: weights, MORPHTARGETS: morphs };
}

export function skeletonPayload(): Uint8Array {
  const metadata = new Writer().string("/Game/Test/Skeleton.Skeleton").finish();
  const bones = new Writer()
    .int32(2)
    .string("root")
    .int32(-1)
    .vector(0, 0, 0)
    .quat(0, 0, 0, 1)
    .vector(1, 1, 1)
    .string("child")
    .int32(0)
    .vector(0, 0, 10)
    .quat(0, 0, 0, 1)
    .vector(1, 1, 1)
    .finish();
  const sockets = new Writer()
    .int32(1)
    .string("Grip")
    .string("child")
    .vector(1, 2, 3)
    .quat(0, 0, 0, 1)
    .vector(1, 1, 1)
    .finish();
  const virtualBones = new Writer()
    .int32(1)
    .string("root")
    .string("child")
    .string("VB root_child")
    .finish();
  return attributeSet({
    METADATA: metadata,
    BONES: bones,
    SOCKETS: sockets,
    VIRTUALBONES: virtualBones,
  });
}

export function collisionPayload(): Uint8Array {
  return new Writer()
    .int32(1)
    .string("Box")
    .int32(3)
    .vector(0, 0, 0)
    .vector(10, 0, 0)
    .vector(0, 10, 0)
    .int32(3)
    .uint32(0)
    .uint32(1)
    .uint32(2)
    .finish();
}

export function richModelBody(): Uint8Array {
  return attributeSet({
    LODS: new Writer()
      .array([triangleLod("LOD0", skinAttributes())], (writer, lod) => writer.bytes(lod))
      .finish(),
    SKELETON: skeletonPayload(),
    COLLISION: collisionPayload(),
  });
}
