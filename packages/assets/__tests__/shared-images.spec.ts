import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { buildFixtureDocument } from "../../../test-support/generate-fixture-model.js";
import { rgbaPng } from "../../../test-support/png.js";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { basisTranscoderPaths } from "../../../test-support/three-basis.js";
import { compileAssets } from "../src/index.js";
import { type IModelPassOptions, modelPass } from "../src/passes/model.js";
import {
  type ISharedImageStore,
  createSharedImageStore,
  readSharedGlb,
  sharedImageKey,
  sharedImageUri,
  unpackGlb,
} from "../src/passes/shared-images.js";

/**
 * A marketplace pack embeds the same textures in every model that uses them: Wildwood's eight
 * pines each carried the same 9 MB of bark and needle maps, 280 MB of embedded images for 63 MB
 * of distinct ones, re-encoded on every build. These tests prove one image is written once,
 * referenced from every model that carries it, encoded once per build and found on disk by the
 * next.
 */

/** The shared fixture with its two maps replaced by deterministic 32x32 images. */
async function fixture(seed: number): Promise<Buffer> {
  const document = buildFixtureDocument();
  const [baseColor, normal] = document.getRoot().listTextures();
  baseColor
    ?.setImage(
      rgbaPng({
        blue: (x) => (x * 4 + seed) % 256,
        height: 32,
        red: (x, y) => (x + y) % 256,
        width: 32,
      }),
    )
    .setMimeType("image/png");
  normal
    ?.setImage(
      rgbaPng({
        blue: () => 255,
        green: (_x, y) => 128 + (y % 5),
        height: 32,
        red: (x) => 128 + (x % 7),
        width: 32,
      }),
    )
    .setMimeType("image/png");
  return Buffer.from(await new NodeIO().writeBinary(document));
}

/**
 * Two reachable base-colour maps with different valid PNG containers that decode to the same
 * pixels. The Basis encoder therefore emits the same bytes, while source-keyed storage must
 * retain both distinct paths.
 */
async function encodedImageCollisionFixture(): Promise<{
  readonly input: Buffer;
  readonly sourcePng: Buffer;
  readonly rewrittenPng: Buffer;
}> {
  const document = buildFixtureDocument();
  const sourcePng = rgbaPng({
    blue: (x, y) => (x * 3 + y * 5) % 256,
    green: (x, y) => (x * 7 + y * 11) % 256,
    height: 32,
    red: (x, y) => (x * 13 + y * 17) % 256,
    width: 32,
  });
  // pngjs produces a different, still-valid container at level 0 while preserving every RGBA
  // sample. This is intentionally source-byte distinct rather than a copied texture object.
  const rewrittenPng = PNG.sync.write(PNG.sync.read(sourcePng), { deflateLevel: 0 });
  const [first, second] = document.getRoot().listTextures();
  const [cloth, skin] = document.getRoot().listMaterials();
  if (first === undefined || second === undefined || cloth === undefined || skin === undefined) {
    throw new Error("collision fixture requires the textured character materials");
  }
  first.setImage(sourcePng).setMimeType("image/png");
  second.setImage(rewrittenPng).setMimeType("image/png");
  // Both maps feed the same slot/settings and both materials are reachable from the fixture.
  cloth.setNormalTexture(null);
  skin.setBaseColorTexture(second);
  return {
    input: Buffer.from(await new NodeIO().writeBinary(document)),
    rewrittenPng,
    sourcePng,
  };
}

