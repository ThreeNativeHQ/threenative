import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { read as readKTX2 } from "ktx-parse";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { describe, expect, it, vi } from "vitest";
import { buildFixtureDocument } from "../../../test-support/generate-fixture-model.js";
import { rgbaPng } from "../../../test-support/png.js";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { basisTranscoderPaths } from "../../../test-support/three-basis.js";
import { type IAssetSourceConfig, compileAssets } from "../src/index.js";
import { modelPass } from "../src/passes/model.js";
import { parsePng } from "../src/png.js";

/**
 * Proof that the textures *inside* a `.glb` go through the pipeline too. A prop carrying
 * three 2048x2048 JPEGs decodes to ~67 MB of VRAM however small the container is, so the
 * geometry-only model pass was shipping the expensive half of every asset untouched.
 */

/** Re-reads pass output the way the runtime does: every extension registered. */
async function readOutput(buffer: Buffer): Promise<Document> {
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  return io.readJSON(await io.binaryToJSON(new Uint8Array(buffer)));
}

/** The shared skinned fixture, with its two embedded maps replaced at a chosen size. */
async function fixtureWithTextures(options: {
  readonly height?: number;
  readonly width: number;
}): Promise<Buffer> {
  const { width } = options;
  const height = options.height ?? width;
  const document = buildFixtureDocument();
  const [baseColor, normal] = document.getRoot().listTextures();
  baseColor
    ?.setImage(
      rgbaPng({
        blue: (x, y) => (x * 19 + y * 23) % 256,
        green: (x, y) => (x * 29 + y * 31) % 256,
        height,
        red: (x, y) => (x * 37 + y * 41) % 256,
        width,
      }),
    )
    .setMimeType("image/png");
  normal
    ?.setImage(
      // A perfectly flat normal map is a no-op `prune` deletes outright, which would make
      // every assertion below measure one texture instead of two.
      rgbaPng({
        blue: () => 255,
        green: (x, y) => 96 + ((x * 29 + y * 31) % 64),
        height,
        red: (x, y) => 96 + ((x * 37 + y * 41) % 64),
        width,
      }),
    )
    .setMimeType("image/png");
  return Buffer.from(await new NodeIO().writeBinary(document));
}

function apply(
  input: Buffer,
  options?: Parameters<typeof modelPass>[0],
): Promise<Buffer | { buffer: Buffer; entry?: Readonly<Record<string, unknown>> }> {
  return Promise.resolve(modelPass(options).apply(input, "character.glb")) as Promise<
    Buffer | { buffer: Buffer; entry?: Readonly<Record<string, unknown>> }
  >;
}

async function compiled(
  input: Buffer,
  options?: Parameters<typeof modelPass>[0],
): Promise<{ buffer: Buffer; entry: Readonly<Record<string, unknown>> }> {
  const result = await apply(input, options);
  if (Buffer.isBuffer(result)) throw new Error("model pass returned an unchanged buffer");
  return { buffer: result.buffer, entry: result.entry ?? {} };
}

