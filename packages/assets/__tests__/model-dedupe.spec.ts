import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it, vi } from "vitest";
import { buildFixtureDocument } from "../../../test-support/generate-fixture-model.js";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { basisTranscoderPaths } from "../../../test-support/three-basis.js";
import { modelContentKey } from "../src/content/model-dedupe.js";
import { compileAssets } from "../src/index.js";
import { modelPass } from "../src/passes/model.js";
import { unpackGlb } from "../src/passes/shared-images.js";

/**
 * A streamed world package shipped 374 model files for 101 distinct models: the same prop
 * exported per placement, ten copies of `map_tree_kite_scotspinetall_01_far_*` alone, each one
 * byte-identical in its binary chunk and identical in its glTF JSON once every `name` is ignored.
 * Ten names meant ten digests, ten cooks, ten uploads and ten runtime batches for one prop.
 *
 * These tests hold the same shape at three fixtures: two identical but for their names, and a
 * third differing in one byte of its binary chunk.
 */

/** The bare fixture: one mesh, two primitives, three joints, one clip, no embedded images. */
async function fixture(): Promise<Buffer> {
  return Buffer.from(await new NodeIO().writeBinary(buildFixtureDocument({ textured: false })));
}

function packGlb(gltf: unknown, bin: Uint8Array | undefined): Buffer {
  const json = Buffer.from(JSON.stringify(gltf), "utf8");
  // The JSON chunk pads with spaces and the binary chunk with zeros; both to four bytes.
  const jsonPad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20);
  const binPad = Buffer.alloc((4 - ((bin?.length ?? 0) % 4)) % 4);
  const total =
    12 +
    8 +
    json.length +
    jsonPad.length +
    (bin === undefined ? 0 : 8 + bin.length + binPad.length);
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  let offset = 12;
  out.writeUInt32LE(json.length + jsonPad.length, offset);
  out.writeUInt32LE(0x4e4f534a, offset + 4);
  json.copy(out, offset + 8);
  jsonPad.copy(out, offset + 8 + json.length);
  offset += 8 + json.length + jsonPad.length;
  if (bin !== undefined) {
    out.writeUInt32LE(bin.length + binPad.length, offset);
    out.writeUInt32LE(0x004e4942, offset + 4);
    Buffer.from(bin).copy(out, offset + 8);
  }
  return out;
}

function renameEveryName(value: unknown, suffix: string): unknown {
  if (Array.isArray(value)) return value.map((item) => renameEveryName(item, suffix));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      key === "name" ? `${String(item)}${suffix}` : renameEveryName(item, suffix),
    ]),
  );
}

/** The same model under different object names: same binary chunk, same JSON but for `name`. */
function renamed(input: Buffer, suffix: string): Buffer {
  const { bin, json } = unpackGlb(input);
  return packGlb(renameEveryName(json, suffix), bin);
}

/** One byte of one vertex position moved, which is a different model. */
function oneVertexByteOff(input: Buffer): Buffer {
  const { bin, json } = unpackGlb(input);
  if (bin === undefined) throw new Error("the fixture must carry a binary chunk");
  const mesh = json.meshes?.[0];
  const view = json.bufferViews?.[mesh?.primitives?.[0]?.attributes?.POSITION ?? 0];
  if (view === undefined) throw new Error("the fixture must carry a POSITION bufferView");
  const copy = Buffer.from(bin);
  const target = (view.byteOffset ?? 0) + 3;
  copy[target] = (copy[target] ?? 0) ^ 0x01;
  return packGlb(json, copy);
}