/** Two reachable textures with the same source key, retained independently of model dedup. */
async function repeatedSourceKeyFixture(): Promise<Buffer> {
  const document = buildFixtureDocument();
  const image = rgbaPng({
    blue: (x, y) => (x * 19 + y * 23) % 256,
    green: (x, y) => (x * 29 + y * 31) % 256,
    height: 32,
    red: (x, y) => (x * 37 + y * 41) % 256,
    width: 32,
  });
  const [first, second] = document.getRoot().listTextures();
  const [cloth, skin] = document.getRoot().listMaterials();
  if (first === undefined || second === undefined || cloth === undefined || skin === undefined) {
    throw new Error("repeated-source fixture requires the textured character materials");
  }
  first.setImage(image).setMimeType("image/png");
  second.setImage(image).setMimeType("image/png");
  cloth.setNormalTexture(null);
  skin.setBaseColorTexture(second);
  return Buffer.from(await new NodeIO().writeBinary(document));
}

function countingStore(
  inner: ISharedImageStore,
): ISharedImageStore & { puts: number; hits: number } {
  const counted = {
    hits: 0,
    puts: 0,
    get: async (key: string) => {
      const found = await inner.get(key);
      if (found !== undefined) counted.hits += 1;
      return found;
    },
    outputPath: (key: string, image: Parameters<ISharedImageStore["outputPath"]>[1]) =>
      inner.outputPath(key, image),
    put: async (key: string, image: Parameters<ISharedImageStore["put"]>[1]) => {
      counted.puts += 1;
      await inner.put(key, image);
    },
  };
  return counted;
}

async function applyShared(
  store: ISharedImageStore,
  input: Buffer,
  logical: string,
  options: IModelPassOptions = {},
): Promise<{ buffer: Buffer; auxiliaryOutputs: readonly { outputPath?: string }[] }> {
  const result = await modelPass({ ...options, sharedImages: store }).apply(input, logical);
  if (Buffer.isBuffer(result)) throw new Error("the model pass returned the input unchanged");
  return { auxiliaryOutputs: result.auxiliaryOutputs ?? [], buffer: result.buffer };
}

