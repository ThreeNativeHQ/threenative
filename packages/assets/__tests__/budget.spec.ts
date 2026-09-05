import { mkdir, readFile, truncate, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildFixtureGlb } from "../../../test-support/generate-fixture-model.js";
import { rgbaPng } from "../../../test-support/png.js";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { basisTranscoderPaths } from "../../../test-support/three-basis.js";
import { assertBudget, measureBudget, parseBudget } from "../src/budget.js";
import { compileAssets } from "../src/compile.js";
import { encodeLinearRgbaKtx2 } from "../src/passes/texture.js";

async function fixture() {
  const root = await makeTempDir("asset-budget-");
  await mkdir(path.join(root, "assets"));
  const bytes = rgbaPng({ width: 16, height: 16, red: () => 100, green: () => 50, blue: () => 20 });
  await writeFile(path.join(root, "assets/largest.png"), bytes);
  return { root, bytes };
}

describe("asset byte budgets", () => {
  it.each([
    null,
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "64",
    [],
    { total: 0 },
    { uncooked: null },
  ])("rejects malformed budget %j", (value) => {
    expect(() => parseBudget(value)).toThrow("TN_ASSETS_CONFIG_INVALID");
  });

  it("keeps an independent disabled counter and rejects unknown keys", () => {
    expect(parseBudget({ uncooked: "none" })).toEqual({ uncooked: "none", total: "none" });
    expect(parseBudget({ total: 100 })).toEqual({ uncooked: 64_000_000, total: 100 });
    expect(() => parseBudget({ typo: 2 })).toThrow("TN_ASSETS_CONFIG_UNKNOWN_KEY");
  });

  it("counts 200 MB cooked once, using emitted sizes rather than stale manifest claims", async () => {
    const root = await makeTempDir("asset-budget-large-");
    const ktx2 = await encodeLinearRgbaKtx2(new Uint8Array(16 * 16 * 4).fill(128), 16, 16);
    await writeFile(path.join(root, "shared.ktx2"), ktx2);
    await truncate(path.join(root, "shared.ktx2"), 200_000_000);
    const output = { bytes: 1, output: "shared.ktx2", kind: "texture" };
    const result = await measureBudget(
      { first: output, second: output },
      root,
      true,
      parseBudget(undefined),
    );
    expect(result.total).toBe(200_000_000);
    expect(result.uncooked).toBe(0);
    expect(() => assertBudget(result)).not.toThrow();
    expect(() => assertBudget({ ...result, budget: parseBudget({ total: 199_999_999 }) })).toThrow(
      "TN_ASSETS_BUDGET_EXCEEDED",
    );
    // Same number of bytes, still PNG, must fail the default gate.
    await writeFile(path.join(root, "raw.png"), "png");
    await truncate(path.join(root, "raw.png"), 200_000_000);
    const raw = await measureBudget(
      { raw: { bytes: 1, output: "raw.png", kind: "texture" } },
      root,
      true,
      parseBudget(undefined),
    );
    expect(() => assertBudget(raw)).toThrow("TN_ASSETS_BUDGET_EXCEEDED");
  });

  it("counts compiler-owned Basis sidecars exactly once in total and never in uncooked", async () => {
    const { root } = await fixture();
    const first = await compileAssets({
      cwd: root,
      transcoder: basisTranscoderPaths(),
      config: { budget: "none" },
    });
    const unique = new Map(first.receipt?.outputs.map((output) => [output.path, output]) ?? []);
    const primaryBytes = [...unique.values()]
      .filter((output) => output.producer !== "basis-transcoder")
      .reduce((total, output) => total + output.bytes, 0);
    const sidecarBytes = [...unique.values()]
      .filter((output) => output.producer === "basis-transcoder")
      .reduce((total, output) => total + output.bytes, 0);
    expect(sidecarBytes).toBeGreaterThan(0);
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((line) => lines.push(String(line)));
    try {
      await expect(
        compileAssets({
          cwd: root,
          transcoder: basisTranscoderPaths(),
          config: { budget: { total: primaryBytes, uncooked: "none" } },
        }),
      ).rejects.toThrow(`total ${primaryBytes + sidecarBytes} bytes exceeds ${primaryBytes}`);
    } finally {
      log.mockRestore();
    }
    expect(lines.join("\n")).toContain("uncooked 0 bytes (ceiling none)");
  });

  it("counts raw embedded and shared images even when the model pass ran", async () => {
    const root = await makeTempDir("asset-budget-model-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets/rock.glb"), await buildFixtureGlb());
    for (const sharedImages of [false, true]) {
      await compileAssets({
        cwd: root,
        concurrency: 1,
        config: { budget: "none", models: { sharedImages, textures: "none" } },
      });
      const manifest = JSON.parse(
        await readFile(path.join(root, "public/assets.manifest.json"), "utf8"),
      );
      expect(manifest.entries["rock.glb"].passes).toContain("model");
      const measured = await measureBudget(
        manifest.entries,
        path.join(root, "public"),
        true,
        parseBudget(1),
      );
      expect(measured.uncooked).toBeGreaterThan(1);
      expect(measured.uncooked).toBeLessThan(measured.total);
      await expect(
        compileAssets({
          cwd: root,
          concurrency: 1,
          config: { budget: 1, models: { sharedImages, textures: "none" } },
        }),
      ).rejects.toThrow("TN_ASSETS_BUDGET_EXCEEDED");
    }
  });

  it("exempts automatic no-growth fallback but charges an explicit codec override", async () => {
    const { root } = await fixture();
    await compileAssets({ cwd: root, transcoder: basisTranscoderPaths(), config: { budget: 1 } });
    const manifest = JSON.parse(
      await readFile(path.join(root, "public/assets.manifest.json"), "utf8"),
    );
    expect(manifest.entries["largest.png"].compressionSkipped).toBe("not-smaller");
    await expect(
      compileAssets({
        cwd: root,
        config: { budget: 1, textures: { overrides: [{ glob: "*.png", codec: "none" }] } },
      }),
    ).rejects.toThrow("TN_ASSETS_BUDGET_EXCEEDED");
  });

  // Unlike `not-smaller`, which no author can act on, an unaligned source is fixable by the
  // resize the cook refuses to make for them. So these bytes ship uncompressed *and* are
  // counted: the gate stays honest about what the download actually costs.
  it("charges automatically retained non-block-aligned bytes to uncooked and total", async () => {
    const root = await makeTempDir("asset-budget-block-size-");
    await mkdir(path.join(root, "assets"));
    const bytes = rgbaPng({
      width: 11,
      height: 10,
      red: () => 100,
      green: () => 50,
      blue: () => 20,
    });
    await writeFile(path.join(root, "assets/decal.png"), bytes);

    await expect(
      compileAssets({ cwd: root, transcoder: basisTranscoderPaths(), config: { budget: 1 } }),
    ).rejects.toThrow(/TN_ASSETS_BUDGET_EXCEEDED.*decal\.png/su);

    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line) => lines.push(String(line)));
    try {
      await compileAssets({
        cwd: root,
        transcoder: basisTranscoderPaths(),
        config: { budget: "none" },
      });
      const manifest = JSON.parse(
        await readFile(path.join(root, "public/assets.manifest.json"), "utf8"),
      );
      expect(manifest.entries["decal.png"].compressionSkipped).toBe("block-size");
      // Both counters, on the row for this file: the Basis runtime `public/` also carries is
      // compiler machinery and only ever lands in the build-wide total.
      expect(lines).toContain(
        `  budget decal.png: uncooked ${bytes.length} bytes, total ${bytes.length} bytes`,
      );
    } finally {
      vi.restoreAllMocks();
    }
  });

  it.each([false, true])(
    "exempts automatically retained embedded PNGs with sharedImages=%s, including cache hits",
    async (sharedImages) => {
      const root = await makeTempDir("asset-budget-small-model-");
      await mkdir(path.join(root, "assets"));
      await writeFile(path.join(root, "assets/rock.glb"), await buildFixtureGlb());
      const options = {
        cwd: root,
        concurrency: 1,
        transcoder: basisTranscoderPaths(),
        config: { budget: 1, models: { sharedImages } },
      };
      await compileAssets(options);
      const result = await compileAssets(options);
      expect(result.skipped).toBe(1);
      const manifest = JSON.parse(
        await readFile(path.join(root, "public/assets.manifest.json"), "utf8"),
      );
      expect(
        Object.keys(manifest.entries["rock.glb"].embeddedTextures.skippedCompression).length,
      ).toBeGreaterThan(0);
    },
  );

  it("fails on uncooked output and names the asset and remedies", async () => {
    const { root } = await fixture();
    await expect(
      compileAssets({ cwd: root, config: { models: "none", textures: "none", budget: 1 } }),
    ).rejects.toThrow(
      /TN_ASSETS_BUDGET_EXCEEDED.*largest.png.*assets.exclude.*assets.budget.*texture/,
    );
  });

  it("still prints measured bytes with both budgets disabled", async () => {
    const { root, bytes } = await fixture();
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line) => lines.push(String(line)));
    await compileAssets({
      cwd: root,
      config: { models: "none", textures: "none", budget: "none" },
    });
    expect(lines.join("\n")).toContain(`uncooked ${bytes.length} bytes (ceiling none)`);
    expect(lines.join("\n")).toContain(`total ${bytes.length} bytes (ceiling none)`);
  });

  it.each(["android", "ios"] as const)(
    "exempts %s from uncooked but enforces total",
    async (platform) => {
      const { root, bytes } = await fixture();
      await compileAssets({ cwd: root, platform, config: { budget: 1 } });
      const manifest = JSON.parse(
        await readFile(path.join(root, "public/assets.manifest.json"), "utf8"),
      );
      expect(manifest.entries["largest.png"].bytes).toBe(bytes.length);
      await expect(
        compileAssets({ cwd: root, platform, config: { budget: { total: 1 } } }),
      ).rejects.toThrow("TN_ASSETS_BUDGET_EXCEEDED");
    },
  );

  it("accepts the exact ceiling and rejects one byte below on a cache hit", async () => {
    const { root, bytes } = await fixture();
    await compileAssets({ cwd: root, config: { textures: "none", budget: bytes.length } });
    await expect(
      compileAssets({ cwd: root, config: { textures: "none", budget: bytes.length - 1 } }),
    ).rejects.toThrow("TN_ASSETS_BUDGET_EXCEEDED");
  });
});
