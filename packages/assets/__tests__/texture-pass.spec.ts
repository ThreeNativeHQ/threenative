import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { read as readKTX2 } from "ktx-parse";
import { describe, expect, it } from "vitest";
import { rgbaPng } from "../../../test-support/png.js";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { basisTranscoderPaths } from "../../../test-support/three-basis.js";
import { type IAssetSourceConfig, compileAssets, texturePass } from "../src/index.js";

const TRANSCODER = basisTranscoderPaths();

async function compileOne(
  prefix: string,
  fileName: string,
  bytes: Buffer,
  config?: IAssetSourceConfig,
): Promise<{
  entry: Record<string, unknown>;
  manifest: Record<string, unknown>;
  outputBytes: Buffer;
}> {
  const root = await makeTempDir(prefix);
  await mkdir(path.dirname(path.join(root, "assets", fileName)), { recursive: true });
  await writeFile(path.join(root, "assets", fileName), bytes);
  await compileAssets({ config, cwd: root, transcoder: TRANSCODER });
  const manifest = JSON.parse(
    await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
  ) as { entries: Record<string, Record<string, unknown> | undefined> };
  const entry = manifest.entries[fileName];
  if (entry === undefined) throw new Error(`no manifest entry for '${fileName}'`);
  return {
    entry,
    manifest,
    outputBytes: await readFile(path.join(root, "public", String(entry.output))),
  };
}

function ktx2Magic(bytes: Buffer): boolean {
  return [...bytes.subarray(1, 7)].map((byte) => String.fromCharCode(byte)).join("") === "KTX 20";
}

describe("the ktx2 texture pass", () => {
  it("should encode to UASTC when the source has an alpha channel", async () => {
    // Alpha varies across the row, so stripping it changes the codec choice — that is the
    // negative control for this test.
    const { entry, outputBytes } = await compileOne(
      "threenative-tex-uastc-",
      "decal.png",
      rgbaPng({ alpha: (x) => (x % 2 === 0 ? 255 : 0), height: 64, width: 64 }),
    );

    expect(entry.format).toBe("uastc");
    expect(entry.transcodeTargets).toEqual(["astc4x4", "bc7"]);
    expect(String(entry.output)).toMatch(/^decal\.[0-9a-f]{8}\.ktx2$/u);
    expect(ktx2Magic(outputBytes)).toBe(true);
  });

  it("should honour a config override over the heuristic", async () => {
    // The source has alpha, so the heuristic alone would pick UASTC; the override must win.
    const overridden = await compileOne(
      "threenative-tex-override-",
      "decal.png",
      rgbaPng({ alpha: () => 128, height: 64, width: 64 }),
      { textures: { overrides: [{ codec: "etc1s", glob: "**/*.png" }] } },
    );
    expect(overridden.entry.format).toBe("etc1s");
    expect(ktx2Magic(overridden.outputBytes)).toBe(true);

    // A narrower override beats a broader one, first match wins.
    const narrowed = await compileOne(
      "threenative-tex-override-narrow-",
      "props/decal.png",
      rgbaPng({ alpha: () => 10, height: 32, width: 32 }),
      {
        textures: {
          overrides: [
            { codec: "uastc", glob: "props/**" },
            { codec: "etc1s", glob: "**/*.png" },
          ],
        },
      },
    );
    expect(narrowed.entry.format).toBe("uastc");
  });

  it("should emit a full mip chain", async () => {
    const root = await makeTempDir("threenative-tex-mips-");
    await mkdir(path.join(root, "assets"));
    await writeFile(
      path.join(root, "assets", "ground.png"),
      rgbaPng({ blue: (x) => x * 4, height: 64, width: 64 }),
    );
    await compileAssets({ cwd: root, transcoder: TRANSCODER });
    const manifest = JSON.parse(
      await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
    ) as { entries: Record<string, { output: string } | undefined> };
    const groundEntry = manifest.entries["ground.png"];
    if (groundEntry === undefined) throw new Error("no manifest entry for 'ground.png'");
    const compiled = await readFile(path.join(root, "public", groundEntry.output));

    // 64x64 encodes with every level down to 1x1: log2(64) + 1 = 7.
    expect(readKTX2(compiled).levelCount).toBe(7);
  });

  it("should fall back to ETC1S for an opaque texture without the normal-map convention", async () => {
    const { entry } = await compileOne(
      "threenative-tex-etc1s-",
      "wall.jpg",
      rgbaPng({ green: (y) => y * 8, height: 64, width: 64 }),
    );
    expect(entry.format).toBe("etc1s");
  });

  it("should pick UASTC for the normal-map filename convention on an opaque source", async () => {
    for (const name of ["bricks_normal.png", "detail_nrm.png", "surface-Normal.PNG"]) {
      const { entry } = await compileOne(
        "threenative-tex-normal-",
        name.toLowerCase(),
        rgbaPng({ height: 32, width: 32 }),
      );
      expect(entry.format).toBe("uastc");
    }
  });

  it("should leave sources verbatim when an override selects the none codec", async () => {
    const root = await makeTempDir("threenative-tex-none-override-");
    await mkdir(path.join(root, "assets", "ui"), { recursive: true });
    const source = rgbaPng({ height: 32, width: 32 });
    await writeFile(path.join(root, "assets", "ui/icon.png"), source);
    await compileAssets({
      cwd: root,
      transcoder: TRANSCODER,
      config: { textures: { overrides: [{ codec: "none", glob: "ui/**" }] } },
    });

    const manifest = JSON.parse(
      await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
    ) as { entries: Record<string, { output: string; format?: string } | undefined> };
    const entry = manifest.entries["ui/icon.png"];
    if (entry === undefined) throw new Error("no manifest entry for 'ui/icon.png'");
    expect(entry.format).toBeUndefined();
    expect(entry.output).toMatch(/\.png$/u);
    expect((await readFile(path.join(root, "public", entry.output))).equals(source)).toBe(true);
  });

  it("should reject a source the encoder cannot decode, naming the file", async () => {
    const root = await makeTempDir("threenative-tex-undecodable-");
    await mkdir(path.join(root, "assets"));
    // A .webp source is classified as a texture but has no decoder in this pass yet.
    await writeFile(path.join(root, "assets", "photo.webp"), Buffer.from([0x52, 0x49, 0x46, 0x46]));
    await expect(compileAssets({ cwd: root })).rejects.toThrow(/photo\.webp/u);
  });

  it("should not run on non-texture inputs", async () => {
    const root = await makeTempDir("threenative-tex-passthrough-");
    await mkdir(path.join(root, "assets"));
    const audio = Buffer.from("not really an ogg");
    await writeFile(path.join(root, "assets", "blip.ogg"), audio);
    const result = await texturePass().apply(audio, "blip.ogg");
    expect(result).toBe(audio);
  });

  it("should restore the Basis transcoder after public/ is cleaned", async () => {
    const root = await makeTempDir("threenative-tex-transcoder-regen-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "rock.png"), rgbaPng({ height: 32, width: 32 }));
    await compileAssets({ cwd: root, transcoder: TRANSCODER });
    await rm(path.join(root, "public", "basis"), { recursive: true });

    // Nothing re-encoded this run (same sources), but a served manifest still needs its
    // transcoder, so the copy step restores it.
    const second = await compileAssets({ cwd: root, transcoder: TRANSCODER });
    expect(second.written).toBe(0);
    expect((await stat(path.join(root, "public", "basis", "basis_transcoder.js"))).isFile()).toBe(
      true,
    );
  });
});