describe("shared model images", () => {
  it("should atomically accept concurrent writes for the same shared image", async () => {
    const root = await makeTempDir("threenative-shared-images-concurrent-");
    const store = createSharedImageStore(root);
    const image = {
      buffer: Buffer.from("shared image"),
      codec: "uastc",
      mimeType: "image/ktx2",
    };
    const key = sharedImageKey(image.buffer, { test: true });

    await expect(
      Promise.all(Array.from({ length: 8 }, () => store.put(key, image))),
    ).resolves.toEqual(Array.from({ length: 8 }));
    await expect(createSharedImageStore(root).get(key)).resolves.toEqual(image);
    await expect(readdir(path.join(root, "shared", "images"))).resolves.toEqual([
      `${key}.uastc.ktx2`,
    ]);
  });

  it("should declare one repeated source key when model dedup is disabled", async () => {
    const result = await applyShared(
      createSharedImageStore(),
      await repeatedSourceKeyFixture(),
      "props/repeated.glb",
      {
        passes: {
          dedup: false,
          meshopt: false,
          prune: false,
          quantize: false,
          reorder: false,
        },
        virtual: "none",
      },
    );

    expect(result.auxiliaryOutputs.map((output) => output.outputPath)).toHaveLength(1);
  });

  it("should retain one shared output per distinct source key when encoded bytes collide", async () => {
    const fixture = await encodedImageCollisionFixture();
    expect(fixture.rewrittenPng).not.toEqual(fixture.sourcePng);

    const result = await applyShared(
      createSharedImageStore(),
      fixture.input,
      "props/collision.glb",
    );
    const uris = (unpackGlb(result.buffer).json.images ?? []).map((image) => image.uri);
    const outputs = result.auxiliaryOutputs.map((output) => output.outputPath);

    expect(new Set(uris).size).toBe(2);
    expect(new Set(outputs).size).toBe(2);
  });

  it("should declare every distinct source-keyed shared image during an empty-public compile", async () => {
    const root = await makeTempDir("threenative-shared-images-collision-");
    await mkdir(path.join(root, "assets", "props"), { recursive: true });
    const fixture = await encodedImageCollisionFixture();
    await writeFile(path.join(root, "assets", "props", "collision.glb"), fixture.input);

    await expect(
      compileAssets({
        config: { models: { sharedImages: true } },
        cwd: root,
        transcoder: basisTranscoderPaths(),
      }),
    ).resolves.toMatchObject({ written: 1 });

    const files = (await readdir(path.join(root, "public", "shared", "images"))).sort();
    const expectedPaths = files.map((file) => `shared/images/${file}`);
    const manifest = JSON.parse(
      await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
    ) as { entries: Record<string, { sharedImages?: { output: string }[] }> };
    const receipt = JSON.parse(
      await readFile(path.join(root, "public", "bake.receipt.json"), "utf8"),
    ) as { outputs: { path: string }[] };

    expect(files).toHaveLength(2);
    expect(
      manifest.entries["props/collision.glb"]?.sharedImages?.map((image) => image.output),
    ).toEqual(expectedPaths);
    expect(
      receipt.outputs
        .map((output) => output.path)
        .filter((output) => output.startsWith("shared/images/")),
    ).toEqual(expectedPaths);
  });

  it("should write each distinct image once and reference it from every model by a relative uri", async () => {
    const store = countingStore(createSharedImageStore());
    const a = await applyShared(store, await fixture(0), "props/a.glb");
    const b = await applyShared(store, await fixture(0), "props/deep/b.glb");

    // Neither GLB embeds an image any more: every image is a uri into shared/images.
    const jsonA = unpackGlb(a.buffer).json;
    const jsonB = unpackGlb(b.buffer).json;
    expect(jsonA.images?.every((image) => image.bufferView === undefined)).toBe(true);
    const urisA = (jsonA.images ?? []).map((image) => image.uri);
    const urisB = (jsonB.images ?? []).map((image) => image.uri);
    expect(urisA).toHaveLength(2);
    for (const uri of urisA)
      expect(uri).toMatch(/^\.\.\/shared\/images\/[0-9a-f]{16}\.(?:uastc|etc1s)\.ktx2$/u);
    for (const uri of urisB)
      expect(uri).toMatch(/^\.\.\/\.\.\/shared\/images\/[0-9a-f]{16}\.(?:uastc|etc1s)\.ktx2$/u);
    // Same bytes, same files: the two models resolve to the same shared outputs.
    const outputsA = a.auxiliaryOutputs.map((output) => output.outputPath).sort();
    const outputsB = b.auxiliaryOutputs.map((output) => output.outputPath).sort();
    expect(outputsA).toEqual(outputsB);
    expect(new Set(outputsA).size).toBe(2);
    // Encoded once: the second model recalled both images instead of encoding them again.
    expect(store.puts).toBe(2);
    expect(store.hits).toBeGreaterThanOrEqual(2);

    // The output reads back through the store exactly as the runtime resolves it, with both
    // textures bound and the geometry intact.
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
    const byUri = new Map(
      a.auxiliaryOutputs.map((output) => [
        sharedImageUri("props/a.glb", output.outputPath ?? ""),
        (output as { buffer: Buffer }).buffer,
      ]),
    );
    const document = await readSharedGlb(io, a.buffer, async (uri) => {
      const bytes = byUri.get(uri);
      if (bytes === undefined) throw new Error(`unexpected uri ${uri}`);
      return bytes;
    });
    expect(document.getRoot().listTextures()).toHaveLength(2);
    expect(
      document
        .getRoot()
        .listTextures()
        .every((texture) => texture.getMimeType() === "image/ktx2"),
    ).toBe(true);
    expect(document.getRoot().listMeshes().length).toBeGreaterThan(0);
  });

  it("should key on the source image, so a different image is a different shared file", async () => {
    const store = countingStore(createSharedImageStore());
    const a = await applyShared(store, await fixture(0), "a.glb");
    const b = await applyShared(store, await fixture(9), "b.glb");
    const outputsA = new Set(a.auxiliaryOutputs.map((output) => output.outputPath));
    const outputsB = new Set(b.auxiliaryOutputs.map((output) => output.outputPath));
    // The normal map is identical across both fixtures and shared; the base colour differs.
    expect([...outputsA].filter((output) => outputsB.has(output))).toHaveLength(1);
    expect(store.puts).toBe(3);
  });

  it("should keep images embedded when no store is given", async () => {
    const result = await modelPass().apply(await fixture(0), "a.glb");
    if (Buffer.isBuffer(result)) throw new Error("the model pass returned the input unchanged");
    const json = unpackGlb(result.buffer).json;
    expect(
      json.images?.every((image) => image.uri === undefined && image.bufferView !== undefined),
    ).toBe(true);
    expect(result.auxiliaryOutputs).toBeUndefined();
  });

  it("should compile shared images once into public/shared/images and reuse them on the next build", async () => {
    const root = await makeTempDir("threenative-shared-images-");
    await mkdir(path.join(root, "assets", "props"), { recursive: true });
    await writeFile(path.join(root, "assets", "props", "a.glb"), await fixture(0));
    await writeFile(path.join(root, "assets", "props", "b.glb"), await fixture(0));

    const first = await compileAssets({
      config: { models: { sharedImages: true } },
      cwd: root,
      transcoder: basisTranscoderPaths(),
    });
    expect(first.written).toBe(2);
    const shared = path.join(root, "public", "shared", "images");
    const files = (await readdir(shared)).sort();
    expect(files).toHaveLength(2);
    const manifest = JSON.parse(
      await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
    ) as {
      entries: Record<
        string,
        { output: string; sharedImages?: { output: string; bytes: number; codec: string }[] }
      >;
    };
    const a = manifest.entries["props/a.glb"];
    const b = manifest.entries["props/b.glb"];
    expect(a?.sharedImages?.map((image) => image.output).sort()).toEqual(
      files.map((file) => `shared/images/${file}`),
    );
    expect(b?.sharedImages?.map((image) => image.output).sort()).toEqual(
      a?.sharedImages?.map((image) => image.output).sort(),
    );
    // The served GLB points at the shared file by a path that resolves from where it is served.
    const servedA = await readFile(path.join(root, "public", a?.output ?? ""));
    for (const image of unpackGlb(servedA).json.images ?? []) {
      expect(image.uri).toMatch(/^\.\.\/shared\/images\//u);
      expect(await stat(path.join(root, "public", "props", image.uri ?? ""))).toBeDefined();
    }
    // One receipt line per shared file, so the delete-test removes it exactly once.
    const receipt = JSON.parse(
      await readFile(path.join(root, "public", "bake.receipt.json"), "utf8"),
    ) as {
      outputs: { path: string }[];
    };
    const sharedPaths = receipt.outputs
      .map((output) => output.path)
      .filter((p) => p.startsWith("shared/images/"));
    expect(sharedPaths.sort()).toEqual(files.map((file) => `shared/images/${file}`));

    // Second build: nothing rewritten, and the shared files keep their mtimes — found on disk,
    // not re-encoded.
    const before = await Promise.all(
      files.map(async (file) => (await stat(path.join(shared, file))).mtimeMs),
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    const second = await compileAssets({
      config: { models: { sharedImages: true } },
      cwd: root,
      transcoder: basisTranscoderPaths(),
    });
    expect(second.written).toBe(0);
    expect(second.skipped).toBe(2);
    const after = await Promise.all(
      files.map(async (file) => (await stat(path.join(shared, file))).mtimeMs),
    );
    expect(after).toEqual(before);
  });

  it("should reject a non-boolean sharedImages setting", async () => {
    const root = await makeTempDir("threenative-shared-images-config-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "a.glb"), await fixture(0));
    await expect(
      compileAssets({
        config: { models: { sharedImages: "yes" as unknown as boolean } },
        cwd: root,
      }),
    ).rejects.toThrow(/TN_ASSETS_CONFIG_INVALID.*sharedImages/u);
  });
});
