import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { formatHealthReport, runHealthReport } from "./health.js";
import type { IAssetHealthInput, IAssetHealthReport } from "./health.js";
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
import { texturePass } from "./passes/texture.js";
import type { ITextureOverride, ITexturePassOptions } from "./passes/texture.js";
import { formatModelSizes, formatTextureSizes } from "./report.js";
import type {
  IEmbeddedTextureRow,
  IModelSizeRow,
  ISimplifyRow,
  ITextureSizeRow,
} from "./report.js";

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
  /** Stable filename segment, for example `lightmap`. */
  readonly role: string;
}

export interface IAssetPass {
  /** Deterministic settings that change output bytes; omitted for identity/default passes. */
  readonly cacheKey?: string;
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

export interface ITexturesConfig {
  readonly overrides?: readonly ITextureOverride[];
  readonly quality?: number;
}

export interface IAssetCompileOptions {
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
  readonly source?: string;
  /** Overrides resolution of three's Basis transcoder for the copy into the output root. */
  readonly transcoder?: IBasisTranscoder;
}

export interface IBasisTranscoder {
  readonly javascriptPath: string;
  readonly wasmPath: string;
}

export interface IAssetCompileResult {
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
  readonly outputRoot: string;
  readonly passes: readonly IAssetPass[];
  readonly sourceRoot: string;
  readonly targets: IAssetTargets;
  /** True when the built-in KTX2 pass is part of `passes` (drives the transcoder copy). */
  readonly texturesActive: boolean;
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
 */
const PIPELINE_VERSION = 8;

const KIND_BY_EXTENSION: Readonly<Record<string, AssetKind>> = {
  glb: "model",
  gltf: "model",
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
    gpuBytesAfter: value.gpuBytesAfter as number,
    gpuBytesBefore: value.gpuBytesBefore as number,
    resized: value.resized as number,
  };
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
    if (key !== "quality" && key !== "overrides") {
      throw new Error(`TN_ASSETS_CONFIG_UNKNOWN_KEY: assets.textures.${key} is not recognised.`);
    }
  }
  return {
    ...(raw.quality === undefined
      ? {}
      : { quality: textureQuality(raw.quality, "assets.textures.quality") }),
    ...(raw.overrides === undefined ? {} : { overrides: validateTextureOverrides(raw.overrides) }),
  };
}

