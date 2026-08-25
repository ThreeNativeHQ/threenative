import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { loadConfig } from "../src/config.js";

const roots: string[] = [];
const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAXUlEQVR4AaXBQRHEAAgEwclWHGDivIBckIWG3Hf/dD/frz9MdOK2BhedOHEkjsTRG524rcFFJ25rcOJIHImjd2tw0YnbGlx04sSROBJHb3TitgYXnbitwYkjcSSO/o/fGRJxtqYFAAAAAElFTkSuQmCC",
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
  it("parses every group and applies defaults for omitted fields", async () => {
    const root = await project("studio-fox");
    await writeFile(path.join(root, "icon.png"), VALID_PNG);
    await config(
      root,
      `export default {
        app: { id: "com.studio.fox", name: "Fox", version: "1.2.3", build: 7, icon: "icon.png" },
        display: { orientation: "portrait", fullscreen: false, keepScreenOn: true },
        window: { title: "Fox Desktop", width: 1024, height: 576, resizable: false },
        nativeEntry: "src/game.ts",
        renderer: { preferWebGPU: false },
      };`,
    );

    await expect(loadConfig(root)).resolves.toEqual({
      app: { id: "com.studio.fox", name: "Fox", version: "1.2.3", build: 7, icon: "icon.png" },
      display: { orientation: "portrait", fullscreen: false, keepScreenOn: true },
      window: { title: "Fox Desktop", width: 1024, height: 576, resizable: false },
      nativeEntry: "src/game.ts",
      renderer: { preferWebGPU: false },
      ui: { renderer: "native" },
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
      display: { orientation: "landscape", fullscreen: true, keepScreenOn: false },
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
            passes: { dedup: true, prune: false },
            quantize: { positionBits: 14, normalBits: 10, uvBits: 12 },
          },
        },
      };`,
    );
    await expect(loadConfig(configured)).resolves.toMatchObject({
      assets: {
        models: {
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
