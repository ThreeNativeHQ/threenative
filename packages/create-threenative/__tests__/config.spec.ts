import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileAssets } from "@threenative/assets";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { loadConfig } from "../src/config.js";

const roots: string[] = [];
const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAXUlEQVR4AaXBQRHEAAgEwclWHGDivIBckIWG3Hf/dD/frz9MdOK2BhedOHEkjsTRG524rcFFJ25rcOJIHImjd2tw0YnbGlx04sSROBJHb3TitgYXnbitwYkjcSSO/o/fGRJxtqYFAAAAAElFTkSuQmCC",
  "base64",
);
const TRNS_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAAnRSTlMAAHaTzTgAAAAQSURBVHicY2AYBaNgFMAAAAMQAAE/LCvsAAAAAElFTkSuQmCC",
  "base64",
);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function project(name = "fox-game"): Promise<string> {
  const root = await makeTempDir("threenative-config-");
  roots.push(root);
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src/game.ts"), "export default {};\n");
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name, type: "module", devDependencies: {} }),
  );
  return root;
}

async function config(root: string, source: string): Promise<void> {
  await writeFile(path.join(root, "threenative.config.ts"), `${source}\n`);
}

async function expectActionableFailure(
  root: string,
  code: string,
  layer: string,
  searchedLocation: string,
): Promise<void> {
  let result: Error | undefined;
  try {
    await loadConfig(root);
  } catch (error) {
    result = error instanceof Error ? error : new Error(String(error));
  }
  expect(result).toBeInstanceOf(Error);
  expect(result?.message).toContain(code);
  expect(result?.message).toContain(`${layer} layer failed`);
  expect(result?.message).toContain(searchedLocation);
  expect(result?.message).toContain("Searched:");
  expect(result?.message).toContain("Fix:");
  expect(result?.message).toContain("pnpm exec threenative build --target web");
}

