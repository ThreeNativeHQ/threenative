export interface IVector2 {
  u: number;
  v: number;
}

export interface IVector3 {
  x: number;
  y: number;
  z: number;
}

export interface IQuaternion extends IVector3 {
  w: number;
}

export interface IUEFormatCompression {
  format: "GZIP" | "ZSTD";
  uncompressedSize: number;
  compressedSize: number;
}

export interface IUEFormatHeader {
  magic: "UEFORMAT";
  identifier: "UEMODEL";
  fileVersion: 10;
  objectName: string;
  objectPath: string;
  compression: IUEFormatCompression | null;
}

export interface IUEModelNormal extends IVector3 {
  binormalSign: number;
}

export interface IUEModelTexCoord {
  name: string;
  uvs: IVector2[];
}

export interface IUEModelVertexColor {
  name: string;
  colors: Array<{ r: number; g: number; b: number; a: number }>;
}

export interface IUEModelMaterial {
  materialName: string;
  materialPath: string;
  firstIndex: number;
  numFaces: number;
}

export interface IUEModelWeight {
  boneIndex: number;
  vertexIndex: number;
  weight: number;
}

export interface IUEModelMorphDelta {
  positionDelta: IVector3;
  tangentZDelta: IVector3;
  vertexIndex: number;
}

export interface IUEModelMorphTarget {
  name: string;
  deltas: IUEModelMorphDelta[];
}

export interface IUEModelLOD {
  name: string;
  vertices: IVector3[];
  normals: IUEModelNormal[];
  tangents: IVector3[];
  texCoords: IUEModelTexCoord[];
  indices: number[];
  vertexColors: IUEModelVertexColor[];
  materials: IUEModelMaterial[];
  weights: IUEModelWeight[];
  morphTargets: IUEModelMorphTarget[];
  unknownAttributes: string[];
}

export interface IUEModelBone {
  name: string;
  parentIndex: number;
  position: IVector3;
  orientation: IQuaternion;
  scale: IVector3;
}

export interface IUEModelSocket {
  name: string;
  boneName: string;
  relativeLocation: IVector3;
  relativeRotation: IQuaternion;
  relativeScale: IVector3;
}

export interface IUEModelVirtualBone {
  sourceBoneName: string;
  targetBoneName: string;
  virtualBoneName: string;
}

export interface IUEModelSkeleton {
  metadata: string;
  bones: IUEModelBone[];
  sockets: IUEModelSocket[];
  virtualBones: IUEModelVirtualBone[];
  unknownAttributes: string[];
}

export interface IUEModelCollision {
  name: string;
  vertices: IVector3[];
  indices: number[];
}

export interface IUEModelData {
  header: IUEFormatHeader;
  lods: IUEModelLOD[];
  skeleton: IUEModelSkeleton | null;
  collision: IUEModelCollision[];
  unknownAttributes: string[];
}

export type ZstdDecoder = (compressed: Uint8Array, uncompressedSize: number) => Uint8Array;

export interface IParseUEModelOptions {
  zstdDecoder?: ZstdDecoder;
  maxStringBytes?: number;
  maxArrayElements?: number;
  maxAttributes?: number;
}
