import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { assertBudget, measureBudget, parseBudget } from "./budget.js";
import type { IAssetBudget, IAssetRuntimeDecoderCapabilities } from "./budget.js";
import { formatHealthReport, runHealthReport } from "./health.js";
import type { IAssetHealthInput, IAssetHealthReport } from "./health.js";
import { applyPasses } from "./pass-chain.js";
import type { IAppliedPasses, IPassTiming } from "./pass-chain.js";
import { parseAudioConfig } from "./passes/audio-config.js";
import type { IAudioOverride, IAudioPassOptions } from "./passes/audio-config.js";
import { audioPass } from "./passes/audio.js";
import {
  BLENDER_IMPORT_PASS,
  blenderImportPass,
  needsBlenderImport,
} from "./passes/blender-import.js";
import { globMatch } from "./passes/glob.js";
import { lightmapPass } from "./passes/lightmap.js";
import type { ILightmapPassOptions } from "./passes/lightmap.js";
import { modelPass } from "./passes/model.js";
import type {
  IModelPassOptions,
  IModelPassesOptions,
  IModelQuantizeOptions,
  IModelSimplifyOptions,
  IModelTextureOverride,
  IModelTexturesOptions,
  IModelVirtualOptions,
} from "./passes/model.js";
import { createSharedImageStore, unpackGlb } from "./passes/shared-images.js";
import { texturePass } from "./passes/texture.js";
import type { ITextureOverride, ITexturePassOptions, TextureSkipReason } from "./passes/texture.js";
import {
  formatAudioSizes,
  formatBudget,
  formatModelSizes,
  formatPassCosts,
  formatSkippedCompression,
  formatTextureSizes,
} from "./report.js";
import type {
  IAudioRow,
  IEmbeddedTextureRow,
  IModelSizeRow,
  IPassCostAssetRow,
  IPassCostRow,
  ISimplifyRow,
  ISkippedCompressionRow,
  ISkippedReportRow,
  ITextureSizeRow,
  PassCostStatus,
} from "./report.js";
import { createPassPool, resolveConcurrency } from "./worker-pool.js";
import type { PassSpec } from "./worker-protocol.js";

export type AssetKind = "audio" | "model" | "other" | "texture";

/** Budgets a project declares for its assets; exceeding one fails the build. */
export interface IAssetTargets {
  readonly maxMaterials?: number;
  readonly maxTriangles?: number;
  readonly maxTextureDimension?: number;
}

/**
 * What a pass produced for one input. A plain `Buffer` return keeps the identity semantics;
 * the richer shape lets a pass rename the output extension and declare manifest fields for
 * the input it transformed (the KTX2 pass records `format` and `transcodeTargets`).
 */
export interface IAssetPassOutput {
  readonly auxiliaryOutputs?: readonly IAssetAuxiliaryOutput[];
  readonly buffer: Buffer;
  /** Extra manifest fields merged into the entry for the input this output came from. */
  readonly entry?: Readonly<Record<string, unknown>>;
  /** Replaces the source extension in the content-addressed output name when set. */
  readonly outputExtension?: string;
}

export interface IAssetAuxiliaryOutput {
  readonly buffer: Buffer;
  readonly extension: string;
  /** Manifest array receiving this output, for example `lightmaps`. */
  readonly manifestField: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /**
   * An output the pass already content-addressed itself, relative to the output root — the
   * shared image several models reference by the same relative URL. Absent means the compile
   * names it `<stem>.<role>.<digest><extension>` beside the input's own output.
   */
  readonly outputPath?: string;
  /** Stable filename segment, for example `lightmap`. */
  readonly role: string;
}

export interface IAssetPass {
  /** Deterministic settings that change output bytes; omitted for identity/default passes. */
  readonly cacheKey?: string;
  /** True when this pass's emitted output requires a runtime decoder unavailable on mobile. */
  readonly needsRuntimeDecoder?: boolean;
  readonly name: string;
  /**
   * JSON-serializable snapshot of every option that changes this pass's output. Part of the
   * compile cache key: without it, editing a config value (texture quality, quantize bits, an
   * override's codec) leaves the pass name and input hash untouched and the stale output is
   * re-served forever. `undefined` for passes without options.
   */
  readonly configuration?: Readonly<Record<string, unknown>>;
  apply(
    input: Buffer,
    logicalPath: string,
  ): Buffer | IAssetPassOutput | Promise<Buffer | IAssetPassOutput>;
}

export interface IAssetSourceConfig {
  readonly budget?: Partial<IAssetBudget> | number | "none";
  /** Source-relative globs omitted from the build; excluded bytes are always reported. */
  readonly exclude?: readonly string[];
  /**
   * Audio conditioning: an object of options, or the string `"none"` to ship every clip exactly
   * as committed. Absent means conditioning runs with defaults. See `passes/audio-config.ts` for
   * how a game declares which clips loop, which are positional, and what a clip is for.
   */
  readonly audio?: IAudioConfig | "none";
  /**
   * The bound on how many workers a bake may use. A direct `concurrency` option overrides it;
   * absent means the driver's default (`min(4, cores - 1)`). CI boxes and laptops differ, and
   * a 6.8 GB pack does not get to decide the machine's fate.
   */
  readonly concurrency?: number;
  /**
   * Model optimization: an object of options, or the string `"none"` to ship every model
   * exactly as committed. Absent means optimization runs with defaults.
   */
  readonly models?: IModelsConfig | "none";
  readonly output?: string;
  readonly source?: string;
  readonly targets?: IAssetTargets;
  /**
   * Texture compression: an object of options, or the string `"none"` to ship every texture
   * exactly as committed. Absent means compression runs with defaults.
   */
  readonly textures?: ITexturesConfig | "none";
}

export interface IModelsConfig {
  /** Generate standard TEXCOORD_1 lightmap UVs. Absent means no lightmap pass. */
  readonly lightmap?: ILightmapPassOptions;
  readonly passes?: IModelPassesOptions;
  readonly quantize?: IModelQuantizeOptions;
  /**
   * Write each distinct embedded image once under `shared/images/` and reference it from every
   * model that carries it, instead of embedding a copy in each. A marketplace pack's eight pines
   * stop shipping eight copies of the same bark map, and a rebuild reuses last build's encodes.
   * Default true: the served GLB references files beside it, which a host must serve. False
   * keeps each model self-contained and reports the duplicated embedded-image byte cost.
   */
  readonly sharedImages?: boolean;
  /** LOD simplification. Absent means none: it is the one lossy stage, and it is opt-in. */
  readonly simplify?: IModelSimplifyOptions;
  /**
   * Compression of the images embedded in a model, or the string `"none"` to ship them
   * exactly as authored. Absent means compression runs with defaults.
   */
  readonly textures?: IModelTexturesOptions | "none";
  /**
   * Cluster-DAG bake for virtual geometry, or `"none"` to ship every primitive as authored.
   * Absent means the bake runs with defaults, which clusters any primitive of 65,536 triangles
   * or more and leaves everything below it byte-identical.
   */
  readonly virtual?: IModelVirtualOptions | "none";
}

export interface IAudioConfig {
  readonly normalise?: "ceiling" | "peak";
  readonly overrides?: readonly IAudioOverride[];
  readonly peakDb?: number;
  readonly quality?: number;
  readonly seamThreshold?: number;
}

export interface ITexturesConfig {
  readonly maxSize?: number;
  readonly overrides?: readonly ITextureOverride[];
  readonly quality?: number;
}

export interface IAssetCompileOptions {
  readonly concurrency?: number;
  readonly config?: IAssetSourceConfig;
  readonly cwd?: string;
  /** Includes the machine-readable health report on the result. */
  readonly health?: boolean;
  readonly output?: string;
  /**
   * Replaces the built-in pass registry when provided; left undefined, the built-in
   * registry (the KTX2 texture pass) runs unless `config.textures` is `"none"`.
   */
  readonly passes?: readonly IAssetPass[];
  /**
   * The order inputs are processed in, which under a scheduler is the order their work
   * completes. `"sorted"` (the default) is the documented behaviour; `"reversed"` exists for
   * the determinism gate, which must be able to run the same inputs through the driver in a
   * different completion order and compare every emitted byte. It is a test seam, not a
   * project setting, and a game config never carries it.
   */
  readonly processingOrder?: "reversed" | "sorted";
  /**
   * The platform this bake is for, which decides whether compression can ship at all.
   *
   * Android and iOS run the native host without WebAssembly, so they carry no Basis transcoder
   * and no Meshopt decoder: a `.ktx2` texture or a meshopt-compressed mesh in a mobile bundle is
   * a black screen, and `threenative build` refuses one with `TN_NATIVE_KTX2_UNSUPPORTED`. Web
   * and desktop decode both.
   *
   * Absent means web — a direct `compileAssets` call, or a project that compiles once and serves
   * the result. `threenative build` always names its `--target`, so the passes that a platform
   * cannot decode drop for that build and stay on for every other one. This is the whole reason
   * `assets.textures: "none"` used to be pinned in the scaffolded config: the author was asked to
   * choose one constant for four targets, and every game that wanted Android shipped its web
   * build uncompressed too. The build knows its target; it decides.
   */
  readonly platform?: "android" | "desktop" | "ios" | "web";
  readonly source?: string;
  /** Overrides resolution of three's Basis transcoder for the copy into the output root. */
  readonly transcoder?: IBasisTranscoder;
}

export interface IBasisTranscoder {
  readonly javascriptPath: string;
  readonly wasmPath: string;
}

export interface IAssetCompileResult {
  /** How many workers the driver actually used: 1 for a sequential bake (custom passes, or a bound of 1). */
  readonly concurrencyUsed: number;
  /** One cost row per pass, driver-measured; empty when no bake ran. */
  readonly passCosts: readonly IPassCostRow[];
  /**
   * What built-in compression shipped uncompressed, plus caller-supplied decoder-dependent passes
   * omitted for this target as `kind: "pass"` rows. Turning a convention off does not turn its
   * measurement off.
   */
  readonly skippedCompression: readonly ISkippedReportRow[];
  readonly receipt?: IBakeReceipt;
  readonly report?: IAssetHealthReport;
  readonly skipped: number;
  readonly written: number;
}

/** One file this bake owns, and where it came from. */
export interface IBakeReceiptOutput {
  readonly bytes: number;
  /** Path relative to the output root, with `/` separators on every platform. */
  readonly path: string;
  /** The producer: the pass chain for a compiled input, or the auxiliary output's own role. */
  readonly producer: string;
  /** The source asset this came from, or `null` for a file the bake ships on its own behalf. */
  readonly source: string | null;
}

