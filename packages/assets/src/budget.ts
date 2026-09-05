import { open, stat } from "node:fs/promises";
import path from "node:path";
import type { TextureSkipReason } from "./passes/texture.js";

export interface IAssetBudget {
  readonly uncooked: number | "none";
  readonly total: number | "none";
}

export interface IBudgetRow {
  readonly logicalPath: string;
  readonly total: number;
  readonly uncooked: number;
}

export interface IBudgetReport {
  readonly budget: IAssetBudget;
  readonly rows: readonly IBudgetRow[];
  readonly total: number;
  readonly uncooked: number;
}

export function parseBudget(value: unknown): IAssetBudget {
  if (value === "none") return { total: "none", uncooked: "none" };
  const raw = typeof value === "number" ? { uncooked: value } : value === undefined ? {} : value;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(
      "TN_ASSETS_CONFIG_INVALID: assets.budget must be an object, positive integer, or 'none'.",
    );
  }
  for (const [key, ceiling] of Object.entries(raw)) {
    if (key !== "uncooked" && key !== "total") {
      throw new Error(`TN_ASSETS_CONFIG_UNKNOWN_KEY: assets.budget.${key} is not recognised.`);
    }
    if (
      ceiling !== "none" &&
      !(typeof ceiling === "number" && Number.isSafeInteger(ceiling) && ceiling > 0)
    ) {
      throw new Error(
        `TN_ASSETS_CONFIG_INVALID: assets.budget.${key} must be a positive integer or 'none'.`,
      );
    }
  }
  const parsed = raw as Partial<IAssetBudget>;
  return { uncooked: parsed.uncooked ?? 64_000_000, total: parsed.total ?? "none" };
}

interface IOutput {
  readonly bytes: number;
  readonly output: string;
  readonly kind?: string;
  readonly compressionSkipped?: TextureSkipReason;
  readonly embeddedTextures?: {
    readonly skippedCompression?: Readonly<Record<string, TextureSkipReason>>;
  };
}

interface ICompilerOutput {
  readonly path: string;
  readonly source: string | null;
}

interface IGltf {
  readonly bufferViews?: readonly {
    readonly byteLength: number;
    readonly extensions?: Readonly<Record<string, unknown>>;
  }[];
  readonly images?: readonly {
    readonly bufferView?: number;
    readonly mimeType?: string;
    readonly name?: string;
    readonly uri?: string;
  }[];
  readonly meshes?: readonly {
    readonly primitives: readonly {
      readonly extensions?: {
        readonly KHR_draco_mesh_compression?: { readonly bufferView: number };
      };
    }[];
  }[];
}

/** Read only the GLB header and JSON, never duplicate a pack's hundreds of MB of image data. */
async function uncookedModel(
  filename: string,
  bytes: number,
  skipped: Readonly<Record<string, TextureSkipReason>> = {},
  exemptImages = new Set<string>(),
): Promise<number> {
  const file = await open(filename, "r");
  try {
    const header = Buffer.alloc(20);
    await file.read(header, 0, header.length, 0);
    if (header.readUInt32LE(0) !== 0x46546c67 || header.readUInt32LE(16) !== 0x4e4f534a)
      return bytes;
    const jsonLength = header.readUInt32LE(12);
    if (jsonLength > bytes - 20)
      throw new Error(`TN_ASSETS_OUTPUT_INVALID: truncated GLB ${filename}`);
    const json = Buffer.alloc(jsonLength);
    const read = await file.read(json, 0, jsonLength, 20);
    if (read.bytesRead !== jsonLength)
      throw new Error(`TN_ASSETS_OUTPUT_INVALID: truncated GLB ${filename}`);
    const gltf = JSON.parse(json.toString("utf8")) as IGltf;
    const compressed = new Set<number>();
    for (const image of gltf.images ?? []) {
      if (image.bufferView !== undefined && image.mimeType === "image/ktx2")
        compressed.add(image.bufferView);
      // `not-smaller` only, and deliberately: encoding this image could not have saved a byte,
      // so charging it would fail a gate nobody can pass. `block-size` is charged, because a
      // resize to a multiple of four is a fix the project can actually make.
      if (image.name !== undefined && skipped[image.name] === "not-smaller") {
        if (image.bufferView !== undefined) compressed.add(image.bufferView);
        if (image.uri !== undefined)
          exemptImages.add(path.resolve(path.dirname(filename), image.uri));
      }
    }
    for (const mesh of gltf.meshes ?? []) {
      for (const primitive of mesh.primitives) {
        const draco = primitive.extensions?.KHR_draco_mesh_compression;
        if (draco !== undefined) compressed.add(draco.bufferView);
      }
    }
    let raw = 0;
    for (const [index, view] of (gltf.bufferViews ?? []).entries()) {
      if (compressed.has(index) || view.extensions?.EXT_meshopt_compression !== undefined) continue;
      if (!Number.isSafeInteger(view.byteLength) || view.byteLength < 0)
        throw new Error(`TN_ASSETS_OUTPUT_INVALID: invalid bufferView in ${filename}`);
      raw += view.byteLength;
    }
    // GLB framing/JSON is not geometry or texture data a compression pass can encode.
    return Math.min(bytes, raw);
  } finally {
    await file.close();
  }
}

