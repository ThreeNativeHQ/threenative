import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import { compareSides, parityExitCode, readParitySide } from "../asset-parity.js";

async function makeSide(root: string, digest: string): Promise<string> {
  const dir = path.join(root, "public");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "assets.manifest.json"),
    JSON.stringify({
      version: 1,
      entries: {
        "rock.png": { output: `rock.${digest}.ktx2`, kind: "texture", bytes: 4, passes: ["ktx2"] },
      },
    }),
  );
  await writeFile(path.join(dir, `rock.${digest}.ktx2`), digest === "aaaaaaaa" ? "AAAA" : "BBBB");
  return dir;
}

describe("asset parity", () => {
  it("should fail when one side's artifact differs by a byte", async () => {
    const root = await makeTempDir("tn-parity-drift-");
    // Same logical asset, same manifest shape, one differing content byte.
    const web = await makeSide(path.join(root, "web"), "aaaaaaaa");
    const native = await makeSide(path.join(root, "native"), "aaaaaaaa");
    await writeFile(path.join(native, "rock.aaaaaaaa.ktx2"), "BBBC");

    const [left, right] = await Promise.all([readParitySide(web), readParitySide(native)]);
    expect(parityExitCode([left, right])).toBe(0);
    const result = await compareSides(left, right);
    expect(result.compared).toBe(1);
    expect(result.mismatches[0]).toContain("hashes differ");
  });

  it("should exit 2 when a side lists no assets", async () => {
    const root = await makeTempDir("tn-parity-empty-");
    const dir = path.join(root, "public");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "assets.manifest.json"),
      JSON.stringify({ version: 1, entries: {} }),
    );
    const empty = await readParitySide(dir);

    expect(parityExitCode([empty])).toBe(2);
    await expect(readParitySide(path.join(root, "missing"))).rejects.toThrow(
      /TN_ASSET_PARITY_MANIFEST_UNREADABLE/u,
    );
  });

  it("should pass when both sides are byte-identical", async () => {
    const root = await makeTempDir("tn-parity-ok-");
    const web = await makeSide(path.join(root, "web"), "aaaaaaaa");
    const native = await makeSide(path.join(root, "native"), "aaaaaaaa");
    const [left, right] = await Promise.all([readParitySide(web), readParitySide(native)]);
    const result = await compareSides(left, right);
    expect(result.mismatches).toEqual([]);
  });
});
