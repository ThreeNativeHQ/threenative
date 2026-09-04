/**
 * Parses a raw Unreal editor `.uasset` static mesh into validated, plain typed arrays — UE5
 * `FMeshDescription` payloads (including the Oodle-compressed package-trailer form) and the
 * UE4.18-era `FRawMesh` source-model layout, with no interchange conversion at any step.
 * @situation load a raw Unreal editor .uasset mesh in the browser without conversion
 * @situation decode a Fab pack's UE4.18 static meshes straight from their .uasset files
 * @constraint only legacy-tag uncooked editor packages are read; IoStore (.utoc/.ucas), PAK archives, cooked render buffers, Nanite, and skeletal data throw UAssetError
 * @constraint the format layer never invents fallback geometry; every malformed or unsupported layout surfaces as UAssetError with its byte offset or counts
 * @example const decoded = parseUAssetStaticMesh(await file.arrayBuffer(), { oodle });
 */
export { parseUAssetStaticMesh } from "./static-mesh.js";
/**
 * Reads the fixed prefix of `FPackageFileSummary` — the legacy tag, engine versions, and the
 * custom-version list — without walking the name map, export map, or dependency graph.
 * @situation report which engine generation a .uasset was written by before decoding it
 * @situation reject a non-Unreal file with the stable INVALID_PACKAGE_TAG error
 * @constraint only the summary prefix is read; locating payload data is the payload readers' self-validating signature scans
 * @example const summary = readPackageSummary(bytes);
 */
export { readPackageSummary, PACKAGE_FILE_TAG } from "./package-summary.js";
/**
 * Walks the whole `FPackageFileSummary` for the offsets bulk data is addressed against —
 * `TotalHeaderSize` and `BulkDataStartOffset` — and returns `undefined` when the walk cannot be
 * trusted.
 * @situation find where a .uasset's export data and bulk-data region begin
 * @constraint returns undefined rather than guessing when the summary does not end on its own name table, or when the package uses a LegacyFileVersion this walk does not model
 * @example const layout = readPackageLayout(bytes); if (layout) readBulk(layout.bulkDataStartOffset);
 */
export { readPackageLayout, type IPackageLayout } from "./package-summary.js";
/**
 * Reads the `FByteBulkData` headers an editor package serializes into its export data, and
 * resolves each payload — inline, at the end of the package, or in a sibling `.ubulk`/`.uptnl`
 * file whose bytes the caller supplies — decompressing `FArchive::SerializeCompressed` blocks.
 * @situation read a UE4 editor static mesh whose source model lives in bulk data rather than inline
 * @situation decompress the zlib-chunked bulk payload a UE4.2x package stores its MeshDescription in
 * @constraint zlib payloads require an injected `zlib` codec; the package never bundles one, and a missing codec throws MISSING_CODEC instead of guessing
 * @constraint a payload written to a sibling file throws MISSING_BULK_DATA_FILE naming that file, rather than inventing geometry
 * @example const payload = resolveBulkDataPayload(bytes, header, { zlib });
 */
export {
  BULK_DATA_FLAG,
  decompressBulkData,
  findBulkDataHeaders,
  parseBulkDataHeader,
  resolveBulkDataPayload,
  type IBulkDataHeader,
} from "./bulk-data.js";
/**
 * Parses the UE4.2x serialization of `FMeshDescription` — fixed-order element containers, and a
 * triangle container that trails the attribute sets rather than sitting with its siblings.
 * @situation decode the MeshDescription a UE 4.23-4.27 editor package keeps in bulk data
 * @constraint the walk must consume the payload exactly; a short walk throws rather than returning the geometry it managed to read
 * @example const description = parseMeshDescriptionUe4(payload);
 */
