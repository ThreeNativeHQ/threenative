import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFixtureGlb } from "../../../test-support/generate-fixture-model.js";
import { rgbaPng } from "../../../test-support/png.js";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { basisTranscoderPaths } from "../../../test-support/three-basis.js";
import { type IBakeReceipt, compileAssets } from "../src/index.js";

const TRANSCODER = basisTranscoderPaths();
const RECEIPT = "bake.receipt.json";

async function readReceipt(root: string): Promise<IBakeReceipt> {
  return JSON.parse(await readFile(path.join(root, "public", RECEIPT), "utf8")) as IBakeReceipt;
}

/** A pass that ships one auxiliary output beside the model it was handed, like the lightmap pass. */
const lightmapFixture = {
  name: "lightmap-fixture",
  apply: (input: Buffer) => ({
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
};

describe("bake receipt", () => {
  it("should list the compiled output of every source, with the pass that produced it", async () => {
    const root = await makeTempDir("threenative-receipt-basic-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "rock.png"), rgbaPng({ height: 32, width: 32 }));

    const result = await compileAssets({ cwd: root, transcoder: TRANSCODER });
    const receipt = await readReceipt(root);

    expect(receipt.pipelineVersion).toBe(8);
    expect(result.receipt).toEqual(receipt);
    const compiled = receipt.outputs.find((output) => output.source === "rock.png");
    expect(compiled?.path).toMatch(/^rock\.[0-9a-f]{8}\.ktx2$/u);
    expect(compiled?.producer).toBe("ktx2+blender-import+model");
    expect(compiled?.bytes).toBeGreaterThan(0);
  });

  it("should list every auxiliary output a pass produced", async () => {
    const root = await makeTempDir("threenative-receipt-auxiliary-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "level.glb"), Buffer.from(await buildFixtureGlb()));

    await compileAssets({ cwd: root, passes: [lightmapFixture] });
    const receipt = await readReceipt(root);

    const auxiliary = receipt.outputs.find((output) => output.producer === "lightmap");
    expect(auxiliary?.path).toMatch(/^level\.lightmap\.[0-9a-f]{8}\.ktx2$/u);
    expect(auxiliary?.source).toBe("level.glb");
    expect(auxiliary?.bytes).toBe(4);
  });

  it("should list the Basis transcoder it ships beside the compiled textures", async () => {
    const root = await makeTempDir("threenative-receipt-transcoder-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "rock.png"), rgbaPng({ height: 32, width: 32 }));

    await compileAssets({ cwd: root, transcoder: TRANSCODER });
    const receipt = await readReceipt(root);

    expect(receipt.outputs.map((output) => output.path)).toEqual(
      expect.arrayContaining(["basis/basis_transcoder.js", "basis/basis_transcoder.wasm"]),
    );
    for (const output of receipt.outputs.filter((entry) => entry.producer === "basis-transcoder")) {
      expect(output.source).toBeNull();
    }
  });

  it("should still list an output the second build served from cache", async () => {
    const root = await makeTempDir("threenative-receipt-cached-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "rock.png"), rgbaPng({ height: 32, width: 32 }));

    const first = await compileAssets({ cwd: root, transcoder: TRANSCODER });
    const firstReceipt = await readFile(path.join(root, "public", RECEIPT), "utf8");
    const second = await compileAssets({ cwd: root, transcoder: TRANSCODER });

    expect(first.written).toBe(1);
    expect(second.written).toBe(0);
    expect(second.skipped).toBe(1);
    // The point of the whole receipt: a cache hit writes nothing and the file is still this
    // bake's output, so the delete-test must be told to remove it.
    expect(await readFile(path.join(root, "public", RECEIPT), "utf8")).toBe(firstReceipt);
  });

  it("should produce an identical receipt for identical inputs", async () => {
    const first = await makeTempDir("threenative-receipt-determinism-a-");
    const second = await makeTempDir("threenative-receipt-determinism-b-");
    const png = rgbaPng({ height: 32, width: 32 });
    for (const root of [first, second]) {
      await mkdir(path.join(root, "assets"));
      await writeFile(path.join(root, "assets", "rock.png"), png);
      await compileAssets({ cwd: root, transcoder: TRANSCODER });
    }

    expect(await readFile(path.join(first, "public", RECEIPT), "utf8")).toBe(
      await readFile(path.join(second, "public", RECEIPT), "utf8"),
    );
  });

  it("should throw when a pass writes a file under the output root it did not declare", async () => {
    const root = await makeTempDir("threenative-receipt-stray-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "rock.png"), rgbaPng({ height: 32, width: 32 }));

    await expect(
      compileAssets({
        cwd: root,
        transcoder: TRANSCODER,
        passes: [
          {
            name: "stray-writer",
            apply: async (input: Buffer) => {
              await mkdir(path.join(root, "public"), { recursive: true });
              await writeFile(path.join(root, "public", "stray.bin"), "undeclared");
              return input;
            },
          },
        ],
      }),
    ).rejects.toThrow(/TN_ASSETS_UNDECLARED_OUTPUT.*stray\.bin/su);
  });

  it("should leave a static file the project authored alone", async () => {
    const root = await makeTempDir("threenative-receipt-static-");
    await mkdir(path.join(root, "assets"));
    await mkdir(path.join(root, "public"));
    // Written before the bake and never touched by it — a scaffolded project's own icon.
    await writeFile(path.join(root, "public", "icon.png"), rgbaPng({ height: 8, width: 8 }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(path.join(root, "assets", "rock.png"), rgbaPng({ height: 32, width: 32 }));

    await compileAssets({ cwd: root, transcoder: TRANSCODER });
    const receipt = await readReceipt(root);

    expect(receipt.outputs.map((output) => output.path)).not.toContain("icon.png");
  });

  it("should remove a stale receipt rather than leave one describing files nothing produces", async () => {
    const root = await makeTempDir("threenative-receipt-stale-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "rock.png"), rgbaPng({ height: 32, width: 32 }));
    await compileAssets({ cwd: root, transcoder: TRANSCODER });
    expect(await readReceipt(root)).toBeDefined();

    await rm(path.join(root, "assets", "rock.png"));
    await compileAssets({ cwd: root, transcoder: TRANSCODER });

    await expect(readFile(path.join(root, "public", RECEIPT), "utf8")).rejects.toThrow(/ENOENT/u);
  });

  it("should write no receipt at all when there is no source directory", async () => {
    const root = await makeTempDir("threenative-receipt-nosource-");
    const result = await compileAssets({ cwd: root, transcoder: TRANSCODER });

    expect(result.written).toBe(0);
    expect(result.receipt).toBeUndefined();
    await expect(readFile(path.join(root, "public", RECEIPT), "utf8")).rejects.toThrow(/ENOENT/u);
  });
});
