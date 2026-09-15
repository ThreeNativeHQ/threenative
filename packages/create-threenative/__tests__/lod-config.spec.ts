import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { loadConfig } from "../src/config.js";

// PRD-377 §3.2 — the config layer validates and normalizes `assets.lod`; resolution is per asset
// and lives with the compiler (`@threenative/assets`), so the precedence tests are in the assets
// package beside the code that consumes the resolved policy.

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function project(): Promise<string> {
  const root = await makeTempDir("threenative-lod-config-");
  roots.push(root);
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src/game.ts"), "export default {};\n");
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "lod-game", type: "module", devDependencies: {} }),
  );
  return root;
}

async function config(root: string, source: string): Promise<void> {
  await writeFile(path.join(root, "threenative.config.ts"), `${source}\n`);
}

describe("config validation", () => {
  it.each([
    [{ preset: "cinematic" }, "assets.lod.preset"],
    [{ generation: { maxLevels: 0 } }, "assets.lod.generation.maxLevels"],
    [{ generation: { maxLevels: 9 } }, "assets.lod.generation.maxLevels"],
    [{ generation: { maxLevels: 2.5 } }, "assets.lod.generation.maxLevels"],
    [{ generation: { minTriangles: 0 } }, "assets.lod.generation.minTriangles"],
    [{ generation: { minTrianglesScope: "world" } }, "assets.lod.generation.minTrianglesScope"],
    [{ generation: { join: "yes" } }, "assets.lod.generation.join"],
    [{ generation: { minSaving: -0.1 } }, "assets.lod.generation.minSaving"],
    [{ generation: { minSaving: 1 } }, "assets.lod.generation.minSaving"],
    [{ generation: { errorTargets: [] } }, "assets.lod.generation.errorTargets"],
    [{ generation: { errorTargets: [0.01, 0.001] } }, "assets.lod.generation.errorTargets"],
    [{ generation: { errorTargets: [0] } }, "assets.lod.generation.errorTargets"],
    [{ runtime: { maxPixelError: 0 } }, "assets.lod.runtime.maxPixelError"],
    [{ runtime: { maxPixelError: Number.POSITIVE_INFINITY } }, "assets.lod.runtime.maxPixelError"],
    [{ runtime: { hysteresis: 0.5 } }, "assets.lod.runtime.hysteresis"],
    [{ runtime: { hysteresis: -0.1 } }, "assets.lod.runtime.hysteresis"],
    [{ enabled: "yes" }, "assets.lod.enabled"],
    [{ overrides: { "models/hero.glb": { preset: "cinematic" } } }, "assets.lod.overrides"],
    [
      { overrides: { "models/hero.glb": { runtime: { hysteresis: 0.9 } } } },
      "assets.lod.overrides",
    ],
    [
      { overrides: { "models/hero.glb": { generation: { minSaving: 2 } } } },
      "assets.lod.overrides",
    ],
  ])("fails %j naming its config path", async (lod, namedPath) => {
    const root = await project();
    await config(root, `export default ${JSON.stringify({ assets: { lod } })};`);
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_ASSETS_INVALID/u);
    await expect(loadConfig(root)).rejects.toThrow(namedPath);
  });

  it("rejects an unknown key under assets.lod with the named code", async () => {
    const root = await project();
    await config(root, "export default { assets: { lod: { bogus: 1 } } };");
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_UNKNOWN_KEY/u);
    await expect(loadConfig(root)).rejects.toThrow(/assets\.lod\.bogus/u);
  });

  it("rejects an unknown key inside a per-asset override", async () => {
    const root = await project();
    await config(
      root,
      "export default { assets: { lod: { overrides: { 'a.glb': { bogus: 1 } } } } };",
    );
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_UNKNOWN_KEY/u);
    await expect(loadConfig(root)).rejects.toThrow(/assets\.lod\.overrides\['a\.glb'\]\.bogus/u);
  });
});

describe("the validated config seam", () => {
  it("carries assets.lod through loadConfig intact", async () => {
    const root = await project();
    await config(
      root,
      'export default { assets: { lod: { preset: "aggressive", generation: { maxLevels: 6 } } } };',
    );
    await expect(loadConfig(root)).resolves.toMatchObject({
      assets: { lod: { preset: "aggressive", generation: { maxLevels: 6 } } },
    });
  });

  it("carries the generation knobs, globally and inside an asset override", async () => {
    const root = await project();
    await config(
      root,
      'export default { assets: { lod: { generation: { maxLevels: 6, minTriangles: 256, minTrianglesScope: "asset", minSaving: 0.3, errorTargets: [0.005, 0.05], join: true }, overrides: { "models/carrier.glb": { generation: { minTrianglesScope: "primitive" } } } } } };',
    );
    await expect(loadConfig(root)).resolves.toMatchObject({
      assets: {
        lod: {
          generation: {
            maxLevels: 6,
            minTriangles: 256,
            minTrianglesScope: "asset",
            minSaving: 0.3,
            errorTargets: [0.005, 0.05],
            join: true,
          },
          overrides: { "models/carrier.glb": { generation: { minTrianglesScope: "primitive" } } },
        },
      },
    });
  });

  it("carries a boolean kill switch and a full override table", async () => {
    const root = await project();
    await config(root, "export default { assets: { lod: false, models: {} } };");
    await expect(loadConfig(root)).resolves.toMatchObject({ assets: { lod: false } });

    const second = await project();
    await config(
      second,
      'export default { assets: { lod: { runtime: { maxPixelError: 2.5, hysteresis: 0 }, overrides: { "models/hero.glb": false, "models/castle.glb": { preset: "quality" } } } } };',
    );
    await expect(loadConfig(second)).resolves.toMatchObject({
      assets: {
        lod: {
          runtime: { maxPixelError: 2.5, hysteresis: 0 },
          overrides: { "models/hero.glb": false, "models/castle.glb": { preset: "quality" } },
        },
      },
    });
  });
});
