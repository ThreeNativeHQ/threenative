/**
 * The packagers copy everything except provable junk.
 *
 * Copying only what the build named broke real games: `public/` holds hand-placed runtime files
 * the manifest never names (Ogg audio, GLBs, the Basis transcoder), and dropping them breaks play.
 * This proves the selector skips only editor leftovers and superseded digest outputs, keeps a
 * digest-shaped file whose stem is unnamed, prints every skip, and still fails closed when a
 * manifest-named file is gone.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";

// @ts-expect-error -- plain ESM with no type declarations.
import { selectManifestAssets } from "../scripts/asset-manifest.mjs";
// @ts-expect-error -- plain ESM with no type declarations.
import { stageAndroidAssets } from "../scripts/package-android.mjs";
// @ts-expect-error -- plain ESM with no type declarations.
import { stageDesktopFiles } from "../scripts/package-desktop.mjs";
// @ts-expect-error -- plain ESM with no type declarations.
import { minimalGlb } from "../tests/fixtures/minimal-glb.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
  vi.restoreAllMocks();
});

function fixture() {
  const root = makeTempDirSync("threenative-manifest-assets-");
  roots.push(root);
  const assets = join(root, "public");
  mkdirSync(join(assets, "hand"), { recursive: true });
  writeFileSync(join(assets, "a.1234abcd.png"), "png");
  writeFileSync(join(assets, "a.99999999.png"), "old");
  writeFileSync(join(assets, "c.deadbeef.png"), "hand-placed");
  writeFileSync(join(assets, "hand", "level.json"), "{}");
  writeFileSync(join(assets, "b.glb"), minimalGlb());
  writeFileSync(join(assets, "a.png.orig"), "stray");
  writeFileSync(join(assets, ".DS_Store"), "junk");
  writeFileSync(
    join(assets, "assets.manifest.json"),
    JSON.stringify({
      version: 1,
      entries: {
        "a.png": { output: "a.1234abcd.png", kind: "texture" },
        "b.glb": { output: "b.glb", kind: "model" },
      },
    }),
  );
  return { assets, root };
}

describe("the asset selector copies everything except provable junk", () => {
  it("copies the named and hand-placed files, skipping and printing the junk", () => {
    const { assets } = fixture();
    const lines: string[] = [];
    const selected = selectManifestAssets(assets, { log: (line: string) => lines.push(line) });
    assert.deepEqual(selected, [
      "a.1234abcd.png",
      "assets.manifest.json",
      "b.glb",
      "c.deadbeef.png",
      "hand/level.json",
    ]);
    assert.deepEqual(lines, [
      "ThreeNative packaging: skipped .DS_Store (editor leftover)",
      "ThreeNative packaging: skipped a.99999999.png (superseded by a.1234abcd.png)",
      "ThreeNative packaging: skipped a.png.orig (editor leftover)",
    ]);
  });

  it("fails closed when a named file is missing from disk", () => {
    const { assets } = fixture();
    rmSync(join(assets, "b.glb"));
    expect(() => selectManifestAssets(assets, { log: () => {} })).toThrow(
      /TN_ASSETS_MANIFEST_MISSING/u,
    );
    expect(() => selectManifestAssets(assets, { log: () => {} })).toThrow(/b\.glb/u);
  });

  it("without a manifest skips only the editor junk and keeps digest-shaped files", () => {
    const root = makeTempDirSync("threenative-manifest-assets-bare-");
    roots.push(root);
    const assets = join(root, "public");
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(assets, "a.99999999.png"), "digest-shaped");
    writeFileSync(join(assets, "b.glb"), minimalGlb());
    writeFileSync(join(assets, "x.png.orig"), "stray");
    writeFileSync(join(assets, ".DS_Store"), "junk");
    const lines: string[] = [];
    const selected = selectManifestAssets(assets, { log: (line: string) => lines.push(line) });
    assert.deepEqual(selected, ["a.99999999.png", "b.glb"]);
    assert.deepEqual(lines, [
      "ThreeNative packaging: skipped .DS_Store (editor leftover)",
      "ThreeNative packaging: skipped x.png.orig (editor leftover)",
    ]);
  });

  it("Android staging copies the kept set and prints the skips", () => {
    const { assets, root } = fixture();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const copied = stageAndroidAssets(assets, join(root, "game"));
    assert.deepEqual(copied, [
      "a.1234abcd.png",
      "assets.manifest.json",
      "b.glb",
      "c.deadbeef.png",
      "hand/level.json",
    ]);
    assert.equal(existsSync(join(root, "game", "hand", "level.json")), true);
    assert.equal(existsSync(join(root, "game", "a.99999999.png")), false);
    assert.equal(existsSync(join(root, "game", "a.png.orig")), false);
    assert.equal(existsSync(join(root, "game", ".DS_Store")), false);
    assert.ok(
      spy.mock.calls.some(([line]) =>
        String(line).includes("skipped a.png.orig (editor leftover)"),
      ),
      "the stray path must be printed",
    );
  });

  it("desktop staging copies the kept set and prints the skips", () => {
    const { assets, root } = fixture();
    const bundle = join(root, "bundle.js");
    writeFileSync(bundle, "export default 1;");
    const staging = join(root, "staging");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    stageDesktopFiles(bundle, assets, staging);
    assert.equal(existsSync(join(staging, "a.1234abcd.png")), true);
    assert.equal(existsSync(join(staging, "assets.manifest.json")), true);
    assert.equal(existsSync(join(staging, "b.glb")), true);
    assert.equal(existsSync(join(staging, "c.deadbeef.png")), true);
    assert.equal(existsSync(join(staging, "hand", "level.json")), true);
    assert.equal(existsSync(join(staging, "a.99999999.png")), false);
    assert.equal(existsSync(join(staging, "a.png.orig")), false);
    assert.ok(
      spy.mock.calls.some(([line]) =>
        String(line).includes("skipped a.png.orig (editor leftover)"),
      ),
      "the stray path must be printed",
    );
  });
});