/**
 * Everything the bake wrote, so the delete-test can remove exactly that and nothing else.
 *
 * Deterministic given the same inputs — no wall-clock field — because this repository proves a
 * change is neutral by diffing emitted output, and a timestamp makes every such diff dirty.
 */
export interface IBakeReceipt {
  readonly outputs: readonly IBakeReceiptOutput[];
  readonly pipelineVersion: number;
}

interface IAssetManifestEntry {
  readonly compressionSkipped?: TextureSkipReason;
  /** What the audio pass measured and did to one clip. */
  readonly audio?: IAudioRow;
  readonly bytes: number;
  readonly bytesAfter?: number;
  readonly bytesBefore?: number;
  /** What the model pass did to the images inside a `.glb` (model pass). */
  readonly embeddedTextures?: IEmbeddedTextureRow;
  /** Requested against achieved LOD simplification (model pass). */
  readonly simplify?: ISimplifyRow;
  /** Extensions the compiled output declares (model pass), sorted. */
  readonly extensions?: readonly string[];
  readonly format?: string;
  /** The source extension a GLB was converted from (`fbx`, `blend`, `obj`, `dae`), so a report can
   * say a model was converted rather than authored. Absent for a model the game shipped as glTF. */
  readonly importedFrom?: string;
  readonly kind: AssetKind;
  readonly lightmapAtlas?: Readonly<Record<string, unknown>>;
  readonly lightmaps?: readonly Readonly<Record<string, unknown>>[];
  readonly output: string;
  readonly passes: string[];
  /** Triangle count of the compiled output (model pass). */
  readonly triangles?: number;
  readonly transcodeTargets?: readonly string[];
  /** Vertex count of the compiled output (model pass). */
  readonly vertices?: number;
}

interface IAssetManifest {
  readonly entries: Record<string, IAssetManifestEntry>;
  readonly version: 1;
}

interface ICompileLayout {
  readonly budget: IAssetBudget;
  readonly exclude: readonly string[];
  /** True when the built-in pass registry is in play — a caller that supplied its own opted out of nothing. */
  readonly builtinRegistry: boolean;
  /** `assets.concurrency` from the game config, when it declared one. */
  readonly concurrency: number | undefined;
  readonly runtimeDecoderCapabilities: IAssetRuntimeDecoderCapabilities;
  readonly outputRoot: string;
  /** The built-in registry's serialisable mirror; empty when the caller supplied passes. */
  readonly passSpecs: readonly PassSpec[];
  /** Names of caller-supplied decoder-dependent passes omitted on a target without a decoder. */
  readonly skippedPasses: readonly string[];
  readonly passes: readonly IAssetPass[];
  readonly sourceRoot: string;
  readonly targets: IAssetTargets;
  /** True when the built-in KTX2 pass is part of `passes` (drives the transcoder copy). */
  readonly texturesActive: boolean;
  /** Why the model's decoder-backed sub-passes were not emitted, if they were skipped. */
  readonly modelCompressionReason: ISkippedCompressionRow["reason"] | undefined;
  /** Why the standalone texture pass was not emitted, if it was skipped. */
  readonly textureCompressionReason: ISkippedCompressionRow["reason"] | undefined;
}

interface IDirectoryScan {
  readonly files: string[];
  readonly subdirectories: string[];
}

const MANIFEST_NAME = "assets.manifest.json";
/**
 * What this bake produced, written by the producer so nothing downstream has to guess.
 *
 * The delete-test — remove every baked file and the game still runs, just slower — is the rule
 * that separates a baking pass from a compiler of game meaning. A test driven by a directory glob
 * would either miss an output or delete a source asset, and both failures look like a pass, so the
 * step that wrote the files is the one that lists them. **Nothing in the shipped runtime reads
 * this file**; deleting it is part of the test.
 */
const RECEIPT_NAME = "bake.receipt.json";
/** Files emitted after the last successful receipt, retained so a failed cook can be recovered. */
const PENDING_RECEIPT_NAME = ".bake.pending-receipt.json";
const DEFAULT_SOURCE = "assets";
const DEFAULT_OUTPUT = "public";
const BASIS_DIRECTORY = "basis";
/** Declared by a model whose embedded images were transcoded; the runtime needs the transcoder. */
const BASISU_EXTENSION = "KHR_texture_basisu";
/**
 * Baked into every output hash so a future change to how passes behave invalidates previously
 * compiled outputs even when pass names are unchanged. Bump it when a pass's behaviour changes.
 * v2: textures encode to KTX2 instead of passing through byte-identical.
 * v3: models run dedup/prune/reorder/quantize/meshopt instead of passing through byte-identical.
 * v7: the images embedded in a model are transcoded to KTX2 and capped in resolution.
 * v8: every compile writes `bake.receipt.json` beside the manifest, so the run has one additional
 * output and a cached `public/` from v7 has no receipt to delete.
 * v9: audio is conditioned and encoded to Ogg Vorbis instead of passing through byte-identical,
 * so every audio output from v8 has the wrong extension and the wrong bytes.
 */
const PIPELINE_VERSION = 9;

const KIND_BY_EXTENSION: Readonly<Record<string, AssetKind>> = {
  // Converted to GLB by `blenderImportPass` before `modelPass` sees them. Until PRD-346 these four
  // classified as "other", were copied through untouched, and the build reported success on a file
  // no runtime can load.
  blend: "model",
  dae: "model",
  fbx: "model",
  glb: "model",
  gltf: "model",
  obj: "model",
  jpeg: "texture",
  jpg: "texture",
  mp3: "audio",
  ogg: "audio",
  png: "texture",
  wav: "audio",
  webp: "texture",
};

const CODECS: readonly string[] = ["etc1s", "none", "uastc"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Narrows a pass's embedded-texture summary to the manifest shape by reading every field it
 * declares. A cast would let a pass that changed its own summary write nonsense into the
 * manifest the runtime and the report both read; this drops anything that is not a number.
 */
function simplifyRow(value: unknown): ISimplifyRow | undefined {
  if (!isRecord(value)) return undefined;
  const keys = [
    "achievedRatio",
    "error",
    "requestedRatio",
    "trianglesAfter",
    "trianglesBefore",
  ] as const;
  if (keys.some((key) => typeof value[key] !== "number")) return undefined;
  return {
    achievedRatio: value.achievedRatio as number,
    error: value.error as number,
    requestedRatio: value.requestedRatio as number,
    trianglesAfter: value.trianglesAfter as number,
    trianglesBefore: value.trianglesBefore as number,
  };
}

function embeddedTextureRow(value: unknown): IEmbeddedTextureRow | undefined {
  if (!isRecord(value)) return undefined;
  const numbers = [
    "bytesAfter",
    "bytesBefore",
    "count",
    "gpuBytesAfter",
    "gpuBytesBefore",
    "resized",
  ] as const;
  if (numbers.some((key) => typeof value[key] !== "number")) return undefined;
  const formats = isRecord(value.formats)
    ? Object.fromEntries(
        Object.entries(value.formats).filter(([, codec]) => typeof codec === "string"),
      )
    : undefined;
  return {
    bytesAfter: value.bytesAfter as number,
    bytesBefore: value.bytesBefore as number,
    count: value.count as number,
    ...(formats === undefined ? {} : { formats: formats as Record<string, string> }),
    ...(isRecord(value.skippedCompression)
      ? {
          skippedCompression: Object.fromEntries(
            Object.entries(value.skippedCompression).filter(
              ([, reason]) => reason === "block-size" || reason === "not-smaller",
            ),
          ) as Record<string, TextureSkipReason>,
        }
      : {}),
    gpuBytesAfter: value.gpuBytesAfter as number,
    gpuBytesBefore: value.gpuBytesBefore as number,
    resized: value.resized as number,
  };
}

/**
 * Narrows the audio pass's summary to the manifest shape by reading every field it declares.
 *
 * Same reason as `simplifyRow` above: a cast would let a pass that changed its own summary write
 * nonsense into the manifest and the report both read from. Anything missing a required field is
 * dropped whole rather than half-recorded.
 */
function audioRow(value: unknown): IAudioRow | undefined {
  if (!isRecord(value)) return undefined;
  const numbers = [
    "bandAir",
    "bandHigh",
    "bandLow",
    "bandMid",
    "bandSub",
    "bytesAfter",
    "bytesBefore",
    "channelsAfter",
    "channelsBefore",
    "dcOffsetAfter",
    "dcOffsetBefore",
    "decodedBytesAfter",
    "decodedBytesBefore",
    "durationSeconds",
    "frames",
    "peakAfter",
    "peakBefore",
    "sampleRate",
    "seamNearP99",
    "seamRatio",
    "seamRatioBefore",
    "seamWrap",
    "seamWrapBefore",
  ] as const;
  if (numbers.some((key) => typeof value[key] !== "number")) return undefined;
  const flags = ["conditioned", "loop", "reencoded"] as const;
  if (flags.some((key) => typeof value[key] !== "boolean")) return undefined;
  if (typeof value.container !== "string" || typeof value.logicalPath !== "string")
    return undefined;
  // Present only when the game declared the thing they describe, so they are copied when they
  // are numbers and dropped when they are not — never defaulted, because a bound nobody declared
  // must not appear in the manifest as though someone had.
  const optional = [
    "crossFadeMs",
    "crossFadeMsRequested",
    "seamMaxRatio",
    "spectrumMaxPercent",
    "spectrumMinPercent",
    "spectrumPercent",
  ] as const;
  return {
    ...(Object.fromEntries(
      optional.flatMap((key) => (typeof value[key] === "number" ? [[key, value[key]]] : [])),
    ) as Record<string, number>),
    ...(typeof value.spectrumBand === "string" ? { spectrumBand: value.spectrumBand } : {}),
    ...(Object.fromEntries(numbers.map((key) => [key, value[key] as number])) as Record<
      (typeof numbers)[number],
      number
    >),
    conditioned: value.conditioned,
    container: value.container,
    logicalPath: value.logicalPath,
    loop: value.loop,
    reencoded: value.reencoded,
  } as IAudioRow;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`TN_ASSETS_CONFIG_INVALID: ${label} must be a non-empty string.`);
  }
  return value;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const TARGET_KEYS: readonly string[] = ["maxMaterials", "maxTriangles", "maxTextureDimension"];

function positiveTarget(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `TN_ASSETS_CONFIG_INVALID: assets.targets.${label} must be a positive integer.`,
    );
  }
  return value;
}