/** `"none"` disables the built-in model pass; an object configures it; absent means defaults. */
function parseModelsConfig(raw: unknown): IModelPassOptions | undefined {
  if (raw === undefined) return {};
  if (raw === "none") return undefined;
  if (!isRecord(raw)) {
    throw new Error('TN_ASSETS_CONFIG_INVALID: assets.models must be "none" or an object.');
  }
  const allowed = ["lightmap", "passes", "quantize", "simplify", "textures", "virtual"];
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
  return {
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
  const textures = parseTexturesConfig(config.textures);
  const models = parseModelsConfig(config.models);
  const lightmap = (models as (IModelPassOptions & { lightmap?: ILightmapPassOptions }) | undefined)
    ?.lightmap;
  // The built-in registry runs only when the caller did not replace it wholesale; each
  // built-in pass drops out individually through its `"none"` shorthand.
  const builtinPasses =
    options.passes === undefined
      ? [
          ...(textures !== undefined ? [texturePass(textures)] : []),
          ...(lightmap !== undefined ? [lightmapPass(lightmap)] : []),
          ...(models !== undefined
            ? [modelPass({ ...models, preserveLightmapUv: lightmap !== undefined })]
            : []),
        ]
      : [];
  return {
    outputRoot,
    passes: [...builtinPasses, ...(options.passes ?? [])],
    sourceRoot,
    targets: config.targets === undefined ? {} : validateTargets(config.targets),
    texturesActive: textures !== undefined && options.passes === undefined,
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
    const output = outputNameFor(
      `${stem}.${auxiliary.role}${auxiliary.extension}`,
      digest,
      auxiliary.extension,
    );
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

interface IAppliedPasses {
  readonly auxiliaryOutputs: readonly IAssetAuxiliaryOutput[];
  readonly buffer: Buffer;
  readonly entry: Record<string, unknown> | undefined;
  readonly extension: string | undefined;
}

async function applyPasses(
  passes: readonly IAssetPass[],
  input: Buffer,
  logical: string,
): Promise<IAppliedPasses> {
  let buffer = input;
  const auxiliaryOutputs: IAssetAuxiliaryOutput[] = [];
  let entry: Record<string, unknown> | undefined;
  let extension: string | undefined;
  for (const pass of passes) {
    let result: Buffer | IAssetPassOutput;
    try {
      result = await pass.apply(buffer, logical);
    } catch (error) {
      throw new Error(
        `TN_ASSETS_PASS_FAILED: pass '${pass.name}' failed for '${logical}': ${messageOf(error)}`,
      );
    }
    if (Buffer.isBuffer(result)) {
      buffer = result;
      continue;
    }
    buffer = result.buffer;
    if (result.auxiliaryOutputs !== undefined) auxiliaryOutputs.push(...result.auxiliaryOutputs);
    if (result.entry !== undefined) entry = { ...(entry ?? {}), ...result.entry };
    if (result.outputExtension !== undefined) extension = result.outputExtension;
  }
  return { auxiliaryOutputs, buffer, entry, extension };
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
  await writeFile(manifestPath, serialized, "utf8");
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
): Promise<void> {
  const undeclared: string[] = [];
  for (const relative of await walkOutputFiles(outputRoot)) {
    if (relative === MANIFEST_NAME || relative === RECEIPT_NAME) continue;
    if (declared.has(relative)) continue;
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
  for (const output of outputs) seen.set(output.path, output);
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
  if (!(await hasSourceDirectory(layout.sourceRoot))) {
    // No bake ran, so no receipt describes this output root. A stale one from a previous build
    // would have the delete-test remove files nothing produces any more.
    await rm(receiptPath, { force: true });
    return { skipped: 0, written: 0 };
  }
  const manifestPath = path.join(layout.outputRoot, MANIFEST_NAME);
  const previous = await readExistingManifest(manifestPath);
  const passNames = layout.passes.map((pass) => pass.name);
  const passCacheKeys = layout.passes.map((pass) => pass.cacheKey ?? null);
  const passConfiguration = JSON.stringify({
    ...(passCacheKeys.some((key) => key !== null) ? { passCacheKeys } : {}),
    pipelineVersion: PIPELINE_VERSION,
    passes: passNames,
    options: layout.passes.map((pass) => pass.configuration ?? null),
  });
  const entries: Record<string, IAssetManifestEntry> = {};
  const receiptOutputs: IBakeReceiptOutput[] = [];
  // Read before the first write, so the undeclared-output guard can tell this run's files from
  // the project's own static ones. It never reaches the receipt: that stays deterministic.
  const runStart = Date.now();
  const healthInputs: IAssetHealthInput[] = [];
  const textureRows: ITextureSizeRow[] = [];
  const modelRows: IModelSizeRow[] = [];
  let written = 0;
  let skipped = 0;
  let textureCount = 0;
  let compressedModelCount = 0;

  const logicals = await walkSources(layout.sourceRoot);

  // An empty (or dotfile-only) source must never publish an empty manifest: the runtime treats
  // a served manifest as authoritative and would reject every load against it. A source that
  // held inputs last build drops its stale manifest here, restoring the no-manifest fallback.
  if (logicals.length === 0) {
    if (previous.raw !== undefined) await rm(manifestPath, { force: true });
    await rm(receiptPath, { force: true });
    const report = await runHealthReport([], layout.targets);
    return options.health === true
      ? { report, skipped: 0, written: 0 }
      : { skipped: 0, written: 0 };
  }

  for (const logical of logicals) {
    const input = await readInput(layout.sourceRoot, logical);
    const applied = await applyPasses(layout.passes, input, logical);
    const auxiliaryOutputs = resolveAuxiliaryOutputs(logical, applied.auxiliaryOutputs);
    const auxiliaryFields = auxiliaryManifestFields(auxiliaryOutputs);
    const digest = createHash("sha256")
      .update(input)
      .update(passConfiguration, "utf8")
      .digest("hex");
    const entry: IAssetManifestEntry = {
      bytes: applied.buffer.length,
      kind: classify(logical),
      output: outputNameFor(logical, digest.slice(0, 8), applied.extension),
      passes: [...passNames],
      ...auxiliaryFields,
      ...(applied.entry === undefined
        ? {}
        : {
            bytesAfter: applied.buffer.length,
            bytesBefore: input.length,
            embeddedTextures: embeddedTextureRow(applied.entry.embeddedTextures),
            simplify: simplifyRow(applied.entry.simplify),
            extensions: Array.isArray(applied.entry.extensions)
              ? (applied.entry.extensions as string[])
              : undefined,
            format: typeof applied.entry.format === "string" ? applied.entry.format : undefined,
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
    // Declared from the entry rather than from the write below, because a cache hit skips the
    // write and the file is still this bake's output: the delete-test has to remove it too.
    receiptOutputs.push({
      bytes: entry.bytes,
      path: entry.output,
      producer: passNames.join("+"),
      source: logical,
    });
    for (const auxiliary of auxiliaryOutputs) {
      receiptOutputs.push({
        bytes: auxiliary.buffer.length,
        path: auxiliary.output,
        producer: auxiliary.role,
        source: logical,
      });
    }
    if (entry.extensions?.includes(BASISU_EXTENSION) === true) compressedModelCount += 1;
    // The health report measures the source, not the compiled bytes — deliberately for both
    // kinds. Texture dimensions, alpha and power-of-two are authoring properties a KTX2
    // output hides; model triangles and materials are the counts targets are declared
    // against, and the pass's self-verification guarantees they survive compilation within
    // tolerance. Byte savings are reported per kind below instead.
    healthInputs.push({ data: input, logicalPath: logical });
    if (entry.bytesBefore !== undefined) {
      if (entry.triangles !== undefined) {
        const lightmapOutput = auxiliaryOutputs.find(
          (output) => output.manifestField === "lightmaps",
        );
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
          format: entry.format,
          logicalPath: logical,
        });
        textureCount += 1;
      }
    }
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
      continue;
    }
    await writeOutput(layout.outputRoot, entry, applied.buffer);
    for (const output of auxiliaryOutputs) {
      await mkdir(path.dirname(path.join(layout.outputRoot, output.output)), { recursive: true });
      await writeFile(path.join(layout.outputRoot, output.output), output.buffer);
    }
    written += 1;
  }

  // The transcoder ships once per build next to the compiled assets; the runtime loader points
  // at `<basePath>basis/` by convention. Copied when anything (re)encoded, and restored when a
  // cleaned public/ still lists textures, so a served manifest never lacks its transcoder. A
  // project with no standalone texture at all still needs it once a model publishes
  // KHR_texture_basisu — otherwise GLTFLoader gets a KTX2Loader pointed at a 404.
  if ((layout.texturesActive && textureCount > 0) || compressedModelCount > 0) {
    const basisJs = path.join(layout.outputRoot, BASIS_DIRECTORY, "basis_transcoder.js");
    if (written > 0 || !(await outputExists(basisJs))) {
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
  const report = await runHealthReport(healthInputs, layout.targets);
  for (const line of formatHealthReport(report)) console.log(line);
  for (const line of formatTextureSizes(textureRows)) console.log(line);
  for (const line of formatModelSizes(modelRows)) console.log(line);
  if (report.failed) {
    const failedAssets = report.findings
      .filter((finding) => finding.grade === "fail")
      .map((finding) => finding.asset);
    throw new Error(
      `TN_ASSETS_HEALTH_FAILED: ${failedAssets.length} declared asset target(s) exceeded: ${[...new Set(failedAssets)].join(", ")}`,
    );
  }
  await writeManifest(manifestPath, layout.outputRoot, previous.raw, entries);
  await assertNoUndeclaredOutputs(
    layout.outputRoot,
    new Set(receiptOutputs.map((output) => output.path)),
    runStart,
  );
  const receipt = await writeReceipt(layout.outputRoot, receiptOutputs);
  return options.health === true
    ? { receipt, report, skipped, written }
    : { receipt, skipped, written };
}
