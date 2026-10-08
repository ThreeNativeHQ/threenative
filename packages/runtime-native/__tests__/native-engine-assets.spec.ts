import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";

import { NativeEntryKind, readNativePackageManifest } from "../../assets/src/native-package.js";
import { cookNativeEngineAssets } from "../scripts/bundle-native-engine.mjs";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

describe("cookNativeEngineAssets", () => {
  it("cooks the project's assets into the package the native player reads beside its bundle", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "tn-native-engine-assets-"));
    roots.push(project);
    await mkdir(path.join(project, "assets"));
    const image = new PNG({ height: 2, width: 2 });
    image.data.fill(255);
    await writeFile(path.join(project, "assets", "tile.png"), PNG.sync.write(image));
    await writeFile(
      path.join(project, "threenative.config.ts"),
      'export default { assets: { models: "none", textures: "none" } };\n',
    );
    const outfile = path.join(project, "out", "game.js");

    const written = await cookNativeEngineAssets({ outfile, project });

    expect(written).toBe(path.join(project, "out", "native", "assets.tnpk"));
    const manifest = readNativePackageManifest(await readFile(written));
    expect(manifest.entries.map((entry) => [entry.name, entry.kind])).toEqual([
      ["tile.png", NativeEntryKind.Texture],
    ]);
  });
});