describe("modelContentKey", () => {
  it("should ignore every name and nothing else", async () => {
    const source = await fixture();
    expect(modelContentKey(renamed(source, "__a"))).toBe(modelContentKey(source));
    expect(modelContentKey(oneVertexByteOff(source))).not.toBe(modelContentKey(source));
    expect(modelContentKey(source)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("should key nothing on a file that is not a document", () => {
    expect(modelContentKey(Buffer.from("not a model"))).toBeUndefined();
    expect(modelContentKey(Buffer.alloc(24))).toBeUndefined();
  });
});

describe("content-identical models", () => {
  it("should cook three sources into two outputs and point the duplicate at the canonical", async () => {
    const log = vi.spyOn(console, "log");
    const root = await makeTempDir("threenative-model-dedupe-");
    await mkdir(path.join(root, "assets"));
    const canonical = await fixture();
    const other = oneVertexByteOff(canonical);
    await writeFile(path.join(root, "assets", "a.glb"), canonical);
    await writeFile(path.join(root, "assets", "b.glb"), renamed(canonical, "__b"));
    await writeFile(path.join(root, "assets", "c.glb"), other);

    const result = await compileAssets({ cwd: root, transcoder: basisTranscoderPaths() });

    const manifest = JSON.parse(
      await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
    ) as {
      entries: Record<string, { bytes: number; bytesBefore: number; output: string }>;
    };
    const entries = manifest.entries;
    // `a.glb` is the lexicographically smallest member, so it is the one that is cooked, and the
    // duplicate publishes its output verbatim — the output name carries `a.glb`, not `b.glb`.
    expect(entries["b.glb"]?.output).toBe(entries["a.glb"]?.output);
    expect(entries["a.glb"]?.output).toMatch(/^a\.[0-9a-f]{8}\.glb$/u);
    // A single byte of the binary chunk is a different model and keeps its own output.
    expect(entries["c.glb"]?.output).not.toBe(entries["a.glb"]?.output);
    // The duplicate publishes the canonical's cooked bytes against its own source size.
    expect(entries["b.glb"]?.bytes).toBe(entries["a.glb"]?.bytes);
    expect(entries["b.glb"]?.bytesBefore).toBe(renamed(canonical, "__b").length);

    // Two outputs on disk for three sources, and the receipt owns each exactly once.
    const outputs = (await readdir(path.join(root, "public"))).filter((name) =>
      name.endsWith(".glb"),
    );
    expect(outputs).toHaveLength(2);
    const receipt = JSON.parse(
      await readFile(path.join(root, "public", "bake.receipt.json"), "utf8"),
    ) as { outputs: { path: string; source: string | null }[] };
    const models = receipt.outputs.filter((output) => output.path.endsWith(".glb"));
    expect(models.map((output) => output.path).sort()).toEqual(
      [entries["a.glb"]?.output, entries["c.glb"]?.output].sort(),
    );

    expect(result.dedupe).toEqual({
      cooked: 2,
      savedBytes: entries["a.glb"]?.bytes,
      sources: 3,
    });
    expect(log.mock.calls.flat().join("\n")).toContain(
      `TN_ASSET_MODEL_DEDUPE sources=3 cooked=2 saved=${String(entries["a.glb"]?.bytes)}`,
    );
    // Every source is still accounted for as cooked or cached, or the pass-cost report has a hole.
    expect(result.skipped + result.written).toBe(3);
    expect(result.passCosts.every((row) => row.ranInputs + row.cachedInputs === 3)).toBe(true);
    log.mockRestore();
  });

  it("should keep a source with its own lod override on its own cook", async () => {
    const root = await makeTempDir("threenative-model-dedupe-lod-");
    await mkdir(path.join(root, "assets"));
    const source = await fixture();
    await writeFile(path.join(root, "assets", "a.glb"), source);
    await writeFile(path.join(root, "assets", "b.glb"), renamed(source, "__b"));

    const result = await compileAssets({
      config: { lod: { overrides: { "b.glb": false } } },
      cwd: root,
      transcoder: basisTranscoderPaths(),
    });
    const manifest = JSON.parse(
      await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
    ) as { entries: Record<string, { output: string }> };
    // The override is keyed by source path, so sharing the canonical's output would drop it.
    expect(manifest.entries["a.glb"]?.output).not.toBe(manifest.entries["b.glb"]?.output);
    expect(result.dedupe).toEqual({ cooked: 2, savedBytes: 0, sources: 2 });
  });

  it("should not re-serve a bake published before the dedupe was in the cache key", async () => {
    // The compile digest is the input bytes plus the pass configuration, and `PIPELINE_VERSION` is
    // a hand-maintained constant — a change in this package does not move it. So the dedupe
    // version rides the model pass's own configuration, which the digest does hash.
    const pass = modelPass();
    expect(pass.configuration?.dedupe).toBe(1);

    const root = await makeTempDir("threenative-model-dedupe-cache-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "a.glb"), await fixture());
    // Both bakes below use the same one-pass registry, so the configuration is the only difference
    // between them — anything else would make this pass for the wrong reason.
    const bake = async (dedupe: number): Promise<string> => {
      await compileAssets({
        cwd: root,
        passes: [{ ...pass, configuration: { ...pass.configuration, dedupe } }],
      });
      const manifest = JSON.parse(
        await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
      ) as { entries: Record<string, { output: string }> };
      return manifest.entries["a.glb"]?.output ?? "";
    };
    // A bake published before this key existed named one output per copy; it must not be re-served.
    const before = await bake(0);
    expect(await bake(1)).not.toBe(before);
    // The same configuration is a cache hit, which is what makes the difference above a fingerprint
    // rather than a rewrite.
    expect(await bake(1)).toBe(await bake(1));
  });
});