function validateTargets(raw: unknown): IAssetTargets {
  if (!isRecord(raw)) {
    throw new Error("TN_ASSETS_CONFIG_INVALID: assets.targets must be an object.");
  }
  for (const key of Object.keys(raw)) {
    if (!TARGET_KEYS.includes(key)) {
      throw new Error(`TN_ASSETS_CONFIG_UNKNOWN_KEY: assets.targets.${key} is not recognised.`);
    }
  }
  return {
    ...(raw.maxMaterials === undefined
      ? {}
      : { maxMaterials: positiveTarget(raw.maxMaterials, "maxMaterials") }),
    ...(raw.maxTriangles === undefined
      ? {}
      : { maxTriangles: positiveTarget(raw.maxTriangles, "maxTriangles") }),
    ...(raw.maxTextureDimension === undefined
      ? {}
      : { maxTextureDimension: positiveTarget(raw.maxTextureDimension, "maxTextureDimension") }),
  };
}

function textureQuality(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 255) {
    throw new Error(`TN_ASSETS_CONFIG_INVALID: ${label} must be an integer between 1 and 255.`);
  }
  return value;
}

function validateTextureOverrides(raw: unknown): readonly ITextureOverride[] {
  if (!Array.isArray(raw)) {
    throw new Error("TN_ASSETS_CONFIG_INVALID: assets.textures.overrides must be an array.");
  }
  return raw.map((item, index): ITextureOverride => {
    if (!isRecord(item)) {
      throw new Error(
        `TN_ASSETS_CONFIG_INVALID: assets.textures.overrides[${String(index)}] must be an object.`,
      );
    }
    for (const key of Object.keys(item)) {
      if (key !== "glob" && key !== "codec" && key !== "quality") {
        throw new Error(
          `TN_ASSETS_CONFIG_UNKNOWN_KEY: assets.textures.overrides.${key} is not recognised.`,
        );
      }
    }
    const glob = nonEmptyString(item.glob, `assets.textures.overrides[${String(index)}].glob`);
    if (!CODECS.includes(item.codec as string)) {
      throw new Error(
        `TN_ASSETS_CONFIG_INVALID: assets.textures.overrides[${String(index)}].codec must be one of ${CODECS.join(", ")}; received '${String(item.codec)}'.`,
      );
    }
    return {
      codec: item.codec as ITextureOverride["codec"],
      glob,
      ...(item.quality === undefined
        ? {}
        : {
            quality: textureQuality(
              item.quality,
              `assets.textures.overrides[${String(index)}].quality`,
            ),
          }),
    };
  });
}

/** `"none"` disables the built-in texture pass; an object configures it; absent means defaults. */
function parseTexturesConfig(raw: unknown): ITexturePassOptions | undefined {
  if (raw === undefined) return {};
  if (raw === "none") return undefined;
  if (!isRecord(raw)) {
    throw new Error('TN_ASSETS_CONFIG_INVALID: assets.textures must be "none" or an object.');
  }
  for (const key of Object.keys(raw)) {
    if (key !== "maxSize" && key !== "quality" && key !== "overrides") {
      throw new Error(`TN_ASSETS_CONFIG_UNKNOWN_KEY: assets.textures.${key} is not recognised.`);
    }
  }
  return {
    ...(raw.maxSize === undefined
      ? {}
      : { maxSize: positiveTextureSize(raw.maxSize, "assets.textures.maxSize") }),
    ...(raw.quality === undefined
      ? {}
      : { quality: textureQuality(raw.quality, "assets.textures.quality") }),
    ...(raw.overrides === undefined ? {} : { overrides: validateTextureOverrides(raw.overrides) }),
  };
}

function positiveTextureSize(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 4) {
    throw new Error(`TN_ASSETS_CONFIG_INVALID: ${label} must be a positive integer of at least 4.`);
  }
  return value;
}

/** `"none"` disables the built-in model pass; an object configures it; absent means defaults. */
type ParsedModelsConfig = Omit<IModelPassOptions, "sharedImages"> & {
  readonly sharedImages: boolean;
};

function parseModelsConfig(raw: unknown): ParsedModelsConfig | undefined {
  if (raw === undefined) return { sharedImages: true };
  if (raw === "none") return undefined;
  if (!isRecord(raw)) {
    throw new Error('TN_ASSETS_CONFIG_INVALID: assets.models must be "none" or an object.');
  }
  const allowed = [
    "lightmap",
    "passes",
    "quantize",
    "sharedImages",
    "simplify",
    "textures",
    "virtual",
  ];
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      throw new Error(`TN_ASSETS_CONFIG_UNKNOWN_KEY: assets.models.${key} is not recognised.`);
    }
  }
  // The sub-pass switches and bit depths are validated by the pass itself, which owns their
  // vocabulary; a malformed value surfaces as TN_ASSETS_CONFIG_* when the registry is built.
  const passes = raw.passes === undefined ? {} : parseModelPasses(raw.passes);
  const quantize = raw.quantize === undefined ? {} : parseModelQuantize(raw.quantize);
  const lightmap = raw.lightmap === undefined ? undefined : parseLightmap(raw.lightmap);
  const simplify = raw.simplify === undefined ? undefined : parseModelSimplify(raw.simplify);
  const textures = raw.textures === undefined ? undefined : parseModelTextures(raw.textures);
  const virtual = raw.virtual === undefined ? undefined : parseModelVirtual(raw.virtual);
  if (raw.sharedImages !== undefined && typeof raw.sharedImages !== "boolean") {
    throw new Error("TN_ASSETS_CONFIG_INVALID: assets.models.sharedImages must be a boolean.");
  }
  return {
    sharedImages: raw.sharedImages !== false,
    ...(lightmap === undefined ? {} : { lightmap }),
    ...(Object.keys(passes).length === 0 ? {} : { passes }),
    ...(Object.keys(quantize).length === 0 ? {} : { quantize }),
    ...(simplify === undefined ? {} : { simplify }),
    ...(textures === undefined ? {} : { textures }),
    ...(virtual === undefined ? {} : { virtual }),
  };
}

const MODEL_TEXTURE_KEYS: readonly string[] = ["maxSize", "overrides", "quality"];

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `TN_ASSETS_CONFIG_INVALID: assets.models.textures.${label} must be a positive integer.`,
    );
  }
  return value;
}

/** `"none"` ships every embedded image as authored; an object configures the compression. */
function parseModelTextures(raw: unknown): IModelTexturesOptions | "none" {
  if (raw === "none") return "none";
  if (!isRecord(raw)) {
    throw new Error(
      'TN_ASSETS_CONFIG_INVALID: assets.models.textures must be "none" or an object.',
    );
  }
  for (const key of Object.keys(raw)) {
    if (!MODEL_TEXTURE_KEYS.includes(key)) {
      throw new Error(
        `TN_ASSETS_CONFIG_UNKNOWN_KEY: assets.models.textures.${key} is not recognised.`,
      );
    }
  }
  return {
    ...(raw.maxSize === undefined ? {} : { maxSize: positiveInteger(raw.maxSize, "maxSize") }),
    ...(raw.overrides === undefined
      ? {}
      : { overrides: validateModelTextureOverrides(raw.overrides) }),
    ...(raw.quality === undefined
      ? {}
      : { quality: textureQuality(raw.quality, "assets.models.textures.quality") }),
  };
}

function validateModelTextureOverrides(raw: unknown): readonly IModelTextureOverride[] {
  if (!Array.isArray(raw)) {
    throw new Error("TN_ASSETS_CONFIG_INVALID: assets.models.textures.overrides must be an array.");
  }
  return raw.map((item, index): IModelTextureOverride => {
    const label = `assets.models.textures.overrides[${String(index)}]`;
    if (!isRecord(item)) throw new Error(`TN_ASSETS_CONFIG_INVALID: ${label} must be an object.`);
    for (const key of Object.keys(item)) {
      if (key !== "slot" && key !== "codec") {
        throw new Error(
          `TN_ASSETS_CONFIG_UNKNOWN_KEY: assets.models.textures.overrides.${key} is not recognised.`,
        );
      }
    }
    if (!CODECS.includes(item.codec as string)) {
      throw new Error(
        `TN_ASSETS_CONFIG_INVALID: ${label}.codec must be one of ${CODECS.join(", ")}; received '${String(item.codec)}'.`,
      );
    }
    return {
      codec: item.codec as IModelTextureOverride["codec"],
      slot: nonEmptyString(item.slot, `${label}.slot`),
    };
  });
}

function parseModelSimplify(raw: unknown): IModelSimplifyOptions {
  if (!isRecord(raw)) {
    throw new Error("TN_ASSETS_CONFIG_INVALID: assets.models.simplify must be an object.");
  }
  for (const key of Object.keys(raw)) {
    if (key !== "error" && key !== "ratio") {
      throw new Error(
        `TN_ASSETS_CONFIG_UNKNOWN_KEY: assets.models.simplify.${key} is not recognised.`,
      );
    }
  }
  if (typeof raw.ratio !== "number" || !(raw.ratio > 0) || raw.ratio > 1) {
    throw new Error(
      "TN_ASSETS_CONFIG_INVALID: assets.models.simplify.ratio must be a number greater than 0 and at most 1.",
    );
  }
  if (raw.error !== undefined && (typeof raw.error !== "number" || raw.error < 0)) {
    throw new Error(
      "TN_ASSETS_CONFIG_INVALID: assets.models.simplify.error must be a non-negative number.",
    );
  }
  return {
    ratio: raw.ratio,
    ...(raw.error === undefined ? {} : { error: raw.error as number }),
  };
}

/**
 * `"none"` ships every primitive as authored; an object moves the cluster bake's thresholds.
 *
 * Every key is validated here rather than deeper in the bake, because a game reaches this through
 * `threenative.config.ts` and a silently-dropped `minSourceTriangles` is a bake that quietly did
 * something other than what the file asked for.
 */
