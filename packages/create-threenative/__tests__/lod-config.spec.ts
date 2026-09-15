import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { loadConfig, resolveLodPolicy } from "../src/config.js";

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

describe("resolveLodPolicy defaults", () => {
  it("resolves omission to enabled/balanced with the contracted defaults", () => {
    const policy = resolveLodPolicy(undefined);
    expect(policy).toMatchObject({
      enabled: true,
      preset: "balanced",
      generation: { maxLevels: 4, minTriangles: 5_000 },
      runtime: { maxPixelError: 1, hysteresis: 0.15 },
      reasons: [],
      diagnostics: [],
    });
  });

  it("treats an empty block the same as omission", () => {
    expect(resolveLodPolicy({})).toMatchObject(resolveLodPolicy(undefined));
  });

  it("resolves each preset's contracted pixel budget", () => {
    expect(resolveLodPolicy({ preset: "quality" }).runtime.maxPixelError).toBe(0.5);
    expect(resolveLodPolicy({ preset: "aggressive" }).runtime.maxPixelError).toBe(2);
    // The generation defaults are shared by every preset; only the pixel budget moves.
    expect(resolveLodPolicy({ preset: "aggressive" }).generation).toEqual({
      maxLevels: 4,
      minTriangles: 5_000,
    });
  });

  it("lets explicit numeric settings win over preset defaults", () => {
    const policy = resolveLodPolicy({
      preset: "balanced",
      generation: { maxLevels: 6, minTriangles: 20_000 },
      runtime: { maxPixelError: 3, hysteresis: 0 },
    });
    expect(policy).toMatchObject({
      generation: { maxLevels: 6, minTriangles: 20_000 },
      runtime: { maxPixelError: 3, hysteresis: 0 },
    });
  });
});

describe("the absolute kill switch", () => {
  it("treats global false and { enabled: false } as equivalent and absolute", () => {
    for (const block of [false, { enabled: false }] as const) {
      const policy = resolveLodPolicy(block);
      expect(policy.enabled).toBe(false);
      expect(policy.reasons).toContain("disabled");
    }
  });

  it("cannot be re-enabled by a per-asset override", () => {
    const policy = resolveLodPolicy(
      { enabled: false, overrides: { "models/hero.glb": true } },
      "models/hero.glb",
    );
    expect(policy.enabled).toBe(false);
  });

  it("honours an asset false even when the project is on", () => {
    const policy = resolveLodPolicy({ overrides: { "models/hero.glb": false } }, "models/hero.glb");
    expect(policy.enabled).toBe(false);
    expect(policy.reasons).toContain("disabled");
  });
});

describe("partial overrides overlay rather than replace", () => {
  it("merges project and asset fields field by field", () => {
    const policy = resolveLodPolicy(
      {
        generation: { maxLevels: 6 },
        preset: "balanced",
        overrides: {
          "models/castle.glb": { generation: { minTriangles: 100 }, preset: "quality" },
        },
      },
      "models/castle.glb",
    );
    expect(policy.preset).toBe("quality");
    expect(policy.runtime.maxPixelError).toBe(0.5);
    expect(policy.generation).toEqual({ maxLevels: 6, minTriangles: 100 });
  });

  it("inherits the project runtime when the asset override does not name it", () => {
    const policy = resolveLodPolicy(
      { runtime: { hysteresis: 0.2 }, overrides: { "models/hero.glb": { enabled: true } } },
      "models/hero.glb",
    );
    expect(policy.runtime.hysteresis).toBe(0.2);
  });
});

describe("config validation", () => {
  it.each([
    [{ preset: "cinematic" }, "assets.lod.preset"],
    [{ generation: { maxLevels: 0 } }, "assets.lod.generation.maxLevels"],
    [{ generation: { maxLevels: 9 } }, "assets.lod.generation.maxLevels"],
    [{ generation: { maxLevels: 2.5 } }, "assets.lod.generation.maxLevels"],
    [{ generation: { minTriangles: 0 } }, "assets.lod.generation.minTriangles"],
    [{ runtime: { maxPixelError: 0 } }, "assets.lod.runtime.maxPixelError"],
    [{ runtime: { maxPixelError: Number.POSITIVE_INFINITY } }, "assets.lod.runtime.maxPixelError"],
    [{ runtime: { hysteresis: 0.5 } }, "assets.lod.runtime.hysteresis"],
    [{ runtime: { hysteresis: -0.1 } }, "assets.lod.runtime.hysteresis"],
    [{ enabled: "yes" }, "assets.lod.enabled"],
    [{ overrides: { "models/hero.glb": { preset: "cinematic" } } }, "assets.lod.overrides"],
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
});

describe("legacy translation", () => {
  it("keeps virtual: none off instead of quietly becoming default-on discrete LOD", () => {
    const policy = resolveLodPolicy(undefined, "models/hero.glb", { virtualNone: true });
    expect(policy.enabled).toBe(false);
    expect(policy.reasons).toContain("virtual-none");
  });

  it("lets an explicit enable override virtual: none, with a migration diagnostic", () => {
    const policy = resolveLodPolicy({ enabled: true }, "models/hero.glb", { virtualNone: true });
    expect(policy.enabled).toBe(true);
    expect(policy.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "lod-legacy-virtual-none-conflict",
    );
  });

  it("skips generation for an explicit legacy simplify with its reason", () => {
    const policy = resolveLodPolicy(undefined, "models/hero.glb", { simplify: true });
    expect(policy.enabled).toBe(false);
    expect(policy.reasons).toContain("explicit-legacy-simplify");
  });

  it("diagnoses a conflicting explicit new and legacy declaration", () => {
    const policy = resolveLodPolicy({ enabled: true }, "models/hero.glb", {
      simplify: true,
      virtualNone: true,
    });
    const codes = policy.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("lod-legacy-simplify-conflict");
    expect(codes).toContain("lod-legacy-virtual-none-conflict");
  });

  it("keeps an explicit legacy simplify when the new block declares no policy", () => {
    const policy = resolveLodPolicy({}, "models/hero.glb", { simplify: true });
    expect(policy.enabled).toBe(false);
    expect(policy.diagnostics).toEqual([]);
  });
});

describe("generation and runtime fingerprints", () => {
  const base = {
    enabled: true,
    generation: { maxLevels: 4, minTriangles: 5_000 },
    preset: "balanced" as const,
    runtime: { hysteresis: 0.15, maxPixelError: 1 },
  };

  it("changes the runtime fingerprint when only the pixel budget or hysteresis moves", () => {
    const moved = resolveLodPolicy({ runtime: { hysteresis: 0.3, maxPixelError: 2 } });
    const kept = resolveLodPolicy(undefined);
    expect(moved.fingerprint.generation).toBe(kept.fingerprint.generation);
    expect(moved.fingerprint.runtime).not.toBe(kept.fingerprint.runtime);
  });

  it("changes the generation fingerprint when only generation moves", () => {
    const moved = resolveLodPolicy({ generation: { maxLevels: 7 } });
    const kept = resolveLodPolicy(undefined);
    expect(moved.fingerprint.generation).not.toBe(kept.fingerprint.generation);
  });

  it("is deterministic for the same resolved policy", () => {
    const first = resolveLodPolicy(base);
    const second = resolveLodPolicy(base);
    expect(first.fingerprint).toEqual(second.fingerprint);
  });
});

describe("the resolved config seam", () => {
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
});