describe("threenative.config.ts", () => {
  it("re-exports the core-owned texture config type", async () => {
    const createSource = await readFile(
      path.resolve("packages/create-threenative/src/config.ts"),
      "utf8",
    );
    const coreSource = await readFile(path.resolve("packages/core/src/config.ts"), "utf8");
    expect(createSource).toMatch(
      /export type \{[^}]*IThreeNativeTexturesConfig[^}]*\} from "@threenative\/core";/su,
    );
    expect(createSource).toContain('import { parsePng } from "@threenative/assets";');
    expect(createSource).not.toMatch(/export interface IThreeNativeTexturesConfig/u);
    expect(createSource).not.toMatch(/const PNG_SIGNATURE =/u);
    expect(coreSource.match(/export interface IThreeNativeTexturesConfig/gu)).toHaveLength(1);
  });

  it("accepts tRNS PNG alpha through the shared parser", async () => {
    const root = await project();
    await writeFile(path.join(root, "foreground.png"), TRNS_PNG);
    await config(
      root,
      'export default { app: { icons: { android: { foreground: "foreground.png" } } } };',
    );

    await expect(loadConfig(root)).resolves.toMatchObject({
      app: { icons: { android: { foreground: "foreground.png" } } },
    });
  });

  it("parses every group and applies defaults for omitted fields", async () => {
    const root = await project("studio-fox");
    await writeFile(path.join(root, "icon.png"), VALID_PNG);
    await config(
      root,
      `export default {
        app: { id: "com.studio.fox", name: "Fox", version: "1.2.3", build: 7, icon: "icon.png" },
        display: { orientation: "portrait", fullscreen: false, keepScreenOn: true, maxFps: 120 },
        window: { title: "Fox Desktop", width: 1024, height: 576, resizable: false },
        nativeEntry: "src/game.ts",
        renderer: { preferWebGPU: false },
      };`,
    );

    await expect(loadConfig(root)).resolves.toEqual({
      app: { id: "com.studio.fox", name: "Fox", version: "1.2.3", build: 7, icon: "icon.png" },
      display: { orientation: "portrait", fullscreen: false, keepScreenOn: true, maxFps: 120 },
      window: { title: "Fox Desktop", width: 1024, height: 576, resizable: false },
      nativeEntry: "src/game.ts",
      renderer: { preferWebGPU: false },
      ui: { renderer: "native" },
    });
  });

  it("preserves renderer resolution scale and the Android override", async () => {
    const root = await project();
    await config(
      root,
      `export default {
        renderer: { resolutionScale: 0.75, android: { resolutionScale: 0.32 } },
      };`,
    );

    await expect(loadConfig(root)).resolves.toMatchObject({
      renderer: {
        preferWebGPU: true,
        resolutionScale: 0.75,
        android: { resolutionScale: 0.32 },
      },
    });
  });

  it("uses package name defaults and the nativeEntry compatibility fallback without a config file", async () => {
    const root = await project("@studio/fox-game");
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "@studio/fox-game", threenative: { nativeEntry: "src/game.ts" } }),
    );

    await expect(loadConfig(root)).resolves.toMatchObject({
      app: { id: "com.threenative.foxgame", name: "fox-game", version: "0.1.13", build: 1 },
      display: { orientation: "landscape", fullscreen: true, keepScreenOn: false, maxFps: 60 },
      window: { title: "fox-game", width: 1280, height: 720, resizable: true },
      nativeEntry: "src/game.ts",
      renderer: { preferWebGPU: true },
      ui: { renderer: "native" },
    });
  });

  it("uses the Vite-owned esbuild without invoking Vite's config loader", async () => {
    const root = await project();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "fox-game", type: "module", devDependencies: { vite: "8.2.0" } }),
    );
    await mkdir(path.join(root, "node_modules/vite/dist/node"), { recursive: true });
    await writeFile(
      path.join(root, "node_modules/vite/package.json"),
      JSON.stringify({
        name: "vite",
        type: "module",
        exports: { ".": "./dist/node/index.js" },
      }),
    );
    await writeFile(
      path.join(root, "node_modules/vite/dist/node/index.js"),
      `export async function loadConfigFromFile() {
  throw new Error("Vite's config loader must not run");
}
`,
    );
    await config(root, "export default { renderer: { preferWebGPU: true } }; ");

    await expect(loadConfig(root)).resolves.toMatchObject({
      renderer: { preferWebGPU: true },
    });
  });

  it("rejects a package without a name with the named code", async () => {
    const root = await project();
    await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_PACKAGE_NAME_MISSING/u);
  });

  it("rejects malformed package metadata with the named code", async () => {
    const root = await project();
    await writeFile(path.join(root, "package.json"), "{\n");
    await expectActionableFailure(
      root,
      "TN_CONFIG_PACKAGE_INVALID",
      "package manifest",
      path.join(root, "package.json"),
    );
  });

  it("rejects a non-object package compatibility block with the named code", async () => {
    const root = await project();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "fox-game", threenative: "legacy" }),
    );
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_PACKAGE_INVALID/u);
  });

  it("resolves every declared brand variant and boot splash asset", async () => {
    const root = await project();
    for (const file of [
      "icon.png",
      "foreground.png",
      "monochrome.png",
      "dark.png",
      "tinted.png",
      "maskable.png",
      "apple.png",
      "launch.png",
    ])
      await writeFile(path.join(root, file), VALID_PNG);
    await writeFile(path.join(root, "favicon.svg"), '<svg xmlns="http://www.w3.org/2000/svg" />\n');
    await config(
      root,
      `export default {
        app: {
          icon: "icon.png",
          icons: {
            android: { foreground: "foreground.png", background: "#111827", monochrome: "monochrome.png" },
            ios: { dark: "dark.png", tinted: "tinted.png" },
            web: { favicon: "favicon.svg", maskable: "maskable.png", monochrome: "monochrome.png", appleTouch: "apple.png" },
          },
        },
        bootSplash: { backgroundColor: "#0d1b2a", image: "launch.png" },
      };`,
    );
    await expect(loadConfig(root)).resolves.toMatchObject({
      app: {
        icon: "icon.png",
        icons: {
          android: {
            foreground: "foreground.png",
            background: "#111827",
            monochrome: "monochrome.png",
          },
          ios: { dark: "dark.png", tinted: "tinted.png" },
          web: {
            favicon: "favicon.svg",
            maskable: "maskable.png",
            monochrome: "monochrome.png",
            appleTouch: "apple.png",
          },
        },
      },
      bootSplash: { backgroundColor: "#0d1b2a", image: "launch.png" },
    });
  });

  it("rejects a declared brand variant with its path and stable code", async () => {
    const root = await project();
    await config(
      root,
      `export default { app: { icons: { android: { foreground: "missing-foreground.png" } } } };`,
    );
    await expectActionableFailure(
      root,
      "TN_CONFIG_BRAND_ANDROID_FOREGROUND_MISSING",
      "config validation",
      path.join(root, "threenative.config.ts"),
    );
    await expect(loadConfig(root)).rejects.toThrow(/missing-foreground\.png/u);
  });

  it("rejects a reintroduced loading group as an unknown config key", async () => {
    const root = await project();
    await config(root, 'export default { loading: { progressColor: "#ffffff" } };');
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_UNKNOWN_KEY/u);
  });

  it("parses the assets group and omits it from resolved configs that do not declare it", async () => {
    const configured = await project();
    await config(configured, 'export default { assets: { source: "art", output: "web" } };');
    const resolved = await loadConfig(configured);
    expect(resolved.assets).toEqual({ output: "web", source: "art" });

    const bare = await project();
    expect((await loadConfig(bare)).assets).toBeUndefined();
  });

  it("parses declared asset targets into the resolved config", async () => {
    const root = await project();
    await config(
      root,
      `export default { assets: { source: "art", targets: { maxTriangles: 100000, maxTextureDimension: 2048 } } };`,
    );
    await expect(loadConfig(root)).resolves.toMatchObject({
      assets: {
        source: "art",
        targets: { maxTriangles: 100000, maxTextureDimension: 2048 },
      },
    });
  });

  it("rejects an unknown key under the assets group with the named code", async () => {
    const root = await project();
    await config(root, "export default { assets: { bogus: true } };");
    await expectActionableFailure(
      root,
      "TN_CONFIG_UNKNOWN_KEY",
      "config validation",
      path.join(root, "threenative.config.ts"),
    );
  });

  it("rejects an unknown key under assets.targets with the named code", async () => {
    const root = await project();
    await config(root, "export default { assets: { targets: { bogus: 1 } } };");
    await expect(loadConfig(root)).rejects.toThrow(/assets\.targets\.bogus/u);
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_UNKNOWN_KEY/u);
  });

  it("parses the textures block and the none shorthand into the resolved config", async () => {
    const configured = await project();
    await config(
      configured,
      `export default {
        assets: {
          textures: {
            quality: 200,
            overrides: [{ glob: "**/*_nrm.png", codec: "uastc" }, { glob: "ui/**", codec: "none" }],
          },
        },
      };`,
    );
    await expect(loadConfig(configured)).resolves.toMatchObject({
      assets: {
        textures: {
          quality: 200,
          overrides: [
            { codec: "uastc", glob: "**/*_nrm.png" },
            { codec: "none", glob: "ui/**" },
          ],
        },
      },
    });

    const disabled = await project();
    await config(disabled, `export default { assets: { textures: "none" } };`);
    expect((await loadConfig(disabled)).assets).toEqual({ textures: "none" });
  });

  it("rejects an unknown texture codec with the named code", async () => {
    const root = await project();
    // The negative control for ledger row 4: an unknown codec name must fail config load.
    await config(
      root,
      `export default { assets: { textures: { overrides: [{ glob: "**/*.png", codec: "supercompressed" }] } } };`,
    );
    await expectActionableFailure(
      root,
      "TN_CONFIG_ASSETS_INVALID",
      "config validation",
      path.join(root, "threenative.config.ts"),
    );
    await expect(loadConfig(root)).rejects.toThrow(/supercompressed/u);
  });

  it("rejects a bad texture quality with the named code", async () => {
    const root = await project();
    await config(root, "export default { assets: { textures: { quality: 900 } } };");
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_ASSETS_INVALID/u);
    await expect(loadConfig(root)).rejects.toThrow(/between 1 and 255/u);
  });

  it("parses the models block and the none shorthand into the resolved config", async () => {
    const configured = await project();
    await config(
      configured,
      `export default {
        assets: {
          models: {
            lightmap: { atlasSize: 64, padding: 2 },
            passes: { dedup: true, prune: false },
            quantize: { positionBits: 14, normalBits: 10, uvBits: 12 },
          },
        },
      };`,
    );
    await expect(loadConfig(configured)).resolves.toMatchObject({
      assets: {
        models: {
          lightmap: { atlasSize: 64, padding: 2 },
          passes: { dedup: true, prune: false },
          quantize: { normalBits: 10, positionBits: 14, uvBits: 12 },
        },
      },
    });

    const disabled = await project();
    await config(disabled, `export default { assets: { models: "none" } };`);
    expect((await loadConfig(disabled)).assets).toEqual({ models: "none" });
  });

  it("rejects an unknown model pass name with the named code", async () => {
    const root = await project();
    // The negative control for ledger row 4: an unknown sub-pass must fail config load,
    // never run silently.
    await config(root, "export default { assets: { models: { passes: { decimate: true } } } };");
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_UNKNOWN_KEY/u);
    await expect(loadConfig(root)).rejects.toThrow(/assets\.models\.passes\.decimate/u);
  });

  it("rejects an unknown key under assets.models with the named code", async () => {
    const root = await project();
    await config(root, "export default { assets: { models: { bogus: 1 } } };");
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_UNKNOWN_KEY/u);
    await expect(loadConfig(root)).rejects.toThrow(/assets\.models\.bogus/u);
  });

  it("carries the virtual-geometry bake through to the resolved config", async () => {
    const root = await project();
    await config(
      root,
      `export default {
        assets: {
          models: {
            virtual: { groupSize: 4, minSourceTriangles: 8192, simplifyRatio: 0.5 },
          },
        },
      };`,
    );
    await expect(loadConfig(root)).resolves.toMatchObject({
      assets: {
        models: { virtual: { groupSize: 4, minSourceTriangles: 8192, simplifyRatio: 0.5 } },
      },
    });
  });

  it("carries the virtual-geometry opt-out through to the resolved config", async () => {
    // Virtual geometry bakes by default; `"none"` is how a project that does not want the payload
    // says so, on the same terms as `textures: "none"`.
    const root = await project();
    await config(root, 'export default { assets: { models: { virtual: "none" } } };');
    await expect(loadConfig(root)).resolves.toMatchObject({
      assets: { models: { virtual: "none" } },
    });
  });

  /**
   * The seam, not either side of it. `loadConfig` validated `assets.models.virtual` and
   * `compileAssets` — the only consumer, called by `threenative build` with exactly this object —
   * did not list the key at all, so every game that wrote the documented override died at
   * `TN_ASSETS_CONFIG_UNKNOWN_KEY` before an asset compiled. Both sides were green the whole
   * time. This test hands one to the other.
   */
  it("hands every resolved assets key to the pipeline that receives it", async () => {
    const root = await project();
    await config(
      root,
      `export default {
        assets: {
          models: {
            virtual: { groupSize: 4, minSourceTriangles: 8192, simplifyRatio: 0.5 },
          },
        },
      };`,
    );
    const resolved = await loadConfig(root);

    // No assets/ directory, so the pipeline returns early — but only after it has parsed the
    // config, which is the step that used to throw.
    await expect(compileAssets({ config: resolved.assets, cwd: root })).resolves.toEqual({
      skipped: 0,
      written: 0,
    });
  });

  it("rejects an unknown key under assets.models.virtual with the named code", async () => {
    const root = await project();
    await config(root, "export default { assets: { models: { virtual: { ratio: 0.5 } } } };");
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_UNKNOWN_KEY/u);
    await expect(loadConfig(root)).rejects.toThrow(/assets\.models\.virtual\.ratio/u);
  });

  it("rejects a simplify ratio outside the open unit interval with the named code", async () => {
    const root = await project();
    await config(root, "export default { assets: { models: { virtual: { simplifyRatio: 1 } } } };");
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_ASSETS_INVALID/u);
    await expect(loadConfig(root)).rejects.toThrow(/between 0 and 1, exclusive/u);
  });

  it("rejects an out-of-range quantize depth with the named code", async () => {
    const root = await project();
    await config(root, "export default { assets: { models: { quantize: { positionBits: 0 } } } };");
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_ASSETS_INVALID/u);
    await expect(loadConfig(root)).rejects.toThrow(/between 1 and 16 bits/u);
  });

  it("rejects bad orientation with the named code", async () => {
    const root = await project();
    await config(root, 'export default { display: { orientation: "sideways" } };');
    await expect(loadConfig(root)).rejects.toThrow(/TN_NATIVE_ORIENTATION_INVALID/u);
  });

  it.each([-1, 60.5, 1001, "120"])(
    "rejects invalid display.maxFps %j with the named code",
    async (maxFps) => {
      const root = await project();
      await config(root, `export default { display: { maxFps: ${JSON.stringify(maxFps)} } };`);
      await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_MAX_FPS_INVALID/u);
    },
  );

  it("rejects bad app ids with the named code", async () => {
    const root = await project();
    await config(root, 'export default { app: { id: "Fox Game" } };');
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_APP_ID_INVALID/u);
  });

  it("rejects an underscore app id that Android might otherwise accept", async () => {
    const root = await project();
    await config(root, 'export default { app: { id: "com.studio_fox.game" } };');
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_APP_ID_INVALID/u);
  });

  it("rejects an invalid app name with the named code", async () => {
    const root = await project();
    await config(root, "export default { app: { name: 42 } };");
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_APP_NAME_INVALID/u);
  });

  it("rejects an invalid app version with the named code", async () => {
    const root = await project();
    await config(root, 'export default { app: { version: "v1" } };');
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_APP_VERSION_INVALID/u);
  });

  it("rejects a prerelease app version with the named code", async () => {
    const root = await project();
    await config(root, 'export default { app: { version: "1.2.3-beta" } };');
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_APP_VERSION_INVALID/u);
  });

  it("rejects an invalid app build with the named code", async () => {
    const root = await project();
    await config(root, "export default { app: { build: 0 } };");
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_APP_BUILD_INVALID/u);
  });

  it("rejects a non-PNG icon with the named code", async () => {
    const root = await project();
    await config(root, 'export default { app: { icon: "icon.jpg" } };');
    await expectActionableFailure(
      root,
      "TN_CONFIG_ICON_INVALID",
      "config validation",
      path.join(root, "threenative.config.ts"),
    );
  });

  it("rejects corrupt PNG content with the named code", async () => {
    const root = await project();
    const corruptPng = Buffer.from(VALID_PNG);
    corruptPng.writeUInt8(corruptPng.readUInt8(41) ^ 0xff, 41);
    await writeFile(path.join(root, "icon.png"), corruptPng);
    await config(root, 'export default { app: { icon: "icon.png" } };');
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_ICON_INVALID/u);
  });

  it("rejects a missing icon instead of silently using the platform default", async () => {
    const root = await project();
    await config(root, 'export default { app: { icon: "missing.png" } };');
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_ICON_MISSING/u);
  });

  it("rejects a config/package native-entry conflict", async () => {
    const root = await project();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "fox-game", threenative: { nativeEntry: "src/game.ts" } }),
    );
    await config(root, 'export default { nativeEntry: "src/game.ts" };');
    await expectActionableFailure(
      root,
      "TN_CONFIG_CONFLICT",
      "config validation",
      path.join(root, "threenative.config.ts"),
    );
  });

  it("rejects a native entry outside the project with the named code", async () => {
    const root = await project();
    await config(root, 'export default { nativeEntry: "../game.ts" };');
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_NATIVE_ENTRY_INVALID/u);
  });

  it("rejects an empty native entry with the named code", async () => {
    const root = await project();
    await config(root, 'export default { nativeEntry: "" };');
    await expect(loadConfig(root)).rejects.toThrow(/TN_NATIVE_ENTRY_MISSING/u);
  });

  it("rejects a malformed group with the named code", async () => {
    const root = await project();
    await config(root, "export default { display: false };");
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_GROUP_INVALID/u);
  });

  it("rejects an unknown config key with the named code", async () => {
    const root = await project();
    await config(root, "export default { plugins: {} };");
    await expectActionableFailure(
      root,
      "TN_CONFIG_UNKNOWN_KEY",
      "config validation",
      path.join(root, "threenative.config.ts"),
    );
  });

  it("rejects an invalid fullscreen value with the named code", async () => {
    const root = await project();
    await config(root, 'export default { display: { fullscreen: "yes" } };');
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_FULLSCREEN_INVALID/u);
  });

  it("rejects an invalid keep-screen-on value with the named code", async () => {
    const root = await project();
    await config(root, 'export default { display: { keepScreenOn: "yes" } };');
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_KEEP_SCREEN_ON_INVALID/u);
  });

  it("rejects an invalid window title with the named code", async () => {
    const root = await project();
    await config(root, "export default { window: { title: 42 } };");
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_WINDOW_TITLE_INVALID/u);
  });

  it("rejects an invalid window width with the named code", async () => {
    const root = await project();
    await config(root, "export default { window: { width: 0 } };");
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_WINDOW_WIDTH_INVALID/u);
  });

  it("rejects an invalid window height with the named code", async () => {
    const root = await project();
    await config(root, "export default { window: { height: 1.5 } };");
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_WINDOW_HEIGHT_INVALID/u);
  });

  it("rejects an invalid resizable value with the named code", async () => {
    const root = await project();
    await config(root, 'export default { window: { resizable: "yes" } };');
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_WINDOW_RESIZABLE_INVALID/u);
  });

  it("rejects an invalid renderer value with the named code", async () => {
    const root = await project();
    await config(root, 'export default { renderer: { preferWebGPU: "yes" } };');
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_RENDERER_INVALID/u);
  });

  it.each([
    "export default { renderer: { resolutionScale: 0 } };",
    'export default { renderer: { android: { resolutionScale: "small" } } };',
    // Above one is a drawing buffer larger than the surface, which the engine refuses; the
    // scaffold has to refuse it in the same place, or a game learns the rule from a crash.
    "export default { renderer: { resolutionScale: 1.5 } };",
    "export default { renderer: { android: { resolutionScale: 2 } } };",
  ])("rejects an invalid renderer resolution scale with the named code", async (source) => {
    const root = await project();
    await config(root, source);
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_RENDERER_RESOLUTION_SCALE_INVALID/u);
  });

  it('accepts the shipped "auto" scale and the Android sampling override', async () => {
    // The templates ship `resolutionScale: "auto"`. A scaffold validator that rejects what the
    // templates ship fails every generated project on its first command.
    const root = await project();
    await config(
      root,
      'export default { renderer: { resolutionScale: "auto", antialias: true,' +
        " android: { resolutionScale: 0.44, antialias: false } } };",
    );
    const loaded = await loadConfig(root);
    expect(loaded.renderer).toEqual({
      android: { antialias: false, resolutionScale: 0.44 },
      antialias: true,
      preferWebGPU: true,
      resolutionScale: "auto",
    });
  });

  it("rejects a config with no default export object", async () => {
    const root = await project();
    await config(root, "export const game = {}; ");
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_DEFAULT_MISSING/u);
  });

  it("rejects a config that cannot be transpiled", async () => {
    const root = await project();
    await config(root, "export default { ; ");
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_TRANSPILE_FAILED/u);
  });

  it("rejects a config that fails while loading", async () => {
    const root = await project();
    await config(root, 'throw new Error("config failed");');
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_LOAD_FAILED/u);
  });

  it("keeps loading provenance tied to the config source, not an embedded error-code prefix", async () => {
    const root = await project();
    await config(root, 'throw new Error("TN_CONFIG_PACKAGE_INVALID: config-owned failure");');
    await expectActionableFailure(
      root,
      "TN_CONFIG_LOAD_FAILED",
      "config loading",
      path.join(root, "threenative.config.ts"),
    );
    let message = "";
    try {
      await loadConfig(root);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain("package manifest layer failed");
  });

  it("rejects a second package.json config surface", async () => {
    const root = await project();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "fox-game", threenative: { orientation: "portrait" } }),
    );
    await expect(loadConfig(root)).rejects.toThrow(/TN_CONFIG_UNKNOWN_KEY/u);
  });

  it("cleans the transpiled temporary module after loading", async () => {
    const root = await project();
    await config(root, "export default {}; ");
    await loadConfig(root);
    const files = await readdir(root);
    expect(files.some((file) => /^\\.threenative\\.config\\./u.test(file))).toBe(false);
  });
});