function parseModelVirtual(raw: unknown): IModelVirtualOptions | "none" {
  if (raw === "none") return "none";
  if (!isRecord(raw)) {
    throw new Error('TN_ASSETS_CONFIG_INVALID: assets.models.virtual must be "none" or an object.');
  }
  const counts = ["groupSize", "maxTriangles", "minSourceTriangles", "minTriangles"] as const;
  for (const key of Object.keys(raw)) {
    if (key !== "simplifyRatio" && !(counts as readonly string[]).includes(key)) {
      throw new Error(
        `TN_ASSETS_CONFIG_UNKNOWN_KEY: assets.models.virtual.${key} is not recognised.`,
      );
    }
  }
  const parsed: Record<string, number> = {};
  for (const key of counts) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
      throw new Error(
        `TN_ASSETS_CONFIG_INVALID: assets.models.virtual.${key} must be a positive integer.`,
      );
    }
    parsed[key] = value;
  }
  if (raw.simplifyRatio !== undefined) {
    if (
      typeof raw.simplifyRatio !== "number" ||
      !(raw.simplifyRatio > 0) ||
      !(raw.simplifyRatio < 1)
    )
      throw new Error(
        "TN_ASSETS_CONFIG_INVALID: assets.models.virtual.simplifyRatio must be a number between 0 and 1, exclusive.",
      );
    parsed.simplifyRatio = raw.simplifyRatio;
  }
  return parsed as IModelVirtualOptions;
}

function parseLightmap(raw: unknown): ILightmapPassOptions {
  if (!isRecord(raw)) {
    throw new Error("TN_ASSETS_CONFIG_INVALID: assets.models.lightmap must be an object.");
  }
  for (const key of Object.keys(raw)) {
    if (key !== "atlasSize" && key !== "padding") {
      throw new Error(
        `TN_ASSETS_CONFIG_UNKNOWN_KEY: assets.models.lightmap.${key} is not recognised.`,
      );
    }
  }
  if (!Number.isSafeInteger(raw.atlasSize) || (raw.atlasSize as number) <= 0) {
    throw new Error(
      "TN_ASSETS_CONFIG_INVALID: assets.models.lightmap.atlasSize must be a positive integer.",
    );
  }
  if (!Number.isSafeInteger(raw.padding) || (raw.padding as number) <= 0) {
    throw new Error(
      "TN_ASSETS_CONFIG_INVALID: assets.models.lightmap.padding must be a positive integer.",
    );
  }
  return { atlasSize: raw.atlasSize as number, padding: raw.padding as number };
}

const MODEL_PASS_KEYS: readonly string[] = ["dedup", "meshopt", "prune", "quantize", "reorder"];

function parseModelPasses(raw: unknown): IModelPassesOptions {
  if (!isRecord(raw)) {
    throw new Error("TN_ASSETS_CONFIG_INVALID: assets.models.passes must be an object.");
  }
  for (const key of Object.keys(raw)) {
    if (!MODEL_PASS_KEYS.includes(key)) {
      throw new Error(
        `TN_ASSETS_CONFIG_UNKNOWN_KEY: assets.models.passes.${key} is not recognised.`,
      );
    }
    if (typeof raw[key] !== "boolean") {
      throw new Error(`TN_ASSETS_CONFIG_INVALID: assets.models.passes.${key} must be a boolean.`);
    }
  }
  return raw as IModelPassesOptions;
}

const MODEL_QUANTIZE_KEYS: readonly string[] = ["normalBits", "positionBits", "uvBits"];

function parseModelQuantize(raw: unknown): IModelQuantizeOptions {
  if (!isRecord(raw)) {
    throw new Error("TN_ASSETS_CONFIG_INVALID: assets.models.quantize must be an object.");
  }
  for (const key of Object.keys(raw)) {
    if (!MODEL_QUANTIZE_KEYS.includes(key)) {
      throw new Error(
        `TN_ASSETS_CONFIG_UNKNOWN_KEY: assets.models.quantize.${key} is not recognised.`,
      );
    }
    // Depths low enough to visibly warp a model are accepted, not rejected: the pass's own
    // self-verification fails the build naming the drift instead of a config rule guessing.
    if (
      typeof raw[key] !== "number" ||
      !Number.isSafeInteger(raw[key]) ||
      (raw[key] as number) < 1 ||
      (raw[key] as number) > 16
    ) {
      throw new Error(
        `TN_ASSETS_CONFIG_INVALID: assets.models.quantize.${key} must be an integer between 1 and 16 bits.`,
      );
    }
  }
  return raw as IModelQuantizeOptions;
}

function resolveLayout(cwd: string, options: IAssetCompileOptions): ICompileLayout {
  const config: unknown = options.config ?? {};
  if (!isRecord(config)) {
    throw new Error("TN_ASSETS_CONFIG_INVALID: assets must be an object when declared.");
  }
  for (const key of Object.keys(config)) {
    if (
      key !== "audio" &&
      key !== "budget" &&
      key !== "exclude" &&
      key !== "concurrency" &&
      key !== "source" &&
      key !== "output" &&
      key !== "targets" &&
      key !== "textures" &&
      key !== "models"
    ) {
      throw new Error(`TN_ASSETS_CONFIG_UNKNOWN_KEY: assets.${key} is not recognised.`);
    }
  }
  const source = options.source ?? config.source ?? DEFAULT_SOURCE;
  const exclude = config.exclude ?? [];
  if (
    !Array.isArray(exclude) ||
    exclude.some((glob) => typeof glob !== "string" || glob.trim() === "")
  ) {
    throw new Error(
      "TN_ASSETS_CONFIG_INVALID: assets.exclude must be an array of non-empty glob strings.",
    );
  }
  const output = options.output ?? config.output ?? DEFAULT_OUTPUT;
  const sourceRoot = path.resolve(cwd, nonEmptyString(source, "assets.source"));
  const outputRoot = path.resolve(cwd, nonEmptyString(output, "assets.output"));
  const nested =
    sourceRoot === outputRoot ||
    sourceRoot.startsWith(`${outputRoot}${path.sep}`) ||
    outputRoot.startsWith(`${sourceRoot}${path.sep}`);
  if (nested) {
    throw new Error(
      `TN_ASSETS_OVERLAP: source '${sourceRoot}' and output '${outputRoot}' must be disjoint directories.`,
    );
  }
  // Android and iOS have no WebAssembly and therefore no Basis transcoder and no Meshopt
  // decoder. The registry uses each pass's declaration below, so decoder-free work in the mixed
  // model pass survives on those targets.
  const runtimeDecoderCapabilities: IAssetRuntimeDecoderCapabilities = {
    ktx2: options.platform !== "android" && options.platform !== "ios",
    meshopt: options.platform !== "android" && options.platform !== "ios",
  };
  const runtimeDecoderAvailable =
    runtimeDecoderCapabilities.ktx2 && runtimeDecoderCapabilities.meshopt;
  const audio = parseAudioConfig(config.audio);
  const configuredTextures = parseTexturesConfig(config.textures);
  const configuredModels = parseModelsConfig(config.models);
  const models =
    configuredModels === undefined
      ? undefined
      : {
          ...configuredModels,
          ...(runtimeDecoderCapabilities.meshopt
            ? {}
            : {
                passes: { ...(configuredModels.passes ?? {}), meshopt: false },
              }),
          ...(runtimeDecoderCapabilities.ktx2 ? {} : { textures: "none" as const }),
        };
  const textures = configuredTextures;
  const lightmap = (models as (IModelPassOptions & { lightmap?: ILightmapPassOptions }) | undefined)
    ?.lightmap;
  // The built-in registry runs only when the caller did not replace it wholesale; each
  // built-in pass drops out individually through its `"none"` shorthand. Its serialisable
  // mirror rides along so a bounded worker pool can rebuild the identical chain — custom
  // passes cannot cross a worker boundary, so a compile that supplies any runs sequential.
  const builtinPasses: IAssetPass[] = [];
  const passSpecs: PassSpec[] = [];
  const registerBuiltin = (pass: IAssetPass, spec: PassSpec): void => {
    if (spec.needsRuntimeDecoder === true && !runtimeDecoderAvailable) return;
    builtinPasses.push(pass);
    passSpecs.push(spec);
  };
  if (options.passes === undefined) {
    if (audio !== undefined) {
      registerBuiltin(audioPass(audio), {
        kind: "audio",
        needsRuntimeDecoder: false,
        options: audio,
      });
    }
    if (textures !== undefined) {
      registerBuiltin(texturePass(textures), {
        kind: "texture",
        needsRuntimeDecoder: true,
        options: textures,
      });
    }
    if (lightmap !== undefined) {
      registerBuiltin(lightmapPass(lightmap), {
        kind: "lightmap",
        needsRuntimeDecoder: true,
        options: lightmap,
      });
    }
    // Ahead of `modelPass`: it converts the source into the GLB that pass then optimizes. A game
    // with no importable source pays one extension test per input.
    registerBuiltin(blenderImportPass(), {
      kind: "blender-import",
      needsRuntimeDecoder: false,
    });
    if (models !== undefined) {
      const pass = modelPass({
        ...models,
        preserveLightmapUv: lightmap !== undefined,
        // Bound to the output root so a second build finds last build's encodes on
        // disk instead of paying for them again.
        // The driver publishes every returned auxiliary output after journalling ownership.
        // The store still remembers within this pass chain and reads last build's public cache.
        sharedImages: models.sharedImages
          ? createSharedImageStore(outputRoot, { writeThrough: false })
          : undefined,
      });
      registerBuiltin(pass, {
        kind: "model",
        needsRuntimeDecoder: pass.needsRuntimeDecoder ?? false,
        options: {
          ...models,
          preserveLightmapUv: lightmap !== undefined,
          sharedImages: models.sharedImages,
        },
      });
    }
  }
  const suppliedPasses = options.passes ?? [];
  const skippedPasses = suppliedPasses
    .filter((pass) => pass.needsRuntimeDecoder === true && !runtimeDecoderAvailable)
    .map((pass) => pass.name);
  const customPasses = suppliedPasses.filter(
    (pass) => pass.needsRuntimeDecoder !== true || runtimeDecoderAvailable,
  );
  return {
    builtinRegistry: options.passes === undefined,
    exclude,
    concurrency: config.concurrency as number | undefined,
    runtimeDecoderCapabilities,
    modelCompressionReason:
      options.passes !== undefined
        ? undefined
        : configuredModels === undefined
          ? "config"
          : runtimeDecoderAvailable
            ? undefined
            : "platform",
    outputRoot,
    passSpecs,
    skippedPasses,
    passes: [...builtinPasses, ...customPasses],
    sourceRoot,
    targets: config.targets === undefined ? {} : validateTargets(config.targets),
    budget: parseBudget(config.budget),
    textureCompressionReason:
      options.passes !== undefined
        ? undefined
        : configuredTextures === undefined
          ? "config"
          : runtimeDecoderCapabilities.ktx2
            ? undefined
            : "platform",
    texturesActive:
      textures !== undefined && options.passes === undefined && runtimeDecoderAvailable,
  };
}

