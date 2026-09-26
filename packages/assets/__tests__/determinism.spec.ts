import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFixtureGlb } from "../../../test-support/generate-fixture-model.js";
import { rgbaPng } from "../../../test-support/png.js";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { compileAssets } from "../src/index.js";
import { modelPass } from "../src/passes/model.js";
import type { ISharedImage, ISharedImageStore } from "../src/passes/shared-images.js";

/**
 * PRD-319 Phase 0: the determinism gate. The same inputs baked through the driver in both
 * processing orders must emit byte-identical artifacts. Today every run is sequential, so the
 * real chain is expected to survive the reversal; the gate's red comes from a deliberately
 * order-dependent pass — the shape of the bug concurrency can introduce when an encoder's
 * output depends on who arrived first — proving the gate can fail. A determinism gate that has
 * never been red proves nothing.
 */

/** Which input the order-dependent pass has served in the current bake. */
let orderDependentCalls = 0;

/**
 * A pass whose output depends on how many inputs ran before it: the first caller gets its bytes
 * back untouched, every later caller gets one byte flipped. Under the driver's reversed
 * processing order the same bytes arrive at a different position — which is the
 * non-determinism this gate must be able to detect before any real concurrency exists.
 */
function orderDependentPass(): { apply: (input: Buffer) => Buffer; name: string } {
  return {
    name: "arrival-encoder",
    apply: (input: Buffer) => {
      orderDependentCalls += 1;
      if (orderDependentCalls === 1) return input;
      const variant = Buffer.from(input);
      variant[variant.length - 1] = (variant.at(-1) ?? 0) ^ 0x01;
      return variant;
    },
  };
}

/** A live store for the shared-image runs: identical encodes must resolve to identical bytes. */
function realStore(): ISharedImageStore {
  const memory = new Map<string, ISharedImage>();
  return {
    get: async (key) => memory.get(key),
    put: async (key, image) => {
      if (!memory.has(key)) memory.set(key, image);
    },
    outputPath: (key, image) => `shared/images/${key}.${image.codec}.ktx2`,
  };
}

async function hashOutputRoot(outputRoot: string): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  async function walk(current: string): Promise<void> {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((l, r) =>
      l.name.localeCompare(r.name),
    )) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(file);
      else
        hashes.set(
          path.relative(outputRoot, file),
          createHash("sha256")
            .update(await readFile(file))
            .digest("hex"),
        );
    }
  }
  await walk(outputRoot);
  return hashes;
}

async function stageTwoSharedModels(): Promise<string> {
  const root = await makeTempDir("threenative-determinism-");
  await mkdir(path.join(root, "assets"));
  const glb = await buildFixtureGlb();
  // Two logical paths, byte-identical models: both embed the same images, so the shared-image
  // merge is on the path and the two inputs are the independent work a scheduler would overlap.
  await writeFile(path.join(root, "assets", "a.glb"), glb);
  await writeFile(path.join(root, "assets", "b.glb"), glb);
  return root;
}

async function bake(
  root: string,
  passes: readonly unknown[],
  processingOrder: "reversed" | "sorted",
): Promise<Map<string, string>> {
  const outputRoot = path.join(root, "public");
  await rm(outputRoot, { force: true, recursive: true });
  await compileAssets({
    cwd: root,
    output: "public",
    processingOrder,
    source: "assets",
    passes: passes as never,
  });
  return hashOutputRoot(outputRoot);
}

