/**
 * PRD-540 phase 1: `engine: "native"` routes a web build's `three`, `three/webgpu` and `three/tsl`
 * imports to the Wasm engine; the legacy build is unchanged.
 */
import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { ownConfigArgs, webBuildDriver } from "../src/build.js";
import { WASM_ENGINE_ENTRY, WEB_ENGINE_ID, createWebEnginePlugin } from "../src/web-engine.js";

const roots: string[] = [];
/** A string only upstream three's own Vector3 carries. */
const UPSTREAM_VECTOR3 = "THREE.Vector3: index is out of range";
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

// three exports no ./package.json; its entry sits in build/.
const THREE = path.resolve(
  path.dirname(createRequire(path.join(import.meta.dirname, "../package.json")).resolve("three")),
  "..",
);

/** A game importing all three upstream entry points, with three and (optionally) the Wasm entry. */
async function project(withWasm: boolean): Promise<string> {
  const root = await makeTempDir("tn-web-engine-");
  roots.push(root);
  await mkdir(path.join(root, "node_modules/@threenative/runtime-native"), { recursive: true });
  await symlink(THREE, path.join(root, "node_modules/three"), "dir");
  const runtime = path.join(root, "node_modules/@threenative/runtime-native");
  await writeFile(path.join(runtime, "package.json"), '{"name":"@threenative/runtime-native"}');
  if (withWasm) {
    await mkdir(path.join(runtime, "wasm"));
    await writeFile(
      path.join(runtime, WASM_ENGINE_ENTRY),
      "export default async function createModule() { return {}; }\n",
    );
  }
  await writeFile(path.join(root, "package.json"), '{"name":"game","type":"module"}');
  await writeFile(
    path.join(root, "index.html"),
    '<script type="module" src="/game.js"></script>\n',
  );
  await writeFile(
    path.join(root, "game.js"),
    [
      'import { Mesh, Vector3 } from "three";',
      'import { WebGPURenderer } from "three/webgpu";',
      'import { pass } from "three/tsl";',
      "globalThis.game = [Mesh, Vector3, WebGPURenderer, pass];",
      "",
    ].join("\n"),
  );
  return root;
}

async function bundle(root: string, native: boolean): Promise<string> {
  await build({
    configFile: false,
    logLevel: "silent",
    root,
    build: { outDir: "dist", minify: false, target: "es2022" },
    plugins: native ? [createWebEnginePlugin(root)] : [],
  });
  const assets = path.join(root, "dist/assets");
  const files = (await readdir(assets)).filter((name) => name.endsWith(".js"));
  return (await Promise.all(files.map((name) => readFile(path.join(assets, name), "utf8")))).join(
    "\n",
  );
}

describe("web build driver", () => {
  it("keeps the legacy driver byte-identical when no engine is set", () => {
    const legacy = [
      'import { defineConfig, loadConfigFromFile, mergeConfig } from "vite";',
      "",
      'const root = "/game";',
      'const assets = "/game/assets-out";',
      "export default defineConfig(async ({ command, mode }) => {",
      "  const own = (await loadConfigFromFile({ command, mode }, undefined, root))?.config ?? {};",
      "  return mergeConfig(own, own.publicDir === undefined ? { publicDir: assets } : {});",
      "});",
      "",
      "",
    ].join("\n");
    expect(webBuildDriver("/game", "/game/assets-out")).toBe(legacy);
    expect(webBuildDriver("/game", "/game/assets-out", "legacy")).toBe(legacy);
    expect(ownConfigArgs([], "/driver.mjs", true)).toEqual([]);
  });

  it("adds the web engine plugin only under engine native, and always uses the driver", () => {
    const native = webBuildDriver("/game", "/game/public", "native");
    expect(native).toContain('import { createWebEnginePlugin } from "create-threenative";');
    expect(native).toContain("plugins: [createWebEnginePlugin(root)],");
    expect(ownConfigArgs([], "/driver.mjs", true, "native")).toEqual(["--config", "/driver.mjs"]);
    expect(() => ownConfigArgs(["--config", "own.ts"], "/driver.mjs", true, "native")).toThrow(
      "TN_WEB_ENGINE_CONFIG_NAMED",
    );
  });
});

describe("createWebEnginePlugin", () => {
  it("resolves the three entry points to the engine and refuses deep upstream imports", () => {
    const plugin = createWebEnginePlugin("/game");
    for (const id of ["three", "three/webgpu", "three/tsl"])
      expect(plugin.resolveId(id)).toBe(WEB_ENGINE_ID);
    expect(plugin.resolveId("three/addons/tsl/display/BloomNode.js")).toBeNull();
    expect(() => plugin.resolveId("three/src/nodes/Nodes.js")).toThrow("TN_NATIVE_UPSTREAM_IMPORT");
  });

  it("fails the build when the Wasm engine is not installed", async () => {
    const root = await project(false);
    await expect(createWebEnginePlugin(root).load(WEB_ENGINE_ID)).rejects.toThrow(
      "TN_WASM_ENGINE_MISSING",
    );
  });

  it("bundles the Wasm engine binding instead of upstream three; legacy still bundles three", async () => {
    const root = await project(true);
    const native = await bundle(root, true);
    expect(native).toContain("is not available on the Wasm engine");
    expect(native).toContain("createModule");
    expect(native).not.toContain(UPSTREAM_VECTOR3);
    await rm(path.join(root, "dist"), { recursive: true });
    const legacy = await bundle(root, false);
    expect(legacy).toContain(UPSTREAM_VECTOR3);
    expect(legacy).not.toContain("is not available on the Wasm engine");
  }, 120_000);
});