async function scanDirectory(sourceRoot: string, directory: string): Promise<IDirectoryScan> {
  const entries = await readdir(path.join(sourceRoot, directory), { withFileTypes: true });
  entries.sort((left, right) => (left.name < right.name ? -1 : 1));
  const files: string[] = [];
  const subdirectories: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const logical = directory === "" ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      subdirectories.push(logical);
      continue;
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      throw new Error(
        `TN_ASSETS_INPUT_UNREADABLE: '${logical}' under '${sourceRoot}' is neither a file nor a directory.`,
      );
    }
    files.push(logical);
  }
  return { files, subdirectories };
}

async function walkSources(sourceRoot: string): Promise<string[]> {
  const logicalPaths: string[] = [];
  const seenFiles = new Set<string>();
  const visitedDirectories = new Set<string>();
  const queue: string[] = [""];
  while (queue.length > 0) {
    const directory = queue.shift();
    if (directory === undefined) break;
    const canonical = await realpath(path.join(sourceRoot, directory));
    if (visitedDirectories.has(canonical)) {
      throw new Error(
        `TN_ASSETS_DUPLICATE_LOGICAL_PATH: '${directory}' resolves to an already-visited directory; duplicate logical path under '${sourceRoot}'.`,
      );
    }
    visitedDirectories.add(canonical);
    const scanned = await scanDirectory(sourceRoot, directory);
    queue.push(...scanned.subdirectories);
    for (const logical of scanned.files) {
      if (seenFiles.has(logical)) {
        throw new Error(
          `TN_ASSETS_DUPLICATE_LOGICAL_PATH: '${logical}' was listed twice; duplicate logical path under '${sourceRoot}'.`,
        );
      }
      seenFiles.add(logical);
      logicalPaths.push(logical);
    }
  }
  return logicalPaths.sort();
}

/** Shared with the health report so the kind vocabulary lives in exactly one place. */
export function classify(logicalPath: string): AssetKind {
  const extension = path.extname(logicalPath).slice(1).toLowerCase();
  return KIND_BY_EXTENSION[extension] ?? "other";
}

function outputNameFor(logicalPath: string, digest: string, extension?: string): string {
  const sourceExtension = path.extname(logicalPath);
  const base = path.basename(logicalPath, sourceExtension);
  const directory = path.dirname(logicalPath);
  const name = `${base}.${digest}${extension ?? sourceExtension.toLowerCase()}`;
  return directory === "." ? name : `${directory}/${name}`;
}

function sameTargets(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function sameEntry(existing: IAssetManifestEntry, entry: IAssetManifestEntry): boolean {
  return (
    existing.output === entry.output &&
    existing.kind === entry.kind &&
    JSON.stringify(existing.audio) === JSON.stringify(entry.audio) &&
    existing.importedFrom === entry.importedFrom &&
    JSON.stringify(existing.lightmapAtlas) === JSON.stringify(entry.lightmapAtlas) &&
    JSON.stringify(existing.lightmaps) === JSON.stringify(entry.lightmaps) &&
    JSON.stringify(existing.embeddedTextures) === JSON.stringify(entry.embeddedTextures) &&
    JSON.stringify(existing.simplify) === JSON.stringify(entry.simplify) &&
    existing.bytes === entry.bytes &&
    existing.bytesBefore === entry.bytesBefore &&
    existing.bytesAfter === entry.bytesAfter &&
    existing.format === entry.format &&
    sameTargets(existing.transcodeTargets, entry.transcodeTargets) &&
    sameTargets(existing.extensions, entry.extensions) &&
    existing.triangles === entry.triangles &&
    existing.vertices === entry.vertices &&
    existing.passes.length === entry.passes.length &&
    existing.passes.every((name, index) => name === entry.passes[index])
  );
}

interface IResolvedAuxiliaryOutput {
  readonly buffer: Buffer;
  readonly manifestField: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly output: string;
  /** Named by the pass and possibly referenced by several inputs. */
  readonly shared: boolean;
  /** The producer's own name for this output — `lightmap` for the lightmap pass's atlas. */
  readonly role: string;
}

function resolveAuxiliaryOutputs(
  logical: string,
  outputs: readonly IAssetAuxiliaryOutput[],
): IResolvedAuxiliaryOutput[] {
  const sourceExtension = path.extname(logical);
  const stem = logical.slice(0, -sourceExtension.length);
  return outputs.map((auxiliary) => {
    const digest = createHash("sha256").update(auxiliary.buffer).digest("hex").slice(0, 8);
    const output =
      auxiliary.outputPath ??
      outputNameFor(`${stem}.${auxiliary.role}${auxiliary.extension}`, digest, auxiliary.extension);
    if (path.win32.isAbsolute(output) || output.split(/[\\/]/u).includes("..")) {
      throw new Error(
        `TN_ASSETS_OUTPUT_INVALID: auxiliary output '${output}' must stay relative to assets.output.`,
      );
    }
    return {
      buffer: auxiliary.buffer,
      manifestField: auxiliary.manifestField,
      metadata: {
        ...(auxiliary.metadata ?? {}),
        bytes: auxiliary.buffer.length,
        output,
      },
      output,
      role: auxiliary.role,
      shared: auxiliary.outputPath !== undefined,
    };
  });
}

function auxiliaryManifestFields(
  outputs: readonly IResolvedAuxiliaryOutput[],
): Record<string, readonly Readonly<Record<string, unknown>>[]> {
  const fields: Record<string, Readonly<Record<string, unknown>>[]> = {};
  for (const output of outputs) {
    const field = fields[output.manifestField] ?? [];
    field.push(output.metadata);
    fields[output.manifestField] = field;
  }
  return fields;
}

/**
 * The files a manifest entry declares beyond its own output: every array field whose records
 * carry an `output` path (lightmaps, shared images), as the receipt records them.
 */
function declaredAuxiliaryOutputs(
  entry: IAssetManifestEntry,
): { readonly bytes: number; readonly path: string; readonly producer: string }[] {
  const outputs: { bytes: number; path: string; producer: string }[] = [];
  for (const [field, value] of Object.entries(entry)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!isRecord(item) || typeof item.output !== "string") continue;
      outputs.push({
        bytes: typeof item.bytes === "number" ? item.bytes : 0,
        path: item.output,
        producer: field === "lightmaps" ? "lightmap" : field === "sharedImages" ? "image" : field,
      });
    }
  }
  return outputs;
}

/** Compression declarations a decoder-free target must retain when it passes a GLB through. */
function sourceModelExtensions(logicalPath: string, input: Buffer): readonly string[] | undefined {
  if (classify(logicalPath) !== "model" || path.extname(logicalPath).toLowerCase() !== ".glb")
    return undefined;
  try {
    const extensions = unpackGlb(input).json.extensionsUsed;
    return Array.isArray(extensions)
      ? extensions.filter((extension): extension is string => typeof extension === "string")
      : undefined;
  } catch {
    // The health reader owns the actionable malformed-model error. This helper only preserves
    // declarations from a readable pass-through GLB for the native compatibility backstop.
    return undefined;
  }
}

/**
 * The previous entry, when it is exactly what this build would produce and every file it
 * declares still exists — or `undefined`, in which case the passes run.
 */
async function reusableEntry(
  outputRoot: string,
  logical: string,
  digest: string,
  existing: IAssetManifestEntry,
): Promise<
  { readonly bytes: number; readonly path: string; readonly producer: string }[] | undefined
> {
  const expected = outputNameFor(logical, digest, path.extname(existing.output));
  if (existing.output !== expected) return undefined;
  const auxiliary = declaredAuxiliaryOutputs(existing);
  const present = await Promise.all(
    [existing.output, ...auxiliary.map((output) => output.path)].map((relative) =>
      outputExists(path.join(outputRoot, relative)),
    ),
  );
  return present.every(Boolean) ? auxiliary : undefined;
}

/** The paths the previous bake's receipt declared, or none when there is no readable receipt. */
async function readPreviousReceiptPaths(receiptPath: string): Promise<ReadonlySet<string>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(receiptPath, "utf8"));
    if (!isRecord(parsed) || !Array.isArray(parsed.outputs)) return new Set();
    return new Set(
      parsed.outputs.flatMap((output) =>
        isRecord(output) && typeof output.path === "string" ? [output.path] : [],
      ),
    );
  } catch {
    return new Set();
  }
}

/** Resolve and validate every stale receipt target before any output is deleted or published. */
async function resolveStaleReceiptOutputs(
  outputRoot: string,
  previous: ReadonlySet<string>,
  current: ReadonlySet<string>,
): Promise<readonly string[]> {
  if (previous.size === 0) return [];
  const root = path.resolve(outputRoot);
  const realRoot = await realpath(root);
  const stale: string[] = [];
  for (const relative of previous) {
    if (current.has(relative)) continue;
    const target = path.resolve(root, relative);
    if (!target.startsWith(`${root}${path.sep}`)) {
      throw new Error(`TN_ASSETS_RECEIPT_INVALID: output '${relative}' is outside assets.output.`);
    }
    if (!(await outputExists(target))) continue;
    const actual = await realpath(target);
    if (!actual.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error(`TN_ASSETS_RECEIPT_INVALID: output '${relative}' escapes assets.output.`);
    }
    stale.push(target);
  }
  return stale;
}

/** Remove only files an earlier receipt/journal owned and the completed recook no longer owns. */
async function removeStaleReceiptOutputs(
  outputRoot: string,
  previous: ReadonlySet<string>,
  current: ReadonlySet<string>,
): Promise<void> {
  for (const target of await resolveStaleReceiptOutputs(outputRoot, previous, current))
    await rm(target, { force: true });
}

async function writePendingOwnership(
  outputRoot: string,
  paths: ReadonlySet<string>,
): Promise<void> {
  await mkdir(outputRoot, { recursive: true });
  await writeFile(
    path.join(outputRoot, PENDING_RECEIPT_NAME),
    `${JSON.stringify({ outputs: [...paths].sort().map((outputPath) => ({ path: outputPath })) }, null, 2)}\n`,
    "utf8",
  );
}

async function readExistingManifest(
  manifestPath: string,
): Promise<{ entries: Record<string, IAssetManifestEntry>; raw: string | undefined }> {
  let raw: string | undefined;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    return { entries: {}, raw: undefined };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `TN_ASSETS_MANIFEST_INVALID: '${manifestPath}' is not valid JSON: ${messageOf(error)}`,
    );
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.entries)) {
    throw new Error(`TN_ASSETS_MANIFEST_INVALID: '${manifestPath}' must hold version 1 entries.`);
  }
  return { entries: parsed.entries as Record<string, IAssetManifestEntry>, raw };
}