describe("embedded model textures", () => {
  it("should transcode every embedded image to KTX2 and declare KHR_texture_basisu", async () => {
    const input = await fixtureWithTextures({ width: 32 });
    const { buffer } = await compiled(input);

    const root = (await readOutput(buffer)).getRoot();
    const extensions = new Set(root.listExtensionsUsed().map((item) => item.extensionName));
    expect(extensions.has("KHR_texture_basisu")).toBe(true);
    const textures = root.listTextures();
    expect(textures.length).toBe(2);
    for (const texture of textures) {
      expect(texture.getMimeType()).toBe("image/ktx2");
      const image = texture.getImage();
      expect(image).not.toBeNull();
      // Mips are generated at encode time: an uncompressed upload without them looks worse
      // than the PNG it replaced.
      expect(readKTX2(image ?? new Uint8Array()).levelCount).toBeGreaterThan(1);
    }
  });

  it("should declare the extension the way a stock GLTFLoader reads it", async () => {
    const input = await fixtureWithTextures({ width: 32 });
    const { buffer } = await compiled(input);
    // three's GLTFLoader does not consult gltf-transform: it reads this JSON, sees
    // KHR_texture_basisu on the texture, and hands `source` to the KTX2Loader.
    const json = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString("utf8")) as {
      extensionsRequired?: string[];
      extensionsUsed?: string[];
      images: { mimeType?: string }[];
      textures: { extensions?: { KHR_texture_basisu?: { source: number } }; source?: number }[];
    };
    expect(json.extensionsUsed).toContain("KHR_texture_basisu");
    expect(json.extensionsRequired).toContain("KHR_texture_basisu");
    for (const texture of json.textures) {
      const source = texture.extensions?.KHR_texture_basisu?.source;
      expect(source).toEqual(expect.any(Number));
      // The core `source` must stay unset: a fallback there would be an image no decoder
      // in the chain can read.
      expect(texture.source).toBeUndefined();
      expect(json.images[source ?? -1]?.mimeType).toBe("image/ktx2");
    }
  });

  it("should pick UASTC for the normal map and ETC1S for opaque colour", async () => {
    const input = await fixtureWithTextures({ width: 32 });
    const { entry } = await compiled(input);
    const summary = entry.embeddedTextures as
      | { readonly formats: Readonly<Record<string, string>> }
      | undefined;
    expect(summary?.formats["cloth-normal"]).toBe("uastc");
    expect(summary?.formats.checker).toBe("etc1s");
  });

  it("should keep every material slot and UV set bound after compression", async () => {
    const input = await fixtureWithTextures({ width: 32 });
    const { buffer } = await compiled(input);
    const material = (await readOutput(buffer))
      .getRoot()
      .listMaterials()
      .find((item) => item.getName() === "cloth");
    expect(material?.getBaseColorTexture()).not.toBeNull();
    expect(material?.getNormalTexture()).not.toBeNull();
    expect(material?.getBaseColorTextureInfo()?.getTexCoord()).toBe(0);
    expect(material?.getNormalTextureInfo()?.getTexCoord()).toBe(0);
  });

  it("should cap the resolution of an oversized embedded texture", async () => {
    const input = await fixtureWithTextures({ width: 32 });
    const { buffer, entry } = await compiled(input, { textures: { maxSize: 16 } });
    const root = (await readOutput(buffer)).getRoot();
    for (const texture of root.listTextures()) {
      const container = readKTX2(texture.getImage() ?? new Uint8Array());
      expect(container.pixelWidth).toBe(16);
      expect(container.pixelHeight).toBe(16);
    }
    const summary = entry.embeddedTextures as { readonly resized: number } | undefined;
    expect(summary?.resized).toBe(2);
  });

  it("should leave a texture under the cap at its authored size", async () => {
    const input = await fixtureWithTextures({ width: 32 });
    const { buffer, entry } = await compiled(input, { textures: { maxSize: 64 } });
    const root = (await readOutput(buffer)).getRoot();
    for (const texture of root.listTextures()) {
      expect(readKTX2(texture.getImage() ?? new Uint8Array()).pixelWidth).toBe(32);
    }
    expect((entry.embeddedTextures as { readonly resized: number } | undefined)?.resized).toBe(0);
  });

  it("should report bytes and estimated GPU bytes before and after", async () => {
    const input = await fixtureWithTextures({ width: 32 });
    const { entry } = await compiled(input);
    const summary = entry.embeddedTextures as
      | {
          readonly bytesAfter: number;
          readonly bytesBefore: number;
          readonly count: number;
          readonly gpuBytesAfter: number;
          readonly gpuBytesBefore: number;
        }
      | undefined;
    expect(summary?.count).toBe(2);
    expect(summary?.bytesBefore).toBeGreaterThan(0);
    expect(summary?.bytesAfter).toBeGreaterThan(0);
    // 32x32 RGBA with mips against BC1/BC7 with mips: the GPU cost must fall.
    expect(summary?.gpuBytesBefore).toBe(2 * Math.round(32 * 32 * 4 * (4 / 3)));
    expect(summary?.gpuBytesAfter).toBeLessThan(summary?.gpuBytesBefore ?? 0);
  });

  it('should ship images untouched when textures are "none"', async () => {
    const input = await fixtureWithTextures({ width: 32 });
    const { buffer, entry } = await compiled(input, { textures: "none" });
    const root = (await readOutput(buffer)).getRoot();
    for (const texture of root.listTextures()) {
      expect(texture.getMimeType()).toBe("image/png");
    }
    expect(entry.embeddedTextures).toBeUndefined();
  });

  it("should honour a per-slot codec override", async () => {
    const input = await fixtureWithTextures({ width: 32 });
    const { entry } = await compiled(input, {
      textures: { overrides: [{ codec: "etc1s", slot: "normalTexture" }] },
    });
    const summary = entry.embeddedTextures as
      | { readonly formats: Readonly<Record<string, string>> }
      | undefined;
    expect(summary?.formats["cloth-normal"]).toBe("etc1s");
  });

  // Same 4x4 block rule as the standalone pass, same split: an automatic cook retains an image
  // no block codec can take, and only a named per-slot codec fails the build.
  it("should retain an image whose size is not a whole number of blocks", async () => {
    const input = await fixtureWithTextures({ height: 30, width: 30 });
    const before = new Map(
      (await readOutput(input))
        .getRoot()
        .listTextures()
        .map((texture) => [texture.getName(), Buffer.from(texture.getImage() ?? new Uint8Array())]),
    );
    const { buffer, entry } = await compiled(input);
    const summary = entry.embeddedTextures as {
      readonly formats: Readonly<Record<string, string>>;
      readonly gpuBytesAfter: number;
      readonly gpuBytesBefore: number;
      readonly resized: number;
      readonly skippedCompression: Readonly<Record<string, string>>;
    };

    for (const texture of (await readOutput(buffer)).getRoot().listTextures()) {
      const key = texture.getName();
      const image = Buffer.from(texture.getImage() ?? new Uint8Array());
      expect(texture.getMimeType()).toBe("image/png");
      expect(image.equals(before.get(key) ?? Buffer.alloc(0))).toBe(true);
      expect(parsePng(image)).toMatchObject({ height: 30, width: 30 });
      expect(summary.formats[key]).toBe("none");
      expect(summary.skippedCompression[key]).toBe("block-size");
    }
    expect(summary.resized).toBe(0);
    // Nothing was compressed, so the VRAM estimate must still charge 4 bytes per pixel.
    expect(summary.gpuBytesAfter).toBe(2 * Math.round(30 * 30 * 4 * (4 / 3)));
    expect(summary.gpuBytesAfter).toBe(summary.gpuBytesBefore);
  });

  it("should still fail closed on a non-block-aligned image under a named per-slot codec", async () => {
    const input = await fixtureWithTextures({ height: 30, width: 30 });
    await expect(
      apply(input, { textures: { overrides: [{ codec: "uastc", slot: "baseColorTexture" }] } }),
    ).rejects.toThrow(/TN_ASSETS_MODEL_TEXTURE_BLOCK_SIZE.*30x30/su);
  });

  it("should fail closed naming an embedded image it cannot decode", async () => {
    const document = buildFixtureDocument();
    document
      .getRoot()
      .listTextures()[0]
      ?.setImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
      .setMimeType("image/png");
    const input = Buffer.from(await new NodeIO().writeBinary(document));
    // Geometry sub-passes off: `prune` decodes every image itself and would report the
    // truncated source in its own vocabulary before this stage ever sees it.
    await expect(
      apply(input, {
        passes: { dedup: false, meshopt: false, prune: false, quantize: false, reorder: false },
      }),
    ).rejects.toThrow(/TN_ASSETS_MODEL_TEXTURE_UNDECODABLE/u);
  });

  it("should fail closed when compression drops a texture binding", async () => {
    const input = await fixtureWithTextures({ width: 32 });
    const { buffer } = await compiled(input);
    // Negative control for the self-verify: strip a slot from the compiled output and the
    // same comparison the pass runs must name it.
    const tampered = await readOutput(buffer);
    tampered.getRoot().listMaterials()[0]?.setNormalTexture(null);
    await MeshoptEncoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      "meshopt.decoder": MeshoptDecoder,
      "meshopt.encoder": MeshoptEncoder,
    });
    const stripped = Buffer.from(await io.writeBinary(tampered));
    const { assertNoTextureDrift, textureBindings } = await import("../src/passes/model.js");
    const intact = textureBindings((await readOutput(buffer)).getRoot());
    const missing = textureBindings((await readOutput(stripped)).getRoot());
    expect(() => assertNoTextureDrift(intact, missing, "character.glb")).toThrow(
      /TN_ASSETS_MODEL_TEXTURE_DRIFT/u,
    );
  });
});

