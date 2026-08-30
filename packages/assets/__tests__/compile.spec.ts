import { chmod, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRLightsPunctual } from "@gltf-transform/extensions";
import { read as readKtx2 } from "ktx-parse";
import { describe, expect, it, vi } from "vitest";
import { buildFixtureGlb } from "../../../test-support/generate-fixture-model.js";
import { rgbaPng } from "../../../test-support/png.js";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { basisTranscoderPaths } from "../../../test-support/three-basis.js";
import { type IAssetSourceConfig, compileAssets } from "../src/index.js";

const TRANSCODER = basisTranscoderPaths();

describe("compileAssets", () => {
  it("should write a hashed output and a manifest entry when an input exists", async () => {
    const root = await makeTempDir("threenative-compile-hashed-");
    await mkdir(path.join(root, "assets"));
    // High-entropy pixels: the PNG stays large while the fixed-rate KTX2 encode shrinks,
    // which is what the byte assertions below pin.
    const source = rgbaPng({
      blue: (x, y) => (x * 31 + y * 17) % 256,
      green: (x, y) => (x * 7 + y * 29) % 256,
      height: 128,
      red: (x, y) => (x * 13 + y * 11) % 256,
      width: 128,
    });
    await writeFile(path.join(root, "assets", "rock.png"), source);

    const result = await compileAssets({ cwd: root, transcoder: TRANSCODER });

    expect(result.written).toBe(1);
    const manifest = JSON.parse(
      await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
    );
    expect(manifest.version).toBe(1);
    const entry = manifest.entries["rock.png"];
    expect(entry.output).toMatch(/^rock\.[0-9a-f]{8}\.ktx2$/u);
    expect(entry.kind).toBe("texture");
    expect(entry.format).toBe("etc1s");
    expect(entry.transcodeTargets).toEqual(["bc1", "etc2"]);
    expect(entry.passes).toEqual(["ktx2", "model"]);
    expect(entry.bytesBefore).toBe(source.length);
    expect(entry.bytesAfter).toBeLessThan(source.length);
    expect(entry.bytes).toBe(entry.bytesAfter);
    const compiled = await readFile(path.join(root, "public", entry.output));
    expect([...compiled.subarray(1, 7)].map((byte) => String.fromCharCode(byte)).join("")).toBe(
      "KTX 20",
    );
  });

  it("should throw when a pass throws", async () => {
    const root = await makeTempDir("threenative-compile-pass-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "rock.png"), "png");

    await expect(
      compileAssets({
        cwd: root,
        passes: [
          {
            name: "explode",
            apply: () => {
              throw new Error("boom");
            },
          },
        ],
      }),
    ).rejects.toThrow(/rock\.png/u);
  });

  it("should content-address an auxiliary output and record its manifest path", async () => {
    const root = await makeTempDir("threenative-compile-auxiliary-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "level.glb"), Buffer.from(await buildFixtureGlb()));

    await compileAssets({
      cwd: root,
      passes: [
        {
          name: "lightmap-fixture",
          apply: (input) => ({
            auxiliaryOutputs: [
              {
                buffer: Buffer.from("ktx2"),
                extension: ".ktx2",
                manifestField: "lightmaps",
                metadata: { texCoord: 1 },
                role: "lightmap",
              },
            ],
            buffer: input,
          }),
        },
      ],
    });

    const manifest = JSON.parse(
      await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
    );
    const lightmap = manifest.entries["level.glb"].lightmaps[0];
    expect(lightmap).toMatchObject({ bytes: 4, texCoord: 1 });
    expect(lightmap.output).toMatch(/^level\.lightmap\.[0-9a-f]{8}\.ktx2$/u);
    expect(await readFile(path.join(root, "public", lightmap.output), "utf8")).toBe("ktx2");
  });

  it("should not rewrite an output whose hash is unchanged", async () => {
    const root = await makeTempDir("threenative-compile-idempotent-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "rock.png"), rgbaPng({ height: 32, width: 32 }));

    const first = await compileAssets({ cwd: root });
    const manifest = JSON.parse(
      await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
    );
    const output = path.join(root, "public", manifest.entries["rock.png"].output);
    const before = (await stat(output)).mtimeMs;

    await new Promise((resolve) => setTimeout(resolve, 60));
    const second = await compileAssets({ cwd: root });

    expect(second.written).toBe(0);
    expect(second.skipped).toBe(first.written);
    expect((await stat(output)).mtimeMs).toBe(before);
  });

  it("should throw TN_ASSETS_OVERLAP when the output nests inside the source", async () => {
    const root = await makeTempDir("threenative-compile-overlap-");
    await mkdir(path.join(root, "assets"));

    await expect(compileAssets({ config: { output: "assets/out" }, cwd: root })).rejects.toThrow(
      "TN_ASSETS_OVERLAP",
    );
    await expect(compileAssets({ cwd: root, output: "public", source: "public" })).rejects.toThrow(
      "TN_ASSETS_OVERLAP",
    );
  });

  it("should recompile when the texture quality changes instead of re-serving stale bytes", async () => {
    const root = await makeTempDir("threenative-compile-quality-");
    await mkdir(path.join(root, "assets"));
    await writeFile(
      path.join(root, "assets", "rock.png"),
      rgbaPng({
        blue: (x, y) => (x * 31 + y * 17) % 256,
        green: (x, y) => (x * 7 + y * 29) % 256,
        height: 128,
        red: (x, y) => (x * 13 + y * 11) % 256,
        width: 128,
      }),
    );

    await compileAssets({
      config: { textures: { quality: 255 } },
      cwd: root,
      transcoder: TRANSCODER,
    });
    const manifestPath = path.join(root, "public", "assets.manifest.json");
    const first = JSON.parse(await readFile(manifestPath, "utf8"));

    const second = await compileAssets({
      config: { textures: { quality: 40 } },
      cwd: root,
      transcoder: TRANSCODER,
    });
    const secondManifest = JSON.parse(await readFile(manifestPath, "utf8"));

    expect(second.written).toBe(1);
    expect(secondManifest.entries["rock.png"].output).not.toBe(first.entries["rock.png"].output);
  });

  it("should skip compilation without touching the output when no source directory exists", async () => {
    // The pre-pipeline state: projects built before this step have no assets/ and their
    // builds must keep working unchanged.
    const root = await makeTempDir("threenative-compile-absent-");

    const result = await compileAssets({ cwd: root });

    expect(result).toEqual({ skipped: 0, written: 0 });
    await expect(stat(path.join(root, "public"))).rejects.toThrow();
  });

  it("should throw when the source path exists but is not a directory", async () => {
    const root = await makeTempDir("threenative-compile-invalid-");
    await writeFile(path.join(root, "assets"), "not a directory");

    await expect(compileAssets({ cwd: root })).rejects.toThrow(/TN_ASSETS_SOURCE_INVALID/u);
  });

  it("should throw naming the asset when an input cannot be read", async () => {
    const root = await makeTempDir("threenative-compile-unreadable-");
    await mkdir(path.join(root, "assets"));
    const secret = path.join(root, "assets", "secret.png");
    await writeFile(secret, "png");
    await chmod(secret, 0o000);

    try {
      await expect(compileAssets({ cwd: root })).rejects.toThrow(
        /TN_ASSETS_INPUT_UNREADABLE.*secret\.png/u,
      );
    } finally {
      await chmod(secret, 0o644);
    }
  });

  it("should regenerate a deleted manifest instead of passing on its absence", async () => {
    const root = await makeTempDir("threenative-compile-regen-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "rock.png"), rgbaPng({ height: 32, width: 32 }));
    await compileAssets({ cwd: root, transcoder: TRANSCODER });
    const firstName = JSON.parse(
      await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
    ).entries["rock.png"].output;
    await rm(path.join(root, "public", "assets.manifest.json"));

    // With no manifest to compare against the run rewrites — but the content-addressed
    // name must land on the exact bytes already on disk.
    const second = await compileAssets({ cwd: root, transcoder: TRANSCODER });
    const output = path.join(root, "public", firstName);

    expect(second.written).toBe(1);
    const manifest = JSON.parse(
      await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
    );
    expect(manifest.entries["rock.png"].output).toBe(firstName);
    const compiled = await readFile(output);
    expect([...compiled.subarray(1, 7)].map((byte) => String.fromCharCode(byte)).join("")).toBe(
      "KTX 20",
    );
  });

  it("should not publish an empty manifest when the source holds only dotfiles", async () => {
    // A served manifest is authoritative at runtime: an empty one would reject every load
    // in a game whose assets still live in public/ by hand. Empty source means no manifest.
    const root = await makeTempDir("threenative-compile-empty-source-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", ".gitkeep"), "");

    const result = await compileAssets({ cwd: root });

    expect(result).toEqual({ skipped: 0, written: 0 });
    await expect(stat(path.join(root, "public", "assets.manifest.json"))).rejects.toThrow();
  });

  it("should drop the stale manifest once the last input is removed", async () => {
    const root = await makeTempDir("threenative-compile-stale-manifest-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "rock.png"), rgbaPng({ height: 32, width: 32 }));
    await compileAssets({ cwd: root, transcoder: TRANSCODER });
    await rm(path.join(root, "assets", "rock.png"));

    await compileAssets({ cwd: root });

    await expect(stat(path.join(root, "public", "assets.manifest.json"))).rejects.toThrow();
  });

  it("should throw on unknown config keys and duplicate logical paths", async () => {
    const configured = await makeTempDir("threenative-compile-config-");
    await mkdir(path.join(configured, "assets"));
    // The cast is the point: TypeScript rejects this key statically, and the compile step
    // must still reject it at runtime for callers arriving through parsed config.
    const misconfigured = { bogus: "nope" } as IAssetSourceConfig;
    await expect(compileAssets({ config: misconfigured, cwd: configured })).rejects.toThrow(
      /bogus/u,
    );

    const duplicated = await makeTempDir("threenative-compile-duplicate-");
    await mkdir(path.join(duplicated, "assets"));
    await writeFile(
      path.join(duplicated, "assets", "rock.png"),
      rgbaPng({ height: 32, width: 32 }),
    );
    await symlink(".", path.join(duplicated, "assets", "self"), "dir");
    await expect(compileAssets({ cwd: duplicated })).rejects.toThrow(/duplicate/iu);
    await expect(compileAssets({ cwd: duplicated })).rejects.toThrow(/self/u);
  });

  it("should ship textures verbatim when assets.textures is none", async () => {
    const root = await makeTempDir("threenative-compile-none-");
    await mkdir(path.join(root, "assets"));
    const source = rgbaPng({ height: 64, width: 64 });
    await writeFile(path.join(root, "assets", "rock.png"), source);

    await compileAssets({ config: { textures: "none" }, cwd: root });

    const manifest = JSON.parse(
      await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
    );
    const entry = manifest.entries["rock.png"];
    expect(entry.output).toMatch(/^rock\.[0-9a-f]{8}\.png$/u);
    expect(entry.format).toBeUndefined();
    expect(entry.bytesBefore).toBeUndefined();
    // Textures: none — the model pass is the only built-in in this configuration.
    expect(entry.passes).toEqual(["model"]);
    expect((await readFile(path.join(root, "public", entry.output))).equals(source)).toBe(true);
    await expect(stat(path.join(root, "public", "basis"))).rejects.toThrow();
  });

  it("should copy three's Basis transcoder next to the compiled outputs", async () => {
    const root = await makeTempDir("threenative-compile-transcoder-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "rock.png"), rgbaPng({ height: 32, width: 32 }));

    await compileAssets({ cwd: root, transcoder: TRANSCODER });

    const basisJs = await readFile(path.join(root, "public", "basis", "basis_transcoder.js"));
    expect(basisJs.length).toBeGreaterThan(0);
    expect((await stat(path.join(root, "public", "basis", "basis_transcoder.wasm"))).isFile()).toBe(
      true,
    );
  });

  it("should reject unknown texture config keys and codec names at the assets layer", async () => {
    const root = await makeTempDir("threenative-compile-textures-config-");
    await mkdir(path.join(root, "assets"));

    const unknownKey = {
      textures: { quality: 150, unknown: true },
    } as unknown as IAssetSourceConfig;
    await expect(compileAssets({ config: unknownKey, cwd: root })).rejects.toThrow(
      /TN_ASSETS_CONFIG_UNKNOWN_KEY.*assets\.textures\.unknown/u,
    );

    const badCodec = {
      textures: { overrides: [{ codec: "supercompressed", glob: "**/*.png" }] },
    } as unknown as IAssetSourceConfig;
    await expect(compileAssets({ config: badCodec, cwd: root })).rejects.toThrow(
      /must be one of etc1s, none, uastc/u,
    );

    const badQuality = { textures: { quality: 900 } } as unknown as IAssetSourceConfig;
    await expect(compileAssets({ config: badQuality, cwd: root })).rejects.toThrow(
      /between 1 and 255/u,
    );
  });

  it("should optimize a model through the built-in registry and record the manifest fields", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const root = await makeTempDir("threenative-compile-model-");
      await mkdir(path.join(root, "assets"));
      const source = Buffer.from(await buildFixtureGlb());
      await writeFile(path.join(root, "assets", "character.glb"), source);

      const result = await compileAssets({ cwd: root });

      expect(result.written).toBe(1);
      const manifest = JSON.parse(
        await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
      );
      const entry = manifest.entries["character.glb"];
      expect(entry.output).toMatch(/^character\.[0-9a-f]{8}\.glb$/u);
      expect(entry.kind).toBe("model");
      expect(entry.passes).toEqual(["ktx2", "model"]);
      expect(entry.extensions).toEqual(["EXT_meshopt_compression", "KHR_mesh_quantization"]);
      expect(entry.triangles).toBe(20);
      expect(entry.vertices).toBe(18);
      expect(entry.bytesBefore).toBe(source.length);
      expect(entry.bytesAfter).toBeGreaterThan(0);
      expect(entry.bytes).toBe(entry.bytesAfter);
      const compiled = await readFile(path.join(root, "public", entry.output));
      // The compiled output is still a `.glb` — same container, compressed contents.
      expect(compiled.subarray(0, 4).toString("ascii")).toBe("glTF");

      // The size report prints the model rows after the texture rows.
      const logged = vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
      expect(logged.some((line) => /^model character\.glb \(/u.test(line))).toBe(true);
      expect(logged.some((line) => line.startsWith("models total:"))).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("should run the configured lightmap UV pass through the built-in registry", async () => {
    const root = await makeTempDir("threenative-compile-lightmap-");
    await mkdir(path.join(root, "assets"));
    const source = await readFile(
      new URL(
        "../../create-threenative/templates/starter/assets/native-proof.glb",
        import.meta.url,
      ),
    );
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const document = await io.readBinary(source);
    const extension = document.createExtension(KHRLightsPunctual);
    const light = extension.createLight("bake-light").setType("point").setIntensity(1);
    document
      .getRoot()
      .listScenes()[0]
      ?.addChild(
        document
          .createNode("bake-light")
          .setTranslation([0, 3, 0])
          .setExtension("KHR_lights_punctual", light),
      );
    await writeFile(path.join(root, "assets", "room.glb"), await io.writeBinary(document));

    await compileAssets({
      config: { models: { lightmap: { atlasSize: 128, padding: 2 } } },
      cwd: root,
    });

    const manifest = JSON.parse(
      await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
    );
    const entry = manifest.entries["room.glb"];
    expect(entry.passes).toEqual(["ktx2", "lightmap-uv2", "model"]);
    expect(entry.lightmapAtlas).toMatchObject({ padding: 2, skippedMeshes: [] });
    expect(entry.lightmapAtlas.chartCount).toBeGreaterThan(0);
    expect(entry.lightmapAtlas.width).toBeGreaterThan(0);
    expect(entry.lightmapAtlas.height).toBeGreaterThan(0);
    expect(entry.lightmaps).toHaveLength(1);
    expect(entry.lightmaps[0]).toMatchObject({ format: "etc1s", texCoord: 1 });
    const lightmap = await readFile(path.join(root, "public", entry.lightmaps[0].output));
    expect(readKtx2(lightmap).levelCount).toBeGreaterThan(1);
    const compiled = await readFile(path.join(root, "public", entry.output));
    const json = JSON.parse(compiled.subarray(20, 20 + compiled.readUInt32LE(12)).toString("utf8"));
    expect(json.meshes[0].primitives[0].attributes.TEXCOORD_1).toEqual(expect.any(Number));
  });

  it("should ship a model byte-identical when assets.models is none", async () => {
    const root = await makeTempDir("threenative-compile-model-none-");
    await mkdir(path.join(root, "assets"));
    const source = Buffer.from(await buildFixtureGlb());
    await writeFile(path.join(root, "assets", "character.glb"), source);

    await compileAssets({ config: { models: "none" }, cwd: root });

    const manifest = JSON.parse(
      await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
    );
    const entry = manifest.entries["character.glb"];
    expect(entry.output).toMatch(/^character\.[0-9a-f]{8}\.glb$/u);
    expect(entry.passes).toEqual(["ktx2"]);
    expect(entry.triangles).toBeUndefined();
    expect(entry.extensions).toBeUndefined();
    expect((await readFile(path.join(root, "public", entry.output))).equals(source)).toBe(true);
  });

  it("should reject unknown model config keys and pass names at the assets layer", async () => {
    const root = await makeTempDir("threenative-compile-model-config-");
    await mkdir(path.join(root, "assets"));

    const unknownKey = { models: { bogus: true } } as unknown as IAssetSourceConfig;
    await expect(compileAssets({ config: unknownKey, cwd: root })).rejects.toThrow(
      /TN_ASSETS_CONFIG_UNKNOWN_KEY.*assets\.models\.bogus/u,
    );

    const unknownPass = {
      models: { passes: { decimate: true } },
    } as unknown as IAssetSourceConfig;
    await expect(compileAssets({ config: unknownPass, cwd: root })).rejects.toThrow(
      /TN_ASSETS_CONFIG_UNKNOWN_KEY.*assets\.models\.passes\.decimate/u,
    );

    const shallowPass = { models: { passes: "fast" } } as unknown as IAssetSourceConfig;
    await expect(compileAssets({ config: shallowPass, cwd: root })).rejects.toThrow(
      /TN_ASSETS_CONFIG_INVALID.*assets\.models\.passes must be an object/u,
    );

    const badDepth = {
      models: { quantize: { positionBits: 32 } },
    } as unknown as IAssetSourceConfig;
    await expect(compileAssets({ config: badDepth, cwd: root })).rejects.toThrow(
      /TN_ASSETS_CONFIG_INVALID.*between 1 and 16 bits/u,
    );
  });
});
