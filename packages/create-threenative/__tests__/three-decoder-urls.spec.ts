import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { createEngineFreshnessPlugin, rewriteDecoderAssetUrls } from "../src/engine-freshness.js";

/**
 * The engine dynamically imports three's `KTX2Loader` and `DRACOLoader`; each carries
 * `new URL('../libs/…', import.meta.url)` defaults that Vite turns into hashed `dist/assets`
 * files nothing ever fetches (core points the loaders at the compile-copied `basis/` and
 * `draco/` folders). The plugin's transform removes those literals before Vite sees them.
 */
const require = createRequire(import.meta.url);
const LOADERS = ["KTX2Loader.js", "DRACOLoader.js"] as const;

const loaderPath = (name: string): string => require.resolve(`three/examples/jsm/loaders/${name}`);
const loaderId = (name: string): string => `/repo/node_modules/three/examples/jsm/loaders/${name}`;

describe("three decoder asset URLs", () => {
  it("removes every new URL decoder literal from three's loaders", () => {
    for (const name of LOADERS) {
      const source = readFileSync(loaderPath(name), "utf8");
      expect(source).toContain("new URL(");
      const result = createEngineFreshnessPlugin().transform(source, loaderId(name));
      expect(result, name).not.toBeNull();
      expect(result?.code, name).not.toContain("new URL(");
      expect(result?.code, name).not.toContain("import.meta.url");
    }
  });

  it("keeps the decoder filenames as plain relative strings", () => {
    const source = readFileSync(loaderPath("DRACOLoader.js"), "utf8");
    const result = createEngineFreshnessPlugin().transform(source, loaderId("DRACOLoader.js"));
    expect(result?.code).toContain('"../libs/draco/draco_wasm_wrapper.js"');
    expect(result?.code).toContain('"../libs/draco/draco_decoder.wasm"');
  });

  it("leaves non-three modules and unanswered transforms untouched", () => {
    const source = 'export const u = new URL("./thing.png", import.meta.url);';
    expect(createEngineFreshnessPlugin().transform(source, "/repo/src/game/x.ts")).toBeNull();
    expect(rewriteDecoderAssetUrls(source)).toBe(source);
  });
});
