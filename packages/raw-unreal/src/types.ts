/** Signature of an Oodle decompressor, matching the `decompress(compressed, rawSize)` shape the
 * common WebAssembly Oodle builds expose. The package never bundles one; see README licensing. */
export type OodleCodec = (compressed: Uint8Array, rawSize: number) => Uint8Array;

/** Signature of an LZ4 block decompressor. The package never bundles one. */
export type Lz4Codec = (compressed: Uint8Array, rawSize: number) => Uint8Array;

/** Signature of a zlib (RFC 1950) decompressor, the form editor bulk data is stored in when the
 * `BULKDATA_SerializeCompressedZLIB` flag is set. The package never bundles one; `node:zlib`'s
 * `inflateSync` and any of the small browser inflate libraries fit this shape. */
export type ZlibCodec = (compressed: Uint8Array, rawSize: number) => Uint8Array;

/** Bytes of the package's sibling payload files, for the bulk-data flag that says the payload
 * was written beside the `.uasset` rather than inside it. The parser stays a pure format layer:
 * it never opens a file, so a caller that has these bytes hands them over. */
export interface IUAssetBulkDataFiles {
  uexp?: ArrayBuffer | ArrayBufferView;
  ubulk?: ArrayBuffer | ArrayBufferView;
  uptnl?: ArrayBuffer | ArrayBufferView;
}

export interface IUAssetParseOptions {
  /** Required for UE5 `FCompressedBuffer` payloads compressed with Oodle (method 3). */
  oodle?: OodleCodec;
  /** Required for `FCompressedBuffer` payloads compressed with LZ4 (method 4). */
  lz4?: Lz4Codec;
  /** Required for editor bulk data stored with `BULKDATA_SerializeCompressedZLIB`. */
  zlib?: ZlibCodec;
  /** Sibling `.uexp`/`.ubulk`/`.uptnl` bytes, when a bulk payload lives outside the package. */
  bulkDataFiles?: IUAssetBulkDataFiles;
  /** Convert Unreal's Z-up left-handed coordinates to three.js Y-up. Default true. */
  convertCoordinates?: boolean;
  /** Swap each triangle's second and third indices after conversion. Default true. */
  flipWinding?: boolean;
  /** Flip texture V so three.js sampling matches Unreal's UV convention. Default false. */
  flipV?: boolean;
}

/** One material draw range, already in output index order. */
export interface IUAssetSection {
  materialIndex: number;
  /** The section (polygon-group / face-material) index the package itself records. */
  sectionIndex: number;
  /** The package's material-slot name when the layout carries one; otherwise the section index
   * as a string. Slot-name extraction from FRawMesh packages needs the name map and tagged
   * properties, which this loader does not walk. */
  materialName: string;
  start: number;
  count: number;
}

export interface IUAssetBounds {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

export interface IUAssetSourceStats {
  vertices: number;
  vertexInstances: number;
  triangles: number;
}

/** Which serialized source-model layout the geometry came from. `mesh-description` is the UE5
 * form, whose element containers carry their own names; `mesh-description-ue4` is the UE4.2x
 * form, whose containers are a fixed sequence and whose triangles trail the attribute sets. */
export type UAssetMeshLayout = "mesh-description" | "mesh-description-ue4" | "raw-mesh";

/** Where an `FByteBulkData` payload was stored, per its flags. */
export type UAssetBulkDataStorage = "inline" | "end-of-file" | "separate-file";

/** Which file the payload bytes were read from. */
export type UAssetBulkDataFile = "uasset" | "uexp" | "ubulk" | "uptnl";

export interface IUAssetBulkDataInfo {
  /** Byte offset of the `FByteBulkData` header inside the `.uasset`. */
  headerOffset: number;
  /** `EBulkDataFlags` exactly as serialized. */
  flags: number;
  storage: UAssetBulkDataStorage;
  file: UAssetBulkDataFile;
  compression: "none" | "zlib";
  elementCount: number;
  /** Bytes the payload occupies on disk, compressed size included. */
  sizeOnDisk: number;
  /** The header's own offset field, before the `BulkDataStartOffset` fix-up. */
  offsetInFile: number;
  /** Where the payload actually begins in the file it lives in. */
  payloadOffset: number;
}

export interface IUAssetMetadata {
  assetClass: "StaticMesh";
  engineVersion: string;
  objectPath: string;
  packageByteLength: number;
}

export interface IUAssetCompressedBufferInfo {
  offset: number;
  method: number;
  compressor: number;
  compressionLevel: number;
  rawSize: number;
  compressedSize: number;
  blockCount: number;
}

export interface IUAssetUnrealInfo {
  /** Unreal's legacy package tag, `0x9e2a83c1`. */
  packageTag: number;
  /** `FPackageFileSummary.LegacyFileVersion`, negative (−7 for UE4-era, −8 and below for UE5). */
  legacyFileVersion: number;
  fileVersionUE4?: number;
  fileVersionUE5?: number;
  licenseeVersion?: number;
  /** `FEditorObjectVersion` from the summary's custom-version list, when present. */
  editorObjectVersion?: number;
  layout: UAssetMeshLayout;
  /** Where the decoded source-model payload was found. `frame` names the coordinate system the
   * offset is relative to: the package file itself, the buffer left after decompression, or the
   * resolved bulk-data payload — whose own location is in `bulkData`. */
  payload: {
    frame: "package" | "decompressed" | "bulk-data";
    offset: number;
    byteLength: number;
  };
  compressedBuffer?: IUAssetCompressedBufferInfo;
  bulkData?: IUAssetBulkDataInfo;
}

export interface IDecodedUAssetStaticMesh {
  /** Per-vertex-instance positions, already converted per the parse options. */
  positions: Float32Array;
  /** Per-vertex-instance normals, present when the package carries them. */
  normals: Float32Array | undefined;
  /** Per-vertex-instance UV set 0. */
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
  sections: readonly IUAssetSection[];
  bounds: IUAssetBounds;
  metadata: IUAssetMetadata;
  unreal: IUAssetUnrealInfo;
  sourceStats: IUAssetSourceStats;
}