describe("the determinism gate (PRD-319 phase 0)", () => {
  it("bakes byte-identical output in sorted and reversed processing order", async () => {
    const root = await stageTwoSharedModels();
    try {
      const sorted = await bake(root, [modelPass({ sharedImages: realStore() })], "sorted");
      const reversed = await bake(root, [modelPass({ sharedImages: realStore() })], "reversed");
      expect([...sorted.keys()].sort()).toEqual([...reversed.keys()].sort());
      const sharedFiles = [...sorted.keys()].filter((file) => file.includes("shared/images/"));
      expect(sharedFiles.length).toBeGreaterThan(0); // the merge under test is really on the path
      for (const [file, hash] of sorted) {
        expect(reversed.get(file), `${file} differs under reversed order`).toBe(hash);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("goes red when a pass's output depends on arrival order", async () => {
    // AC2's negative control: with an order-dependent pass in the chain, reversing the
    // processing order must change the emitted bytes. A gate that cannot fail here cannot
    // detect the bug concurrency would introduce for real.
    const root = await stageTwoSharedModels();
    try {
      orderDependentCalls = 0;
      const sorted = await bake(root, [orderDependentPass()], "sorted");
      orderDependentCalls = 0;
      const reversed = await bake(root, [orderDependentPass()], "reversed");
      const differing = [...sorted.keys()].filter(
        (file) => sorted.get(file) !== reversed.get(file),
      );
      expect(differing.length).toBeGreaterThan(0);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("bakes byte-identical output at concurrency 1 and at concurrency 4 through real workers", async () => {
    // AC1's core, with the self-comparison guard the PRD demands: the two runs must not resolve
    // to the same execution path, so the result's concurrencyUsed must differ before the bytes
    // are compared. The built-in registry is what a worker can rebuild; the model pass carries
    // its shared-image store per worker.
    const root = await stageTwoSharedModels();
    try {
      const sequential = await compileAssets({
        concurrency: 1,
        cwd: root,
        output: "public",
        processingOrder: "sorted",
        source: "assets",
        config: { models: { sharedImages: true } },
      });
      const sequentialHashes = await hashOutputRoot(path.join(root, "public"));

      await rm(path.join(root, "public"), { force: true, recursive: true });
      const concurrent = await compileAssets({
        concurrency: 4,
        cwd: root,
        output: "public",
        processingOrder: "reversed",
        source: "assets",
        config: { models: { sharedImages: true } },
      });
      const concurrentHashes = await hashOutputRoot(path.join(root, "public"));

      // The two sides took different paths, or this gate compares a run to itself. The bound is
      // min(concurrency, inputs): two staged inputs mean two workers, not four.
      expect(sequential.concurrencyUsed).toBe(1);
      expect(concurrent.concurrencyUsed).toBeGreaterThan(1);
      expect(sequential.written).toBe(concurrent.written);
      expect([...sequentialHashes.keys()].sort()).toEqual([...concurrentHashes.keys()].sort());
      for (const [file, hash] of sequentialHashes) {
        expect(concurrentHashes.get(file), `${file} differs at concurrency 4`).toBe(hash);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

const RESIZE_CONFIG = { textures: { maxSize: 32 } } as const;

async function stageResizable(prefix: string): Promise<string> {
  const root = await makeTempDir(prefix);
  await mkdir(path.join(root, "assets"));
  await writeFile(
    path.join(root, "assets", "rock.png"),
    rgbaPng({
      blue: (x, y) => (x * 19 + y * 23) % 256,
      green: (x, y) => (x * 29 + y * 31) % 256,
      height: 64,
      red: (x, y) => (x * 37 + y * 41) % 256,
      width: 64,
    }),
  );
  return root;
}

/**
 * The decoder-free cap is a cook like any other: it must reproduce from source bytes alone, the
 * warm cache must recognise its own output, and the per-asset digest must not rename an image
 * because a model-only option changed.
 */
describe("decoder-free resizing is deterministic and cache-correct", () => {
  it("should bake identical bytes into independent directories, then reuse them warm", async () => {
    const first = await stageResizable("threenative-resize-determinism-a-");
    const second = await stageResizable("threenative-resize-determinism-b-");
    try {
      await compileAssets({ config: RESIZE_CONFIG, cwd: first, platform: "android" });
      const warm = await compileAssets({ config: RESIZE_CONFIG, cwd: first, platform: "android" });
      await compileAssets({ config: RESIZE_CONFIG, cwd: second, platform: "android" });

      expect(warm.written).toBe(0);
      expect(warm.skipped).toBe(1);

      const hashesA = await hashOutputRoot(path.join(first, "public"));
      const hashesB = await hashOutputRoot(path.join(second, "public"));
      expect([...hashesA.keys()].sort()).toEqual([...hashesB.keys()].sort());
      for (const [file, hash] of hashesA) {
        expect(hashesB.get(file), `${file} differs across directories`).toBe(hash);
      }
    } finally {
      await rm(first, { force: true, recursive: true });
      await rm(second, { force: true, recursive: true });
    }
  });

  it("should rename a texture when its cap changes but not when only lod config changes", async () => {
    const root = await stageResizable("threenative-digest-per-asset-");
    await writeFile(path.join(root, "assets", "character.glb"), await buildFixtureGlb());
    try {
      const outputs = async (config: {
        readonly lod?: { readonly enabled: boolean };
        readonly textures: { readonly maxSize: number };
      }): Promise<Record<string, string>> => {
        await compileAssets({ config, cwd: root, platform: "android" });
        const manifest = JSON.parse(
          await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
        ) as { entries: Record<string, { output: string }> };
        return Object.fromEntries(
          Object.entries(manifest.entries).map(([logical, entry]) => [logical, entry.output]),
        );
      };

      const base = await outputs(RESIZE_CONFIG);
      const capped = await outputs({ textures: { maxSize: 16 } });
      expect(capped["rock.png"]).not.toBe(base["rock.png"]);
      // A standalone texture cap does not touch the model, whose embedded textures are "none".
      expect(capped["character.glb"]).toBe(base["character.glb"]);

      const lodChanged = await outputs({
        lod: { enabled: true },
        textures: { maxSize: 32 },
      });
      // The model-only lod policy is not in the texture's digest...
      expect(lodChanged["rock.png"]).toBe(base["rock.png"]);
      // ...but it is in the model's, which must not serve the stale geometry.
      expect(lodChanged["character.glb"]).not.toBe(base["character.glb"]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
