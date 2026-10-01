import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Models that are the same model under different names, cooked once.
 *
 * A streamed world package ships its props exported per placement: a 2 km world carried 374
 * model files for 101 distinct models, ten copies of `map_tree_kite_scotspinetall_01_far_*`
 * alone, byte-identical in the binary chunk and identical in the glTF JSON once every `name` is
 * ignored. Name is the only difference, and it costs a full cook each: the output name carries
 * the digest of the *named* bytes, so all ten hashed apart, all ten were optimized, uploaded and
 * batched as ten models at runtime.
 *
 * The content key is therefore the binary chunk plus the glTF JSON with every `name` property
 * removed, and nothing else removed. One read per file, one hash per file: no pairwise
 * comparison and no second parse. Files that are not a GLB container and not a JSON document
 * return no key, so a model the cook will reject is grouped by nobody and still fails with its
 * own named error.
 *
 * The container is part of the key (`glb` or `gltf`), so a `.gltf` and a `.glb` holding the same
 * document never group: the same JSON can cook to two different output extensions.
 */

/** `glTF` as a little-endian uint32. */
const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export interface IModelDedupeSummary {
  /** Distinct cooked outputs among the model sources that took part. */
  readonly cooked: number;
  /** Cooked bytes the duplicates would have written on their own. */
  readonly savedBytes: number;
  /** Model sources that took part, canonicals and duplicates alike. */
  readonly sources: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digestOf(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** The glTF JSON with every `name` property gone; every other property kept as authored. */
function withoutNames(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNames);
  if (!isRecord(value)) return value;
  const kept: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "name") continue;
    kept[key] = withoutNames(item);
  }
  return kept;
}

function keyOf(
  gltf: unknown,
  binary: Uint8Array | undefined,
  container: string,
): string | undefined {
  if (!isRecord(gltf) || !isRecord(gltf.asset)) return undefined;
  const json = digestOf(JSON.stringify(withoutNames(gltf)));
  return digestOf(`${container} ${binary === undefined ? "none" : digestOf(binary)} ${json}`);
}

/** The GLB's JSON and binary chunks, or `undefined` when the container has no readable JSON. */
function glbChunks(
  input: Buffer,
): { readonly binary?: Uint8Array; readonly gltf: unknown } | undefined {
  let offset = 12;
  let gltf: unknown;
  let binary: Uint8Array | undefined;
  while (offset + 8 <= input.length) {
    const length = input.readUInt32LE(offset);
    const chunk = input.subarray(offset + 8, offset + 8 + length);
    const type = input.readUInt32LE(offset + 4);
    if (type === CHUNK_JSON) {
      try {
        gltf = JSON.parse(chunk.toString("utf8"));
      } catch {
        return undefined;
      }
    } else if (type === CHUNK_BIN) binary = chunk;
    offset += 8 + length;
  }
  return gltf === undefined ? undefined : { binary, gltf };
}

/**
 * The content key of one model source, or `undefined` when it is not a document this can read.
 *
 * Never throws: an unreadable model is the model pass's error to name, not the dedupe's.
 */
export function modelContentKey(input: Buffer): string | undefined {
  if (input.length >= 20 && input.readUInt32LE(0) === GLB_MAGIC) {
    const chunks = glbChunks(input);
    return chunks === undefined ? undefined : keyOf(chunks.gltf, chunks.binary, "glb");
  }
  // A `.gltf` is one JSON document; its data URIs are inside it, and an external buffer or image
  // is not a document this pipeline reads at all (the model pass says so by name).
  try {
    return keyOf(JSON.parse(input.toString("utf8")), undefined, "gltf");
  } catch {
    return undefined;
  }
}

/**
 * Groups model sources that would cook to the same bytes, and maps every member to the member
 * that is cooked: the lexicographically smallest source path, so the choice does not depend on
 * walk order, worker completion order or a scheduler.
 *
 * `read` defaults to reading the file under `sourceRoot`, but a caller may inject its own reader
 * so generated sources that exist only in memory (a cook-time HLOD proxy) take part without being
 * written to the authored tree.
 */
export async function groupModelSources(
  sourceRoot: string,
  models: readonly string[],
  read?: (logical: string) => Promise<Buffer>,
): Promise<ReadonlyMap<string, string>> {
  const canonicalByKey = new Map<string, string>();
  const canonicalOf = new Map<string, string>();
  for (const logical of [...models].sort()) {
    let key: string | undefined;
    try {
      const bytes =
        read === undefined ? await readFile(path.join(sourceRoot, logical)) : await read(logical);
      key = modelContentKey(bytes);
    } catch {
      continue;
    }
    if (key === undefined) continue;
    const canonical = canonicalByKey.get(key);
    if (canonical === undefined) canonicalByKey.set(key, logical);
    else canonicalOf.set(logical, canonical);
  }
  return canonicalOf;
}

/** The cook's one line for the dedupe, printed beside the size reports. */
export function formatModelDedupe(summary: IModelDedupeSummary): string {
  return `TN_ASSET_MODEL_DEDUPE sources=${String(summary.sources)} cooked=${String(summary.cooked)} saved=${String(summary.savedBytes)}`;
}