/**
 * A missing source directory is the documented pre-pipeline state — projects built before this
 * step existed have none — so it skips compilation instead of failing their builds. A path that
 * exists but is not a directory is malformed input and still throws.
 */
async function hasSourceDirectory(sourceRoot: string): Promise<boolean> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(sourceRoot);
  } catch {
    return false;
  }
  if (!info.isDirectory()) {
    throw new Error(`TN_ASSETS_SOURCE_INVALID: asset source '${sourceRoot}' is not a directory.`);
  }
  return true;
}

async function outputExists(outputAbsolute: string): Promise<boolean> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(outputAbsolute);
  } catch {
    return false;
  }
  return info.isFile();
}

async function readInput(sourceRoot: string, logical: string): Promise<Buffer> {
  try {
    return await readFile(path.join(sourceRoot, logical));
  } catch (error) {
    throw new Error(
      `TN_ASSETS_INPUT_UNREADABLE: could not read '${logical}' under '${sourceRoot}': ${messageOf(error)}`,
    );
  }
}

/** The per-pass cost bookkeeping one bake accumulates, keyed in registry order. */
interface IPassCostRecord {
  cachedInputs: number;
  ranInputs: number;
  timings: IPassCostAssetRow[];
}

/** Counts one compile-cache-served input for every pass: the cache decision is the source. */
function recordCachedInputs(
  costInputs: Map<string, IPassCostRecord>,
  passNames: readonly string[],
): void {
  for (const name of passNames) {
    const record = costInputs.get(name);
    if (record !== undefined) record.cachedInputs += 1;
  }
}

function recordRanTimings(
  costInputs: Map<string, IPassCostRecord>,
  logical: string,
  timings: readonly IPassTiming[],
): void {
  for (const timing of timings) {
    const record = costInputs.get(timing.name);
    if (record === undefined) continue;
    record.ranInputs += 1;
    record.timings.push({ durationMs: timing.durationMs, logicalPath: logical });
  }
}

/** Fails closed: every pass must account for every input, ran or cached, or nothing is emitted. */
function assertCompletePassCosts(
  costInputs: ReadonlyMap<string, IPassCostRecord>,
  inputCount: number,
): void {
  for (const [pass, record] of costInputs) {
    if (record.ranInputs + record.cachedInputs !== inputCount) {
      throw new Error(
        `TN_ASSETS_PASS_COST_INCOMPLETE: pass '${pass}' accounts for ${record.ranInputs} ran + ${record.cachedInputs} cached of ${inputCount} input(s); refusing to emit a cost report with a hole in it.`,
      );
    }
  }
}

/** Rows in registry order; per-asset rows sorted by logical path so two bakes diff cleanly. */
function buildPassCostRows(
  costInputs: ReadonlyMap<string, IPassCostRecord>,
): readonly IPassCostRow[] {
  const rows: IPassCostRow[] = [];
  for (const [pass, record] of costInputs) {
    const status: PassCostStatus = record.ranInputs > 0 ? "ran" : "cached";
    rows.push({
      assets: [...record.timings].sort((left, right) =>
        left.logicalPath < right.logicalPath ? -1 : 1,
      ),
      cachedInputs: record.cachedInputs,
      durationMs: record.timings.reduce((total, timing) => total + timing.durationMs, 0),
      pass,
      ranInputs: record.ranInputs,
      status,
    });
  }
  return rows;
}

async function writeOutput(
  outputRoot: string,
  entry: IAssetManifestEntry,
  buffer: Buffer,
): Promise<void> {
  const outputAbsolute = path.join(outputRoot, entry.output);
  await mkdir(path.dirname(outputAbsolute), { recursive: true });
  await writeFile(outputAbsolute, buffer);
}

async function writeManifest(
  manifestPath: string,
  outputRoot: string,
  raw: string | undefined,
  entries: Record<string, IAssetManifestEntry>,
): Promise<void> {
  const manifest: IAssetManifest = { version: 1, entries: {} };
  for (const logical of Object.keys(entries).sort()) {
    const entry = entries[logical];
    if (entry !== undefined) manifest.entries[logical] = entry;
  }
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (serialized === raw) return;
  await mkdir(outputRoot, { recursive: true });
  const temporary = `${manifestPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, serialized, "utf8");
    await rename(temporary, manifestPath);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

/** Every file under `root`, as paths relative to it with `/` separators on every platform. */
async function walkOutputFiles(root: string, prefix = ""): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await walkOutputFiles(root, relative)));
    else files.push(relative);
  }
  return files;
}

/**
 * Fails the build when this run created a file under the output root that no pass declared.
 *
 * Without this, a pass that writes a file it does not report is invisible: the delete-test would
 * delete less than the bake produced, the second run would still find the undeleted file, and the
 * gate would pass while proving nothing. Only files touched during this run are considered — a
 * project's own hand-authored `public/icon.png` is not a bake output and is left alone.
 */
async function assertNoUndeclaredOutputs(
  outputRoot: string,
  declared: ReadonlySet<string>,
  since: number,
  writtenBefore: ReadonlySet<string>,
): Promise<void> {
  const undeclared: string[] = [];
  for (const relative of await walkOutputFiles(outputRoot)) {
    if (
      relative === MANIFEST_NAME ||
      relative === RECEIPT_NAME ||
      relative === PENDING_RECEIPT_NAME
    )
      continue;
    if (declared.has(relative)) continue;
    // A file the previous receipt lists was written by an earlier bake, however close its mtime
    // is to this run's start: with the cache skipping unchanged inputs, two bakes can be one
    // millisecond apart, and the previous bake's now-stale output is not this bake's leak.
    if (writtenBefore.has(relative)) continue;
    const info = await stat(path.join(outputRoot, relative));
    if (info.mtimeMs + 1 >= since) undeclared.push(relative);
  }
  if (undeclared.length > 0) {
    throw new Error(
      `TN_ASSETS_UNDECLARED_OUTPUT: this bake wrote ${undeclared.length} file(s) under '${outputRoot}' that no pass declared, so the delete-test cannot remove them: ${undeclared.sort().join(", ")}`,
    );
  }
}

/**
 * Writes the receipt, sorted by path so two builds of the same inputs are byte-identical.
 *
 * Throws rather than writing an empty list: a bake that produced nothing and said so in a green
 * receipt is exactly the shape of the v1 harness failure this repository already paid for — a
 * gate that reports success over an empty set.
 */
async function writeReceipt(
  outputRoot: string,
  outputs: readonly IBakeReceiptOutput[],
): Promise<IBakeReceipt> {
  if (outputs.length === 0) {
    throw new Error(
      `TN_ASSETS_EMPTY_RECEIPT: the compile step produced no outputs for '${outputRoot}', so there is nothing a delete-test could remove.`,
    );
  }
  const seen = new Map<string, IBakeReceiptOutput>();
  for (const output of outputs) {
    // Several inputs can declare one shared output (an image two models embed). The survivor is
    // chosen by the lexicographically smallest source, not by arrival: under a scheduler whose
    // completion order is not input order, a last-writer-wins merge would make the receipt's
    // provenance depend on which worker finished first. The path, bytes and producer are
    // identical across the contenders; only this tie-break needs a stable rule.
    const existing = seen.get(output.path);
    if (existing === undefined || (output.source ?? "") < (existing.source ?? "")) {
      seen.set(output.path, output);
    }
  }
  const receipt: IBakeReceipt = {
    outputs: [...seen.values()].sort((left, right) => (left.path < right.path ? -1 : 1)),
    pipelineVersion: PIPELINE_VERSION,
  };
  await mkdir(outputRoot, { recursive: true });
  await writeFile(
    path.join(outputRoot, RECEIPT_NAME),
    `${JSON.stringify(receipt, null, 2)}\n`,
    "utf8",
  );
  return receipt;
}

/**
 * Resolves three's Basis transcoder through the project's own `three` install so a path that
 * moved between three versions fails the build here, as a named error, instead of 404ing at
 * runtime inside the KTX2 loader.
 */
export function resolveBasisTranscoder(cwd: string): IBasisTranscoder {
  try {
    const javascriptPath = createRequire(path.join(cwd, "package.json")).resolve(
      "three/examples/jsm/libs/basis/basis_transcoder.js",
    );
    return { javascriptPath, wasmPath: javascriptPath.replace(/\.js$/u, ".wasm") };
  } catch (error) {
    throw new Error(
      `TN_ASSETS_TRANSCODER_MISSING: could not resolve three's Basis transcoder from '${cwd}': ${messageOf(error)}. The runtime KTX2 loader needs it copied next to the compiled assets.`,
    );
  }
}

async function copyBasisTranscoder(
  outputRoot: string,
  transcoder: IBasisTranscoder,
): Promise<void> {
  const target = path.join(outputRoot, BASIS_DIRECTORY);
  try {
    await mkdir(target, { recursive: true });
    await copyFile(transcoder.javascriptPath, path.join(target, "basis_transcoder.js"));
    await copyFile(transcoder.wasmPath, path.join(target, "basis_transcoder.wasm"));
  } catch (error) {
    throw new Error(
      `TN_ASSETS_TRANSCODER_MISSING: could not copy the Basis transcoder into '${target}': ${messageOf(error)}`,
    );
  }
}

