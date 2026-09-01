export type {
  AssetKind,
  IAssetCompileOptions,
  IAssetCompileResult,
  IAssetPass,
  IAssetPassOutput,
  IAssetSourceConfig,
  IAssetTargets,
  IBakeReceipt,
  IBakeReceiptOutput,
  IBasisTranscoder,
  IModelsConfig,
  ITexturesConfig,
} from "./compile.js";
/**
 * Compiles a project's source assets into content-addressed runtime files and a manifest.
 * @situation compile game assets before a web or native build
 * @situation optimize textures for the GPU
 * @situation produce a manifest for runtime asset loading
 * @constraint source and output directories must be disjoint; a pass failure stops the build with the asset path
 * @example const result = await compileAssets({ source: "assets", output: "public" });
 */
export { compileAssets } from "./compile.js";

/**
 * Finds Three.js's Basis Universal transcoder files for the runtime KTX2 loader.
 * @situation prepare compressed textures for runtime loading
 * @situation copy the Basis transcoder into a compiled asset output
 * @constraint the supplied working directory must resolve both basis_transcoder.js and basis_transcoder.wasm from its Three.js installation
 * @example const transcoder = resolveBasisTranscoder(process.cwd());
 */
export { resolveBasisTranscoder } from "./compile.js";
export type {
  IEmbeddedTextureSummary,
  IModelPassOptions,
  IModelPassesOptions,
  IModelQuantizeOptions,
  IModelSimplifyOptions,
  IModelSimplifySummary,
  IModelTextureBinding,
  IModelTextureBindings,
  IModelTextureOverride,
  IModelTexturesOptions,
} from "./passes/model.js";
/**
 * Optimizes self-contained GLB models through the configured geometry and embedded-texture passes.
 * @situation reduce a model's download and GPU footprint
 * @situation optimize a GLB before shipping it with a game
 * @constraint the pass self-verifies reachable geometry, animation, bounds, and embedded texture bindings before returning output
 * @example const pass = modelPass({ simplify: { ratio: 0.5 } });
 */
export { modelPass } from "./passes/model.js";
export type { ILightmapPassOptions } from "./passes/lightmap.js";
/**
 * Generates lightmap UVs and bakes a static GLB's lightmap atlas.
 * @situation add baked static lighting to a model
 * @situation generate TEXCOORD_1 data for a lightmapped scene
 * @constraint the input must be a static self-contained GLB with at least one punctual light
 * @example const pass = lightmapPass({ atlasSize: 1024, padding: 2 });
 */
export { lightmapPass } from "./passes/lightmap.js";
export type { ITextureOverride, ITexturePassOptions, TextureCodec } from "./passes/texture.js";
/**
 * Encodes standalone textures as mipmapped KTX2/Basis assets for GPU storage.
 * @situation optimize textures for the GPU
 * @situation compress PNG or JPEG files before runtime loading
 * @constraint compressed source width and height must each be divisible by 4; use a codec "none" override for an intentionally unaligned texture
 * @example const pass = texturePass({ quality: 150 });
 */
export { texturePass } from "./passes/texture.js";
export type {
  IEmbeddedTextureRow,
  IModelSizeRow,
  ISimplifyRow,
  ITextureSizeRow,
} from "./report.js";
/**
 * Formats model byte, geometry, and embedded-texture measurements for a build report.
 * @situation inspect how model optimization changed file and GPU sizes
 * @situation print model compression results after an asset build
 * @constraint rows must use bytes before and after from the same compiled input
 * @example const lines = formatModelSizes(modelRows);
 */
export { formatModelSizes } from "./report.js";

/**
 * Formats standalone texture byte measurements for a build report.
 * @situation inspect texture compression savings
 * @situation print which codec a compiled texture uses
 * @constraint an empty row list produces no report lines
 * @example const lines = formatTextureSizes(textureRows);
 */
export { formatTextureSizes } from "./report.js";
export type { IPngInfo } from "./png.js";
/**
 * Reads dimensions and alpha metadata from a PNG signature and IHDR header.
 * @situation inspect a PNG before choosing a texture codec
 * @situation read source texture dimensions in an asset health check
 * @constraint non-PNG or truncated bytes return undefined instead of being treated as a valid image
 * @example const png = parsePng(bytes); if (png !== undefined) console.log(png.width, png.height);
 */
export { parsePng } from "./png.js";
export type {
  AssetFindingGrade,
  IAssetFinding,
  IAssetHealthEntry,
  IAssetHealthInput,
  IAssetHealthReport,
  IModelStats,
  ITextureStats,
} from "./health.js";
/**
 * Formats asset health findings and their summary for human-readable output.
 * @situation print asset size, license, and target findings after compilation
 * @situation show why an asset health check is warning or failing
 * @constraint the returned lines describe findings; target enforcement happens in runHealthReport
 * @example const lines = formatHealthReport(report);
 */
export { formatHealthReport } from "./health.js";

/**
 * Measures compiled assets and grades them against declared project targets.
 * @situation check asset dimensions, triangles, materials, and licenses
 * @situation enforce asset budgets during a build
 * @constraint a finding is fail-grade only when the corresponding project target was declared
 * @example const report = await runHealthReport(inputs, { maxTextureDimension: 2048 });
 */
export { runHealthReport } from "./health.js";
export type { IAssetWatchHandle, IAssetWatchOptions, IAssetWatchSummary } from "./watch.js";
/**
 * Watches an asset source directory and recompiles settled changes during development.
 * @situation recompile a changed texture without restarting the dev server
 * @situation see asset pipeline failures as files are saved
 * @constraint call close on the returned handle; initial and burst failures are reported without stopping the dev server
 * @example const watcher = watchAssets({ cwd: process.cwd() });
 */
export { watchAssets } from "./watch.js";
