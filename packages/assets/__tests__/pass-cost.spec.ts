import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rgbaPng } from "../../../test-support/png.js";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { compileAssets, formatPassCosts } from "../src/index.js";

/**
 * PRD-318: the compile says what each pass cost. The driver — never the pass — owns the clock,
 * so a pass cannot opt out of measurement and cannot lie about having been served from the
 * compile cache. These tests pin the record shape, the ran/cached distinction and the per-asset
 * attribution a 274-file pack needs to name its expensive members.
 */

function identityPass(name: string): { apply: (input: Buffer) => Buffer; name: string } {
  return { apply: (input: Buffer) => input, name };
}

async function textureRoot(prefix: string, names: readonly string[]): Promise<string> {
  const root = await makeTempDir(prefix);
  await mkdir(path.join(root, "assets"));
  // High-entropy pixels keep the fixture a real encode subject rather than a degenerate one.
  for (const name of names) {
    await writeFile(
      path.join(root, "assets", name),
      rgbaPng({
        blue: (x, y) => (x * 31 + y * 17) % 256,
        green: (x, y) => (x * 7 + y * 29) % 256,
        height: 64,
        red: (x, y) => (x * 13 + y * 11) % 256,
        width: 128,
      }),
    );
  }
  return root;
}

describe("pass cost records", () => {
  it("should record one cost row per pass, marked ran, when the chain runs", async () => {
    const root = await textureRoot("threenative-pass-cost-ran-", ["rock.png"]);
    const result = await compileAssets({
      cwd: root,
      passes: [identityPass("explode"), identityPass("double")],
    });

    expect(result.passCosts.map((row) => row.pass)).toEqual(["explode", "double"]);
    for (const row of result.passCosts) {
      expect(row.status).toBe("ran");
      expect(row.ranInputs).toBe(1);
      expect(row.cachedInputs).toBe(0);
      expect(row.durationMs).toBeGreaterThanOrEqual(0);
      expect(row.assets).toEqual([expect.objectContaining({ logicalPath: "rock.png" })]);
    }
  });

  it("should mark every pass cached on a forced cache hit, from the cache decision, not a duration", async () => {
    const root = await textureRoot("threenative-pass-cost-cached-", ["rock.png"]);
    const passes = [identityPass("explode")];
    await compileAssets({ cwd: root, passes });
    const second = await compileAssets({ cwd: root, passes });

    expect(second.written).toBe(0);
    expect(second.passCosts).toHaveLength(1);
    const row = second.passCosts[0];
    if (row === undefined) throw new Error("the cached bake emitted no cost row");
    expect(row.pass).toBe("explode");
    expect(row.status).toBe("cached");
    expect(row.cachedInputs).toBe(1);
    expect(row.ranInputs).toBe(0);
    expect(row.durationMs).toBe(0);
    expect(row.assets).toEqual([]);
  });

  it("should attribute cost per asset, sorted by logical path, not one fused row", async () => {
    const root = await textureRoot("threenative-pass-cost-assets-", ["bark.png", "rock.png"]);
    const result = await compileAssets({ cwd: root, passes: [identityPass("explode")] });

    const row = result.passCosts[0];
    if (row === undefined) throw new Error("the bake emitted no cost row");
    expect(row.status).toBe("ran");
    expect(row.ranInputs).toBe(2);
    expect(row.assets.map((asset) => asset.logicalPath)).toEqual(["bark.png", "rock.png"]);
    expect(row.assets.every((asset) => asset.durationMs >= 0)).toBe(true);
  });

  it("should attribute cost per model, not one fused row, when two models bake together", async () => {
    // AC3's literal subject: two models in one bake produce two rows under the model pass —
    // the attribution a 274-file pack needs to name its expensive members.
    const { buildFixtureGlb } = await import("../../../test-support/generate-fixture-model.js");
    const root = await makeTempDir("threenative-pass-cost-models-");
    await mkdir(path.join(root, "assets"));
    const glb = await buildFixtureGlb();
    await writeFile(path.join(root, "assets", "elm.glb"), glb);
    await writeFile(path.join(root, "assets", "rock.glb"), glb);
    const result = await compileAssets({ cwd: root, config: { textures: "none" } });

    const row = result.passCosts.find((pass) => pass.pass === "model");
    if (row === undefined) throw new Error("the bake emitted no model cost row");
    expect(row.status).toBe("ran");
    expect(row.ranInputs).toBe(2);
    expect(row.assets.map((asset) => asset.logicalPath)).toEqual(["elm.glb", "rock.glb"]);
    expect(row.assets.every((asset) => asset.durationMs >= 0)).toBe(true);
  });

  it("should format cost lines stable, one per pass then one per asset", () => {
    const lines = formatPassCosts([
      {
        assets: [
          { durationMs: 600, logicalPath: "assets/rock.glb" },
          { durationMs: 400, logicalPath: "assets/elm.glb" },
        ],
        cachedInputs: 0,
        durationMs: 1000,
        pass: "model",
        ranInputs: 2,
        status: "ran",
      },
      { assets: [], cachedInputs: 2, durationMs: 0, pass: "ktx2", ranInputs: 0, status: "cached" },
    ]);

    expect(lines).toEqual([
      "cost pass model: ran on 2 input(s), 1000 ms",
      "  cost assets/elm.glb: 400 ms",
      "  cost assets/rock.glb: 600 ms",
      "cost pass ktx2: cached for 2 input(s)",
    ]);
  });
});
