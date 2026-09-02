import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { buildFixtureGlb } from "../../../test-support/generate-fixture-model.js";

type AssetsDist = { readonly modelPass: typeof import("../src/index.js").modelPass };

/**
 * The published package must keep its glTF-Transform graph private. `extensions` and
 * `functions` accept a range for `core`; a consumer that also installs a newer CLI can otherwise
 * make those helpers inspect properties from a different `core` instance than the document reader.
 */
describe("packed @threenative/assets", () => {
  it("should bundle glTF-Transform and run the model pass from the packed output", async () => {
    const dist = new URL("../dist/index.js", import.meta.url);
    const source = await readFile(dist, "utf8");

    expect(source).not.toMatch(
      /^\s*import .* from ['"]@gltf-transform\/(?:core|extensions|functions)['"];?$/mu,
    );

    const { modelPass } = (await import(pathToFileURL(dist.pathname).href)) as AssetsDist;
    const result = await modelPass().apply(Buffer.from(await buildFixtureGlb()), "character.glb");

    expect(Buffer.isBuffer(result)).toBe(false);
    if (Buffer.isBuffer(result)) return;
    expect(result.entry?.extensions).toEqual(
      expect.arrayContaining(["EXT_meshopt_compression", "KHR_texture_basisu"]),
    );
  });
});