export {
  looksLikeMeshDescriptionUe4,
  parseMeshDescriptionUe4,
  type IUe4MeshDescription,
} from "./mesh-description-ue4.js";
/**
 * Parses one UE5 `FCompressedBuffer` and decompresses it block-by-block with the codecs the
 * caller injected — uncompressed payloads are handled natively.
 * @situation decompress the package-trailer payload that carries a UE5 MeshDescription
 * @constraint Oodle and LZ4 payloads require an injected codec; the package never bundles one, and a missing codec throws MISSING_CODEC instead of guessing
 * @example const payload = decompressCompressedBuffer(parseCompressedBuffer(bytes, offset), { oodle });
 */
export {
  decompressCompressedBuffer,
  findCompressedBufferOffsets,
  parseCompressedBuffer,
  COMPRESSED_BUFFER_MAGIC,
  COMPRESSION_METHOD,
} from "./compressed-buffer.js";
/**
 * Parses a serialized `FMeshDescription` — element containers, allocation bit arrays, and
 * attribute sets — into validated typed arrays, exactly consuming its byte range.
 * @situation inspect the vertex, triangle, and polygon-group structure of a UE5 MeshDescription
 * @constraint every count is validated against its neighbors before any geometry is built
 * @example const description = parseMeshDescription(payload, offset);
 */
export {
  findMeshDescriptionOffsets,
  looksLikeMeshDescription,
  parseMeshDescription,
} from "./mesh-description.js";
/**
 * Parses one `FRawMesh` blob — the UE4.18-era source-model layout — validating that the fixed
 * eighteen-array walk consumes the blob exactly and every count agrees with the wedge totals.
 * @situation read the source geometry of a Fab pack saved by UE 4.18 straight from its .uasset
 * @constraint only inline uncompressed blobs are found; compressed or external bulk data throws rather than guessing
 * @example const blob = parseRawMesh(bytes, offset);
 */
export { findRawMeshBlobs, parseRawMesh } from "./raw-mesh.js";
/**
 * Converts a decoded `.uasset` static mesh into a `THREE.BufferGeometry`, with one draw group
 * per material section.
 * @situation build custom scene objects from Unreal mesh data instead of a whole mesh
 * @situation hand a decoded Unreal mesh to a framework pipeline that owns materials itself
 * @constraint materials are never chosen here; the geometry carries groups, the game carries materials
 * @example const geometry = createThreeGeometry(parseUAssetStaticMesh(buffer));
 */
export { createThreeGeometry } from "./three-adapter.js";
/**
 * Converts a decoded `.uasset` static mesh into a renderable `THREE.Mesh` with provenance in
 * `userData.unreal` and material selection left to the game's `materialFactory`.
 * @situation put a raw .uasset mesh on screen without converting it to glTF first
 * @situation key materials to a package's own sections by name or section index
 * @constraint the fallback is three.js's own plain MeshStandardMaterial; every real material comes from the game
 * @example const mesh = createThreeObject(decoded, { materialFactory: (d) => d.sections.map(() => barkMaterial) });
 */
export { createThreeObject } from "./three-adapter.js";
/**
 * Loads a raw Unreal `.uasset` static mesh as a three.js loader — `load(url)` for the browser,
 * `parse(data)` for bytes you already hold — with parse and adapter options passed through.
 * @situation load a .uasset asset in the browser with the standard three.js loader protocol
 * @situation hand raw Fab-pack meshes to the framework's asset loading without a conversion step
 * @constraint UE5 Oodle payloads require an `oodle` codec in the parse options; see README licensing
 * @example const mesh = new UAssetLoader(manager, { parse: { oodle } }).parse(data);
 */
export { UAssetLoader, type IUAssetLoaderOptions } from "./loader.js";
export type {
  IDecodedUAssetStaticMesh,
  IUAssetBulkDataFiles,
  IUAssetBulkDataInfo,
  UAssetBulkDataFile,
  UAssetBulkDataStorage,
  ZlibCodec,
  IUAssetBounds,
  IUAssetCompressedBufferInfo,
  IUAssetMetadata,
  IUAssetParseOptions,
  IUAssetSection,
  IUAssetSourceStats,
  IUAssetUnrealInfo,
  Lz4Codec,
  OodleCodec,
  UAssetMeshLayout,
} from "./types.js";
export { UAssetError, type UAssetErrorCode } from "./errors.js";