describe("mesh simplification", () => {
  it("should leave triangles untouched unless simplification is declared", async () => {
    const input = await fixtureWithTextures({ width: 32 });
    const { entry } = await compiled(input);
    expect(entry.triangles).toBe(20);
  });

  it("should report the ratio it achieved next to the one that was asked for", async () => {
    // The error tolerance can stop the simplifier well short of the requested ratio — on a
    // real 99k-triangle prop, `ratio: 0.05` with the default error lands at 15.2%. A build
    // that quietly delivers three times the triangles asked for is the kind of silence this
    // pipeline exists to remove, so both numbers are reported.
    const input = Buffer.from(
      await new NodeIO().writeBinary(buildFixtureDocument({ gridDepth: 40, gridWidth: 40 })),
    );
    const { entry } = await compiled(input, {
      simplify: { error: 0.001, ratio: 0.1 },
      textures: "none",
    });
    const summary = entry.simplify as
      | {
          readonly achievedRatio: number;
          readonly error: number;
          readonly requestedRatio: number;
          readonly trianglesAfter: number;
          readonly trianglesBefore: number;
        }
      | undefined;
    expect(summary?.requestedRatio).toBe(0.1);
    expect(summary?.error).toBe(0.001);
    expect(summary?.trianglesBefore).toBe(3208);
    expect(summary?.trianglesAfter).toBe(Number(entry.triangles));
    expect(summary?.achievedRatio).toBeCloseTo(
      (summary?.trianglesAfter ?? 0) / (summary?.trianglesBefore ?? 1),
      5,
    );
  });

  it("should print the achieved ratio in the compile size report", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const root = await makeTempDir("threenative-simplify-report-");
      await mkdir(path.join(root, "assets"));
      await writeFile(
        path.join(root, "assets", "dense.glb"),
        Buffer.from(
          await new NodeIO().writeBinary(buildFixtureDocument({ gridDepth: 40, gridWidth: 40 })),
        ),
      );

      await compileAssets({
        config: { models: { simplify: { ratio: 0.1 }, textures: "none" } },
        cwd: root,
      });

      const logged = vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
      expect(
        logged.some((line) =>
          /^simplified dense\.glb: 3208 -> \d+ triangles \(\d+\.\d% kept, requested 10\.0%\)/u.test(
            line,
          ),
        ),
      ).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("should reduce triangles while preserving joints and clips when declared", async () => {
    const input = Buffer.from(
      await new NodeIO().writeBinary(buildFixtureDocument({ gridDepth: 24, gridWidth: 24 })),
    );
    const before = await compiled(input, { textures: "none" });
    const after = await compiled(input, { simplify: { ratio: 0.5 }, textures: "none" });
    expect(Number(after.entry.triangles)).toBeLessThan(Number(before.entry.triangles));
    const root = (await readOutput(after.buffer)).getRoot();
    expect(root.listSkins()[0]?.listJoints().length).toBe(3);
    expect(root.listAnimations().length).toBe(1);
  });
});

describe("embedded textures through the compile step", () => {
  it("should record the summary and ship the transcoder for a project with models only", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const root = await makeTempDir("threenative-model-textures-");
      await mkdir(path.join(root, "assets"));
      const source = await fixtureWithTextures({ width: 32 });
      await writeFile(path.join(root, "assets", "prop.glb"), source);

      await compileAssets({ cwd: root, transcoder: basisTranscoderPaths() });

      const manifest = JSON.parse(
        await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
      ) as { entries: Record<string, Record<string, unknown>> };
      const entry = manifest.entries["prop.glb"];
      expect(entry?.extensions).toContain("KHR_texture_basisu");
      expect(entry?.embeddedTextures).toMatchObject({ count: 2, resized: 0 });
      // Not one standalone texture in this project: without the model check the runtime
      // would point its KTX2 loader at a directory that was never written.
      expect(
        (await stat(path.join(root, "public", "basis", "basis_transcoder.wasm"))).isFile(),
      ).toBe(true);
      const logged = vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
      expect(logged.some((line) => /^embedded textures prop\.glb: 2 image\(s\)/u.test(line))).toBe(
        true,
      );
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('should ship images as authored and need no transcoder when models.textures is "none"', async () => {
    const root = await makeTempDir("threenative-model-textures-none-");
    await mkdir(path.join(root, "assets"));
    await writeFile(
      path.join(root, "assets", "prop.glb"),
      await fixtureWithTextures({ width: 32 }),
    );

    await compileAssets({ config: { models: { textures: "none" } }, cwd: root });

    const manifest = JSON.parse(
      await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
    ) as { entries: Record<string, Record<string, unknown>> };
    expect(manifest.entries["prop.glb"]?.extensions).not.toContain("KHR_texture_basisu");
    expect(manifest.entries["prop.glb"]?.embeddedTextures).toBeUndefined();
    await expect(stat(path.join(root, "public", "basis"))).rejects.toThrow();
  });

  // The manifest narrows the pass summary field by field rather than casting it, so a reason the
  // narrowing does not recognise is dropped on the way out and the budget never sees it.
  it("should carry the block-size reason into the manifest, fresh and on a cache hit", async () => {
    const root = await makeTempDir("threenative-model-textures-block-size-");
    await mkdir(path.join(root, "assets"));
    await writeFile(
      path.join(root, "assets", "prop.glb"),
      await fixtureWithTextures({ height: 30, width: 30 }),
    );
    const options = { concurrency: 1, cwd: root, transcoder: basisTranscoderPaths() };

    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((line) => lines.push(String(line)));
    try {
      await compileAssets(options);
      expect(lines).toContain(
        "embedded texture prop.glb#cloth-normal: compression skipped: block-size",
      );
      lines.length = 0;
      const second = await compileAssets(options);
      expect(second.skipped).toBe(1);
      expect(lines).toContain(
        "embedded texture prop.glb#cloth-normal: compression skipped: block-size",
      );
    } finally {
      log.mockRestore();
    }
    const manifest = JSON.parse(
      await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
    ) as { entries: Record<string, Record<string, unknown>> };
    const summary = manifest.entries["prop.glb"]?.embeddedTextures as {
      readonly skippedCompression: Readonly<Record<string, string>>;
    };
    expect(summary.skippedCompression["cloth-normal"]).toBe("block-size");
    expect(manifest.entries["prop.glb"]?.extensions).not.toContain("KHR_texture_basisu");
  });

  it("should reject malformed embedded-texture and simplify config", async () => {
    const root = await makeTempDir("threenative-model-textures-config-");
    await mkdir(path.join(root, "assets"));
    const compile = (models: unknown): Promise<unknown> =>
      compileAssets({ config: { models } as IAssetSourceConfig, cwd: root });

    await expect(compile({ textures: { unknown: true } })).rejects.toThrow(
      /TN_ASSETS_CONFIG_UNKNOWN_KEY: assets\.models\.textures\.unknown/u,
    );
    await expect(compile({ textures: "off" })).rejects.toThrow(
      /TN_ASSETS_CONFIG_INVALID: assets\.models\.textures must be "none" or an object/u,
    );
    await expect(compile({ textures: { maxSize: 0 } })).rejects.toThrow(
      /TN_ASSETS_CONFIG_INVALID: assets\.models\.textures\.maxSize must be a positive integer/u,
    );
    await expect(
      compile({ textures: { overrides: [{ codec: "bc7", slot: "normalTexture" }] } }),
    ).rejects.toThrow(/codec must be one of etc1s, none, uastc/u);
    await expect(
      compile({ textures: { overrides: [{ codec: "etc1s", slot: "" }] } }),
    ).rejects.toThrow(/slot must be a non-empty string/u);
    await expect(compile({ simplify: { ratio: 0 } })).rejects.toThrow(
      /assets\.models\.simplify\.ratio must be a number greater than 0 and at most 1/u,
    );
    await expect(compile({ simplify: { error: -1, ratio: 0.5 } })).rejects.toThrow(
      /assets\.models\.simplify\.error must be a non-negative number/u,
    );
    await expect(compile({ simplify: { ratio: 0.5, unknown: 1 } })).rejects.toThrow(
      /TN_ASSETS_CONFIG_UNKNOWN_KEY: assets\.models\.simplify\.unknown/u,
    );
  });
});
