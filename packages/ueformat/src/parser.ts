import { BinaryReader, type IReaderLimits, toUint8Array } from "./binary.js";
import { decompressBody } from "./decompression.js";
import { UEFormatError } from "./errors.js";
import type {
  IParseUEModelOptions,
  IUEFormatHeader,
  IUEModelBone,
  IUEModelCollision,
  IUEModelData,
  IUEModelLOD,
  IUEModelSkeleton,
  IVector3,
} from "./types.js";

const DEFAULT_LIMITS: IReaderLimits = {
  maxStringBytes: 16 * 1024 * 1024,
  maxArrayElements: 50_000_000,
  maxAttributes: 100_000,
};

type AttributeHandler = (payload: BinaryReader) => void;

function readAttributes(
  reader: BinaryReader,
  handlers: Record<string, AttributeHandler>,
  unknown: string[],
): void {
  const count = reader.int32();
  if (count < 0 || count > reader.limits.maxAttributes) {
    throw new UEFormatError(
      "INVALID_COUNT",
      `Invalid attribute count ${count}`,
      reader.absoluteOffset - 4,
    );
  }

  for (let index = 0; index < count; index++) {
    const name = reader.string();
    const byteSizeOffset = reader.absoluteOffset;
    const byteSize = reader.int32();
    if (byteSize < 0) {
      throw new UEFormatError(
        "INVALID_LENGTH",
        `Invalid byte size ${byteSize} for attribute ${name}`,
        byteSizeOffset,
      );
    }
    const payload = reader.chunk(byteSize);
    const handler = handlers[name];
    if (!handler) {
      unknown.push(name);
      continue;
    }
    handler(payload);
    if (payload.remaining !== 0) {
      throw new UEFormatError(
        "ATTRIBUTE_SIZE_MISMATCH",
        `Attribute ${name} has ${payload.remaining} unread byte(s)`,
        payload.absoluteOffset,
      );
    }
  }
}

function readVectorArray(reader: BinaryReader, label: string): IVector3[] {
  return reader.array(label, (item) => item.vector3());
}

function readLod(reader: BinaryReader): IUEModelLOD {
  const lod: IUEModelLOD = {
    name: reader.string(),
    vertices: [],
    normals: [],
    tangents: [],
    texCoords: [],
    indices: [],
    vertexColors: [],
    materials: [],
    weights: [],
    morphTargets: [],
    unknownAttributes: [],
  };

  readAttributes(
    reader,
    {
      VERTICES(payload) {
        lod.vertices = readVectorArray(payload, "vertex");
      },
      INDICES(payload) {
        lod.indices = payload.array("index", (item) => item.uint32());
      },
      NORMALS(payload) {
        lod.normals = payload.array("normal", (item) => ({
          binormalSign: item.float32(),
          ...item.vector3(),
        }));
      },
      TANGENTS(payload) {
        lod.tangents = readVectorArray(payload, "tangent");
      },
      TEXCOORDS(payload) {
        lod.texCoords = payload.array("texture-coordinate channel", (item) => ({
          name: item.string(),
          uvs: item.array("texture coordinate", (uvReader) => uvReader.vector2()),
        }));
      },
      VERTEXCOLORS(payload) {
        lod.vertexColors = payload.array("vertex-color channel", (item) => ({
          name: item.string(),
          colors: item.array("vertex color", (colorReader) => ({
            r: colorReader.uint8(),
            g: colorReader.uint8(),
            b: colorReader.uint8(),
            a: colorReader.uint8(),
          })),
        }));
      },
      MATERIALS(payload) {
        lod.materials = payload.array("material", (item) => ({
          materialName: item.string(),
          materialPath: item.string(),
          firstIndex: item.int32(),
          numFaces: item.int32(),
        }));
      },
      WEIGHTS(payload) {
        lod.weights = payload.array("weight", (item) => ({
          boneIndex: item.uint16(),
          vertexIndex: item.int32(),
          weight: item.float32(),
        }));
      },
      MORPHTARGETS(payload) {
        lod.morphTargets = payload.array("morph target", (item) => ({
          name: item.string(),
          deltas: item.array("morph delta", (deltaReader) => ({
            positionDelta: deltaReader.vector3(),
            tangentZDelta: deltaReader.vector3(),
            vertexIndex: deltaReader.uint32(),
          })),
        }));
      },
    },
    lod.unknownAttributes,
  );
  return lod;
}

function readBone(reader: BinaryReader): IUEModelBone {
  return {
    name: reader.string(),
    parentIndex: reader.int32(),
    position: reader.vector3(),
    orientation: reader.quaternion(),
    scale: reader.vector3(),
  };
}

