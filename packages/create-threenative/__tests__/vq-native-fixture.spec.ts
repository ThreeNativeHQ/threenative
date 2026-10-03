import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileAssets } from "@threenative/assets";
import { createAssetLoader } from "@threenative/core";
import { Group, Texture } from "three";
import { afterEach, expect, test, vi } from "vitest";
import {
  MODEL_NAMES,
  generateNativeAssetFixture,
  inspectFixtureModel,
} from "../../../examples/abyss-framework/vq-assets/generate.js";
import { AssetScene } from "../../../examples/abyss-framework/vq-assets/src/game.js";
import config from "../../../examples/abyss-framework/vq-assets/threenative.config.js";
import { assertNativeAssetsCompatible } from "../src/build.js";
import { loadConfig } from "../src/config.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

test("real Meshopt and Draco inputs retain decoded geometry, images and animation through the decoder-free cook", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "vq01-fixture-"));
  roots.push(cwd);
  const source = path.join(cwd, config.assets.source);
  const ktx2 = await generateNativeAssetFixture(source);
  await writeFile(path.join(cwd, "package.json"), '{"name":"vq-fixture","type":"module"}');
  await writeFile(
    path.join(cwd, "threenative.config.ts"),
    `export default ${JSON.stringify(config)};`,
  );
  const before = await Promise.all(
    MODEL_NAMES.map((name) => inspectFixtureModel(path.join(source, `${name}.glb`))),
  );
  expect(before[0]?.extensions).toContain("EXT_meshopt_compression");
  expect(before[1]?.extensions).toContain("KHR_draco_mesh_compression");
  await compileAssets({
    cwd,
    config: config.assets,
    platform: "desktop",
    runtimeDecoders: { ktx2: false, meshopt: false },
    runtimeIdentity: "test:quickjs",
  });
  const output = path.join(cwd, config.assets.output);
  const manifest = JSON.parse(await readFile(path.join(output, "assets.manifest.json"), "utf8"));
  for (const [index, name] of MODEL_NAMES.entries()) {
    const original = before[index];
    if (!original) throw new Error("Missing source measurement");
    const cooked = await inspectFixtureModel(
      path.join(output, manifest.entries[`${name}.glb`].output),
    );
    expect(cooked.extensions).not.toContain("EXT_meshopt_compression");
    expect(cooked.extensions).not.toContain("KHR_draco_mesh_compression");
    expect(cooked.triangles).toBe(original.triangles);
    expect(cooked.positions).toEqual(original.positions);
    expect(cooked.animation).toEqual(original.animation);
    expect(cooked.images.map((image) => image.data)).toEqual(
      original.images.map((image) => image.data),
    );
  }
  expect(manifest.entries["checker.png"].output).toMatch(/\.png$/u);
  await expect(
    assertNativeAssetsCompatible(cwd, "desktop", await loadConfig(cwd)),
  ).resolves.toBeUndefined();
  await writeFile(path.join(source, "authored.ktx2"), ktx2);
  await compileAssets({
    cwd,
    config: config.assets,
    platform: "desktop",
    runtimeDecoders: { ktx2: false, meshopt: false },
    runtimeIdentity: "test:quickjs",
  });
  await expect(assertNativeAssetsCompatible(cwd, "desktop", await loadConfig(cwd))).rejects.toThrow(
    /TN_NATIVE_KTX2_UNSUPPORTED.*authored.ktx2/u,
  );
});

test("fixture exit disposes its configured PNG clone and cached original exactly once", async () => {
  const original = new Texture();
  const assets = createAssetLoader({
    model: async () => ({ scene: new Group(), animations: [] }),
    texture: async () => original,
  });
  const scene = new AssetScene();
  const ctx = { assets } as Parameters<AssetScene["load"]>[0];
  const dispose = vi.spyOn(Texture.prototype, "dispose");
  try {
    await scene.load(ctx);
    scene.exit(ctx);
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(new Set(dispose.mock.contexts).size).toBe(2);
    expect(dispose.mock.contexts).toContain(original);
    scene.exit(ctx);
    expect(dispose).toHaveBeenCalledTimes(2);
  } finally {
    dispose.mockRestore();
    assets.clear();
  }
});