/** Emitted payloads are authoritative, including on cache hits and when a custom pass ran. */
export async function measureBudget(
  entries: Readonly<Record<string, IOutput>>,
  outputRoot: string,
  decodesCompression: boolean,
  budget: IAssetBudget,
  compilerOutputs: readonly ICompilerOutput[] = [],
): Promise<IBudgetReport> {
  const seen = new Set<string>();
  const exemptImages = new Set<string>();
  const modelBytes = new Map<string, number>();
  if (decodesCompression) {
    for (const entry of Object.values(entries)) {
      if (path.extname(entry.output).toLowerCase() !== ".glb" || modelBytes.has(entry.output))
        continue;
      modelBytes.set(
        entry.output,
        await uncookedModel(
          path.join(outputRoot, entry.output),
          (await stat(path.join(outputRoot, entry.output))).size,
          entry.embeddedTextures?.skippedCompression,
          exemptImages,
        ),
      );
    }
  }
  const rows: IBudgetRow[] = [];
  for (const [logicalPath, entry] of Object.entries(entries).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const outputs: IOutput[] = [entry];
    for (const field of Object.values(entry)) {
      if (!Array.isArray(field)) continue;
      for (const auxiliary of field) {
        if (
          typeof auxiliary === "object" &&
          auxiliary !== null &&
          typeof auxiliary.output === "string" &&
          typeof auxiliary.bytes === "number"
        )
          outputs.push(auxiliary as IOutput);
      }
    }
    let total = 0;
    let uncooked = 0;
    for (const output of outputs) {
      if (seen.has(output.output)) continue;
      seen.add(output.output);
      const shippedBytes = (await stat(path.join(outputRoot, output.output))).size;
      total += shippedBytes;
      if (!decodesCompression) continue;
      // Same split as the embedded images above: only the reason no author can act on is exempt.
      if (
        output.compressionSkipped === "not-smaller" ||
        exemptImages.has(path.resolve(outputRoot, output.output))
      )
        continue;
      const extension = path.extname(output.output).toLowerCase();
      if (extension === ".glb")
        uncooked +=
          modelBytes.get(output.output) ??
          (await uncookedModel(path.join(outputRoot, output.output), shippedBytes));
      else if (
        [".png", ".jpg", ".jpeg", ".webp"].includes(extension) ||
        (output.kind === "model" && extension !== ".ktx2")
      )
        uncooked += shippedBytes;
    }
    rows.push({ logicalPath, total, uncooked });
  }
  // Receipts also own payloads that no manifest entry references, currently the Basis JS/WASM
  // runtime. They ship in `public/`, so a total ceiling must count them. Entry and auxiliary paths
  // are already in `seen`; this loop therefore charges every physical file exactly once and never
  // treats compiler machinery as uncooked game content.
  for (const output of [...compilerOutputs].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    if (seen.has(output.path)) continue;
    seen.add(output.path);
    rows.push({
      logicalPath: output.source ?? output.path,
      total: (await stat(path.join(outputRoot, output.path))).size,
      uncooked: 0,
    });
  }
  return {
    budget,
    rows,
    total: rows.reduce((sum, row) => sum + row.total, 0),
    uncooked: rows.reduce((sum, row) => sum + row.uncooked, 0),
  };
}

export function assertBudget(report: IBudgetReport): void {
  const failures = (["uncooked", "total"] as const).filter(
    (key) => report.budget[key] !== "none" && report[key] > (report.budget[key] as number),
  );
  if (failures.length === 0) return;
  const measure = failures.includes("uncooked") ? "uncooked" : "total";
  const largest = [...report.rows]
    .filter((row) => row[measure] > 0)
    .sort((a, b) => b[measure] - a[measure] || a.logicalPath.localeCompare(b.logicalPath))
    .slice(0, 5);
  throw new Error(
    `TN_ASSETS_BUDGET_EXCEEDED: ${failures.map((key) => `${key} ${report[key]} bytes exceeds ${report.budget[key]}`).join("; ")}; largest ${measure}: ${largest.map((row) => `${row.logicalPath} ${row[measure]} bytes`).join(", ")}. Use assets.exclude or assets.budget; enable skipped model/texture compression passes and check codec:none overrides.`,
  );
}