function readSkeleton(reader: BinaryReader): IUEModelSkeleton {
  const skeleton: IUEModelSkeleton = {
    metadata: "",
    bones: [],
    sockets: [],
    virtualBones: [],
    unknownAttributes: [],
  };
  readAttributes(
    reader,
    {
      METADATA(payload) {
        skeleton.metadata = payload.string();
      },
      BONES(payload) {
        skeleton.bones = payload.array("bone", (item) => readBone(item));
      },
      SOCKETS(payload) {
        skeleton.sockets = payload.array("socket", (item) => ({
          name: item.string(),
          boneName: item.string(),
          relativeLocation: item.vector3(),
          relativeRotation: item.quaternion(),
          relativeScale: item.vector3(),
        }));
      },
      VIRTUALBONES(payload) {
        skeleton.virtualBones = payload.array("virtual bone", (item) => ({
          sourceBoneName: item.string(),
          targetBoneName: item.string(),
          virtualBoneName: item.string(),
        }));
      },
    },
    skeleton.unknownAttributes,
  );
  return skeleton;
}

function readCollision(reader: BinaryReader): IUEModelCollision {
  return {
    name: reader.string(),
    vertices: readVectorArray(reader, "collision vertex"),
    indices: reader.array("collision index", (item) => item.uint32()),
  };
}

export function parseUEModel(
  input: ArrayBuffer | ArrayBufferView,
  options: IParseUEModelOptions = {},
): IUEModelData {
  const limits: IReaderLimits = {
    maxStringBytes: options.maxStringBytes ?? DEFAULT_LIMITS.maxStringBytes,
    maxArrayElements: options.maxArrayElements ?? DEFAULT_LIMITS.maxArrayElements,
    maxAttributes: options.maxAttributes ?? DEFAULT_LIMITS.maxAttributes,
  };
  const reader = new BinaryReader(toUint8Array(input), limits);
  const magic = reader.fixedString(8);
  if (magic !== "UEFORMAT") {
    throw new UEFormatError(
      "INVALID_MAGIC",
      `Expected UEFORMAT, received ${JSON.stringify(magic)}`,
      0,
    );
  }
  const identifier = reader.string();
  if (identifier !== "UEMODEL") {
    throw new UEFormatError(
      "INVALID_IDENTIFIER",
      `Expected UEMODEL, received ${JSON.stringify(identifier)}`,
      8,
    );
  }
  const fileVersion = reader.uint8();
  if (fileVersion !== 10) {
    throw new UEFormatError(
      "UNSUPPORTED_VERSION",
      `Only UEFormat v10 is supported; received v${fileVersion}`,
      reader.absoluteOffset - 1,
    );
  }
  const objectName = reader.string();
  const objectPath = reader.string();
  const compressed = reader.bool();
  let bodyReader = reader;
  let compression: IUEFormatHeader["compression"] = null;
  if (compressed) {
    const format = reader.string();
    const uncompressedSize = reader.int32();
    const compressedSize = reader.int32();
    if (uncompressedSize < 0 || compressedSize < 0) {
      throw new UEFormatError(
        "INVALID_LENGTH",
        "Compression sizes must be non-negative",
        reader.absoluteOffset - 8,
      );
    }
    if (compressedSize !== reader.remaining) {
      throw new UEFormatError(
        "SIZE_MISMATCH",
        `Compressed body has ${reader.remaining} byte(s); header declares ${compressedSize}`,
        reader.absoluteOffset,
      );
    }
    if (format !== "GZIP" && format !== "ZSTD") {
      throw new UEFormatError(
        "INVALID_COMPRESSION",
        `Unsupported compression format ${JSON.stringify(format)}`,
        reader.absoluteOffset,
      );
    }
    const decoded = decompressBody(
      format,
      reader.raw(compressedSize),
      uncompressedSize,
      options.zstdDecoder,
    );
    bodyReader = new BinaryReader(decoded, limits);
    compression = { format, uncompressedSize, compressedSize };
  }

  const header: IUEFormatHeader = {
    magic: "UEFORMAT",
    identifier: "UEMODEL",
    fileVersion: 10,
    objectName,
    objectPath,
    compression,
  };
  const model: IUEModelData = {
    header,
    lods: [],
    skeleton: null,
    collision: [],
    unknownAttributes: [],
  };
  readAttributes(
    bodyReader,
    {
      LODS(payload) {
        model.lods = payload.array("LOD", (item) => readLod(item));
      },
      SKELETON(payload) {
        model.skeleton = readSkeleton(payload);
      },
      COLLISION(payload) {
        model.collision = payload.array("collision mesh", (item) => readCollision(item));
      },
    },
    model.unknownAttributes,
  );
  if (bodyReader.remaining !== 0) {
    throw new UEFormatError(
      "ATTRIBUTE_SIZE_MISMATCH",
      `Model has ${bodyReader.remaining} trailing byte(s)`,
      bodyReader.absoluteOffset,
    );
  }
  return model;
}