export async function compileAssets(
  options: IAssetCompileOptions = {},
): Promise<IAssetCompileResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const layout = resolveLayout(cwd, options);
  const receiptPath = path.join(layout.outputRoot, RECEIPT_NAME);
  const manifestPath = path.join(layout.outputRoot, MANIFEST_NAME);
  const pendingReceiptPath = path.join(layout.outputRoot, PENDING_RECEIPT_NAME);
  const successfulBefore = await readPreviousReceiptPaths(receiptPath);
  const failedBefore = await readPreviousReceiptPaths(pendingReceiptPath);
  const writtenBefore = new Set([...successfulBefore, ...failedBefore]);
  if (!(await hasSourceDirectory(layout.sourceRoot))) {
    await removeStaleReceiptOutputs(layout.outputRoot, writtenBefore, new Set());
    for (const line of formatBudget(
      await measureBudget({}, layout.outputRoot, layout.runtimeDecoderCapabilities, layout.budget),
    ))
      console.log(line);
    await rm(manifestPath, { force: true });
    await rm(receiptPath, { force: true });
    await rm(pendingReceiptPath, { force: true });
    return { concurrencyUsed: 1, passCosts: [], skipped: 0, skippedCompression: [], written: 0 };
  }
  const previous = await readExistingManifest(manifestPath);

  // Read before the first write *and before the source walk*, so the undeclared-output guard can
  // tell this run's files from the project's own static ones. Taking it after the walk shrinks the
  // margin by however long the walk took, and `TN_ASSETS_UNDECLARED_OUTPUT` then misses a stray
  // file whose mtime the filesystem truncated below it — which is exactly how
  // `bake-receipt.spec.ts` went red on a loaded CI shard while passing locally. It never reaches
  // the receipt: that stays deterministic.
  const runStart = Date.now();

  const sources = await walkSources(layout.sourceRoot);
  const excluded = sources.filter((logical) =>
    layout.exclude.some((glob) => globMatch(glob, logical)),
  );
  const excludedSet = new Set(excluded);
  const logicals = sources.filter((logical) => !excludedSet.has(logical));
  let excludedBytes = 0;
  for (const logical of excluded)
    excludedBytes += (await stat(path.join(layout.sourceRoot, logical))).size;
  console.log(`TN_ASSETS_EXCLUDED: ${excluded.length} file(s), ${excludedBytes} bytes`);
  // The determinism gate's seam: reversed processing order reverses which input's work completes
  // first, so the gate can prove the emitted bytes do not depend on it.
  if (options.processingOrder === "reversed") logicals.reverse();

  /**
   * The Blender importer joins the chain only when this source tree actually holds something it
   * owns, which is why the walk happens before the pass list is fixed.
   *
   * It was unconditional first, and that hung `threenative build` for every project shipping
   * `assets: { models: "none", textures: "none" }` — every template that targets mobile. With both
   * set to "none" the built-in chain is *empty*, and an empty `passSpecs` is what tells the driver
   * not to create a worker pool at all (`layout.passSpecs.length > 0 && concurrency > 1`). One
   * unconditional no-op pass flipped that to a pool for a chain that can never do anything, and
   * `threenative build --target web` finished its work and then never exited — 45 minutes to a
   * job timeout in CI, reproduced locally at exit code 124.
   *
   * A game with no importable source now pays one extension test per input and nothing else,
   * which is also what its manifest should say: `passes` lists the chain that ran.
   */
  const importsModels = logicals.some((logical) => needsBlenderImport(logical));
  const activePasses = importsModels
    ? layout.passes
    : layout.passes.filter((pass) => pass.name !== BLENDER_IMPORT_PASS);
  const activePassSpecs = importsModels
    ? layout.passSpecs
    : layout.passSpecs.filter((spec) => spec.kind !== "blender-import");

  const passNames = activePasses.map((pass) => pass.name);
  const passCacheKeys = activePasses.map((pass) => pass.cacheKey ?? null);
  const passConfiguration = JSON.stringify({
    ...(passCacheKeys.some((key) => key !== null) ? { passCacheKeys } : {}),
    pipelineVersion: PIPELINE_VERSION,
    passes: passNames,
    options: activePasses.map((pass) => pass.configuration ?? null),
  });
  const entries: Record<string, IAssetManifestEntry> = {};
  const receiptOutputs: IBakeReceiptOutput[] = [];
  const costInputs = new Map<string, IPassCostRecord>();
  for (const name of passNames)
    costInputs.set(name, { cachedInputs: 0, ranInputs: 0, timings: [] });

  const healthInputs: IAssetHealthInput[] = [];
  const audioRows: IAudioRow[] = [];
  const textureRows: ITextureSizeRow[] = [];
  const modelRows: IModelSizeRow[] = [];
  let written = 0;
  let skipped = 0;
  let textureCount = 0;
  let compressedModelCount = 0;

  // An empty (or dotfile-only) source must never publish an empty manifest: the runtime treats
  // a served manifest as authoritative and would reject every load against it. A source that
  // held inputs last build drops its stale manifest here, restoring the no-manifest fallback.
  if (logicals.length === 0) {
    for (const line of formatBudget(
      await measureBudget({}, layout.outputRoot, layout.runtimeDecoderCapabilities, layout.budget),
    ))
      console.log(line);
    await removeStaleReceiptOutputs(layout.outputRoot, writtenBefore, new Set());
    if (previous.raw !== undefined) await rm(manifestPath, { force: true });
    await rm(receiptPath, { force: true });
    await rm(pendingReceiptPath, { force: true });
    const report = await runHealthReport([], layout.targets);
    return options.health === true
      ? {
          concurrencyUsed: 1,
          passCosts: [],
          report,
          skipped: 0,
          skippedCompression: [],
          written: 0,
        }
      : { concurrencyUsed: 1, passCosts: [], skipped: 0, skippedCompression: [], written: 0 };
  }

  const pendingPaths = new Set(failedBefore);
  let pendingUpdate = Promise.resolve();
  const recordPendingOutputs = async (outputs: readonly string[]): Promise<void> => {
    for (const output of outputs) pendingPaths.add(output);
    // `processOne` may have several runners. Serialize journal writes so one runner cannot publish
    // an older snapshot after another has already recorded more owned outputs.
    pendingUpdate = pendingUpdate.then(() =>
      writePendingOwnership(layout.outputRoot, pendingPaths),
    );
    await pendingUpdate;
  };

  /** Everything one entry contributes to the receipt, the health report and the size report.
   *
   * `measured` is what the health report reads. For everything the runtime can already load it is
   * the source, deliberately — see the comment at the `healthInputs.push` below. For a `.fbx`,
   * `.blend`, `.obj` or `.dae` it is the converted GLB, because the source is not a document this
   * reader knows: measuring it raised TN_ASSETS_MODEL_UNREADABLE and failed the whole compile. */
  const bookkeep = (
    logical: string,
    measured: Buffer,
    entry: IAssetManifestEntry,
    auxiliary: readonly {
      readonly bytes: number;
      readonly path: string;
      readonly producer: string;
    }[],
    lightmap: IModelSizeRow["lightmap"] | undefined,
  ): void => {
    // Declared from the entry rather than from the write below, because a cache hit skips the
    // write and the file is still this bake's output: the delete-test has to remove it too.
    receiptOutputs.push({
      bytes: entry.bytes,
      path: entry.output,
      producer: passNames.join("+"),
      source: logical,
    });
    for (const output of auxiliary) receiptOutputs.push({ ...output, source: logical });
    if (entry.extensions?.includes(BASISU_EXTENSION) === true) compressedModelCount += 1;
    // The health report measures the source, not the compiled bytes — deliberately for both
    // kinds. Texture dimensions, alpha and power-of-two are authoring properties a KTX2
    // output hides; model triangles and materials are the counts targets are declared
    // against, and the pass's self-verification guarantees they survive compilation within
    // tolerance. Byte savings are reported per kind below instead. A Blender-imported source is
    // the exception the caller resolves: its earliest readable form is the converted GLB.
    healthInputs.push({
      data: measured,
      logicalPath: logical,
      ...(needsBlenderImport(logical)
        ? { modelPath: path.join(layout.outputRoot, entry.output) }
        : {}),
    });
    if (entry.audio !== undefined) {
      // Routed before the texture branch: an audio entry carries `bytesBefore` and no triangle
      // count, which is exactly the shape the texture fallback below claims for itself.
      audioRows.push(entry.audio);
      return;
    }
    if (entry.bytesBefore === undefined) return;
    if (entry.triangles !== undefined) {
      modelRows.push({
        after: entry.bytes,
        before: entry.bytesBefore,
        ...(entry.embeddedTextures === undefined
          ? {}
          : { embeddedTextures: entry.embeddedTextures }),
        ...(entry.simplify === undefined ? {} : { simplify: entry.simplify }),
        extensions: entry.extensions,
        logicalPath: logical,
        ...(lightmap === undefined ? {} : { lightmap }),
        triangles: entry.triangles,
      });
    } else {
      textureRows.push({
        after: entry.bytes,
        before: entry.bytesBefore,
        // Read off the manifest entry, not off the pass: a cache hit reuses the previous entry
        // and never runs the pass that decided this, and a silent flat row is what let an
        // uncompressed texture look like a compressed one.
        ...(entry.compressionSkipped === undefined
          ? {}
          : { compressionSkipped: entry.compressionSkipped }),
        format: entry.format,
        logicalPath: logical,
      });
      textureCount += 1;
    }
  };

  // The scheduler: independent work runs bounded-concurrent, everything that depends on order
  // — the merge, the writes, the counters — stays on this thread and is keyed or
  // stable-merged, which the determinism gate proves. A compile with custom passes has no
  // serialisable mirror and runs sequential.
  const concurrency = resolveConcurrency(options.concurrency ?? layout.concurrency);
  const pool =
    activePassSpecs.length > 0 && concurrency > 1
      ? createPassPool(concurrency, activePassSpecs, layout.outputRoot)
      : undefined;

  const processOne = async (logical: string): Promise<void> => {
    const input = await readInput(layout.sourceRoot, logical);
    const digest = createHash("sha256")
      .update(input)
      .update(passConfiguration, "utf8")
      .digest("hex");
    // The output name carries the digest of the input bytes and the whole pass configuration,
    // so a previous entry under that exact name, with every file it declares still on disk, is
    // this build's answer already: the passes are not run again. A build once applied every
    // pass to every input and only then compared — minutes of texture encoding per `pnpm dev`
    // for bytes that already existed.
    const previousEntry = previous.entries[logical];
    const reusable =
      previousEntry === undefined
        ? undefined
        : await reusableEntry(layout.outputRoot, logical, digest.slice(0, 8), previousEntry);
    if (previousEntry !== undefined && reusable !== undefined) {
      entries[logical] = previousEntry;
      // A cache hit never ran the converter, so the GLB the report must measure is the one already
      // on disk under this entry's output name.
      const measured = needsBlenderImport(logical)
        ? await readFile(path.join(layout.outputRoot, previousEntry.output))
        : input;
      bookkeep(logical, measured, previousEntry, reusable, undefined);
      recordCachedInputs(costInputs, passNames);
      skipped += 1;
      return;
    }
    const applied =
      pool === undefined
        ? await applyPasses(activePasses, input, logical)
        : await pool.run(logical, input);
    recordRanTimings(costInputs, logical, applied.timings);
    const auxiliaryOutputs = resolveAuxiliaryOutputs(logical, applied.auxiliaryOutputs);
    const auxiliaryFields = auxiliaryManifestFields(auxiliaryOutputs);
    const extensions = Array.isArray(applied.entry?.extensions)
      ? (applied.entry.extensions as string[])
      : sourceModelExtensions(logical, input);
    const entry: IAssetManifestEntry = {
      bytes: applied.buffer.length,
      kind: classify(logical),
      output: outputNameFor(logical, digest.slice(0, 8), applied.extension),
      passes: [...passNames],
      ...auxiliaryFields,
      ...(extensions === undefined ? {} : { extensions }),
      ...(applied.entry === undefined
        ? {}
        : {
            bytesAfter: applied.buffer.length,
            bytesBefore: input.length,
            audio: audioRow(applied.entry.audio),
            embeddedTextures: embeddedTextureRow(applied.entry.embeddedTextures),
            simplify: simplifyRow(applied.entry.simplify),
            format: typeof applied.entry.format === "string" ? applied.entry.format : undefined,
            ...(applied.entry.compressionSkipped === "block-size" ||
            applied.entry.compressionSkipped === "not-smaller"
              ? { compressionSkipped: applied.entry.compressionSkipped }
              : {}),
            importedFrom:
              typeof applied.entry.importedFrom === "string"
                ? applied.entry.importedFrom
                : undefined,
            lightmapAtlas: isRecord(applied.entry.lightmapAtlas)
              ? applied.entry.lightmapAtlas
              : undefined,
            triangles:
              typeof applied.entry.triangles === "number" ? applied.entry.triangles : undefined,
            transcodeTargets: Array.isArray(applied.entry.transcodeTargets)
              ? (applied.entry.transcodeTargets as string[])
              : undefined,
            vertices:
              typeof applied.entry.vertices === "number" ? applied.entry.vertices : undefined,
          }),
    };
    entries[logical] = entry;
    const lightmapOutput = auxiliaryOutputs.find((output) => output.manifestField === "lightmaps");
    const lightmapMetadata = lightmapOutput?.metadata;
    const lightmapAtlas = applied.entry?.lightmapAtlas;
    const lightmap =
      lightmapOutput !== undefined &&
      isRecord(lightmapMetadata) &&
      isRecord(lightmapAtlas) &&
      typeof applied.entry?.lightmapBakeMs === "number"
        ? {
            atlasHeight: Number(lightmapAtlas.height),
            atlasWidth: Number(lightmapAtlas.width),
            bakeMs: applied.entry.lightmapBakeMs,
            bytesAfter: lightmapOutput.buffer.length,
            bytesBefore: Number(lightmapMetadata.bytesBefore),
            dilatedTexels: Number(lightmapMetadata.dilatedTexels),
            occludedTexels: Number(lightmapMetadata.occludedTexels),
            validTexels: Number(lightmapMetadata.validTexels),
          }
        : undefined;
    bookkeep(
      logical,
      needsBlenderImport(logical) ? applied.buffer : input,
      entry,
      auxiliaryOutputs.map((output) => ({
        bytes: output.buffer.length,
        path: output.output,
        producer: output.role,
      })),
      lightmap,
    );
    const existing = previous.entries[logical];
    if (
      existing !== undefined &&
      sameEntry(existing, entry) &&
      (await outputExists(path.join(layout.outputRoot, entry.output))) &&
      (
        await Promise.all(
          auxiliaryOutputs.map((output) =>
            outputExists(path.join(layout.outputRoot, output.output)),
          ),
        )
      ).every(Boolean)
    ) {
      skipped += 1;
      return;
    }
    await recordPendingOutputs([entry.output, ...auxiliaryOutputs.map((output) => output.output)]);
    await writeOutput(layout.outputRoot, entry, applied.buffer);
    for (const output of auxiliaryOutputs) {
      const absolute = path.join(layout.outputRoot, output.output);
      // A shared image is content-addressed and may already have been written by another model
      // in this run or a previous one; identical bytes are not written twice. The write itself
      // is temp-then-rename: a concurrent merge of the same image must never observe a torn
      // file, and two identical-content writers cannot interleave.
      if (output.shared && (await outputExists(absolute))) continue;
      await mkdir(path.dirname(absolute), { recursive: true });
      const temporary = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, output.buffer);
        await rename(temporary, absolute);
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
    }
    written += 1;
  };

  const queue = [...logicals];
  const runnerCount = Math.min(pool === undefined ? 1 : concurrency, queue.length);
  try {
    await Promise.all(
      Array.from({ length: runnerCount }, () =>
        (async () => {
          for (;;) {
            const logical = queue.shift();
            if (logical === undefined) return;
            await processOne(logical);
          }
        })(),
      ),
    );
  } finally {
    await pool?.dispose();
  }

  // The transcoder ships once per build next to the compiled assets; the runtime loader points
  // at `<basePath>basis/` by convention. Copied when anything (re)encoded, and restored when a
  // cleaned public/ still lists textures, so a served manifest never lacks its transcoder. A
  // project with no standalone texture at all still needs it once a model publishes
  // KHR_texture_basisu — otherwise GLTFLoader gets a KTX2Loader pointed at a 404.
  if ((layout.texturesActive && textureCount > 0) || compressedModelCount > 0) {
    const basisJs = path.join(layout.outputRoot, BASIS_DIRECTORY, "basis_transcoder.js");
    if (written > 0 || !(await outputExists(basisJs))) {
      await recordPendingOutputs([
        `${BASIS_DIRECTORY}/basis_transcoder.js`,
        `${BASIS_DIRECTORY}/basis_transcoder.wasm`,
      ]);
      await copyBasisTranscoder(
        layout.outputRoot,
        options.transcoder ?? resolveBasisTranscoder(cwd),
      );
    }
    // Copied on this run or restored from a previous one, the transcoder is still a file the
    // bake put there and the game must survive losing.
    for (const name of ["basis_transcoder.js", "basis_transcoder.wasm"]) {
      const relative = `${BASIS_DIRECTORY}/${name}`;
      const absolute = path.join(layout.outputRoot, BASIS_DIRECTORY, name);
      if (!(await outputExists(absolute))) continue;
      receiptOutputs.push({
        bytes: (await stat(absolute)).size,
        path: relative,
        producer: "basis-transcoder",
        source: null,
      });
    }
  }

  // The report runs unconditionally — it is the one place a user learns why their game is
  // slow. Only declared targets can fail it.
  assertCompletePassCosts(costInputs, logicals.length);
  const passCosts = buildPassCostRows(costInputs);
  const report = await runHealthReport(healthInputs, layout.targets);
  for (const line of formatHealthReport(report)) console.log(line);
  for (const line of formatAudioSizes(audioRows)) console.log(line);
  for (const line of formatTextureSizes(textureRows)) console.log(line);
  for (const line of formatModelSizes(modelRows)) console.log(line);
  if (
    isRecord(options.config) &&
    isRecord(options.config.models) &&
    options.config.models.sharedImages === false
  ) {
    const embeddedBytes = modelRows.reduce(
      (total, row) => total + (row.embeddedTextures?.bytesAfter ?? 0),
      0,
    );
    console.log(
      `TN_ASSETS_SHARED_IMAGES_DISABLED: assets.models.sharedImages=false; ${modelRows.length} model(s), ${embeddedBytes} image bytes embedded separately; duplicates are not shared.`,
    );
  }
  const skippedCompression = skippedCompressionRows(entries, layout);
  for (const line of formatPassCosts(passCosts)) console.log(line);
  for (const line of formatSkippedCompression(skippedCompression)) console.log(line);
  const budgetReport = await measureBudget(
    entries,
    layout.outputRoot,
    layout.runtimeDecoderCapabilities,
    layout.budget,
    receiptOutputs,
  );
  for (const line of formatBudget(budgetReport)) console.log(line);
  assertBudget(budgetReport);
  if (report.failed) {
    const failedAssets = report.findings
      .filter((finding) => finding.grade === "fail")
      .map((finding) => finding.asset);
    throw new Error(
      `TN_ASSETS_HEALTH_FAILED: ${failedAssets.length} declared asset target(s) exceeded: ${[...new Set(failedAssets)].join(", ")}`,
    );
  }
  const currentReceiptPaths = new Set(receiptOutputs.map((output) => output.path));
  await assertNoUndeclaredOutputs(layout.outputRoot, currentReceiptPaths, runStart, writtenBefore);
  const staleOutputs = await resolveStaleReceiptOutputs(
    layout.outputRoot,
    new Set([...writtenBefore, ...pendingPaths]),
    currentReceiptPaths,
  );
  // An invalid old receipt must not replace the last successful manifest with a manifest for a
  // cook that cannot commit. Validation is complete before this publication point.
  await writeManifest(manifestPath, layout.outputRoot, previous.raw, entries);
  for (const target of staleOutputs) await rm(target, { force: true });
  // Publish success only after cleanup. If validation/deletion fails, the old receipt and pending
  // journal jointly retain ownership for a reliable retry.
  const receipt = await writeReceipt(layout.outputRoot, receiptOutputs);
  await rm(pendingReceiptPath, { force: true });
  const concurrencyUsed = pool === undefined ? 1 : Math.min(concurrency, logicals.length);
  return options.health === true
    ? { concurrencyUsed, passCosts, receipt, report, skipped, skippedCompression, written }
    : { concurrencyUsed, passCosts, receipt, skipped, skippedCompression, written };
}

/**
 * Sums what each disabled built-in pass is shipping as authored.
 *
 * Reads the sizes already recorded on every manifest entry, so a build that opted out pays one
 * addition per asset and no I/O at all — the measurement must not become a reason to skip it.
 * A caller that replaced the pass registry wholesale (`options.passes`) has not opted out of
 * anything and reports nothing.
 */
function skippedCompressionRows(
  entries: Readonly<Record<string, IAssetManifestEntry>>,
  layout: ICompileLayout,
): readonly ISkippedReportRow[] {
  const rows: ISkippedReportRow[] = layout.skippedPasses.map((pass) => ({
    kind: "pass",
    pass,
    reason: "platform",
  }));
  const decisions = [
    { kind: "model" as const, reason: layout.modelCompressionReason },
    { kind: "texture" as const, reason: layout.textureCompressionReason },
  ];
  for (const { kind, reason } of decisions) {
    if (reason === undefined || !layout.builtinRegistry) continue;
    let bytes = 0;
    let files = 0;
    for (const entry of Object.values(entries)) {
      if (entry.kind !== kind) continue;
      bytes += entry.bytes;
      files += 1;
    }
    rows.push({ bytes, files, kind, reason });
  }
  return rows;
}
