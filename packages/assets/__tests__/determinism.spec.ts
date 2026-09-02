import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFixtureGlb } from "../../../test-support/generate-fixture-model.js";
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
});
