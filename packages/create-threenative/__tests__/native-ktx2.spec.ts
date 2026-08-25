import { execFile } from "node:child_process";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { assertNativeAssetsCompatible, assertNativeBundleCompatible, build } from "../src/build.js";
import { loadConfig } from "../src/config.js";

const run = promisify(execFile);
const roots: string[] = [];
const bundler = path.resolve("packages/runtime-native/scripts/bundle.mjs");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

/**
 * A project laid out the way a scaffolded game is: its own `package.json`, the pinned Vite the
 * native bundler requires, and `@threenative/core` installed under `node_modules`.
 */
async function gameProject(prefix: string): Promise<string> {
  const project = await makeTempDir(prefix);
  roots.push(project);
  await mkdir(path.join(project, "src"), { recursive: true });
  await mkdir(path.join(project, "node_modules/@threenative"), { recursive: true });
  await symlink(path.resolve("node_modules/vite"), path.join(project, "node_modules/vite"));
  await symlink(
    path.resolve("packages/core"),
    path.join(project, "node_modules/@threenative/core"),
  );
  await writeFile(path.join(project, "package.json"), '{"name":"ktx2-proof","type":"module"}\n');
  await writeFile(
    path.join(project, "src/game.ts"),
    `import { defineGame } from "@threenative/core";
export default defineGame({ scenes: {} });
`,
  );
  return project;
}

async function bundle(project: string, target: "android" | "desktop" | "ios"): Promise<string> {
  const output = path.join(project, `dist/${target}.js`);
  await run(
    process.execPath,
    [
      bundler,
      "--project",
      project,
      "--entry",
      "src/game.ts",
      "--target",
      target,
      "--output",
      output,
    ],
    { cwd: project },
  );
  return output;
}

/** A plain web bundle of the project, built by the project's own Vite. */
const WEB_BUILD_SCRIPT = `import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const { build } = await import(
  pathToFileURL(createRequire(\`\${process.cwd()}/package.json\`).resolve("vite")).href
);
await build({
  build: {
    emptyOutDir: false,
    lib: { entry: "src/game.ts", fileName: () => "web.js", formats: ["es"] },
    minify: false,
    outDir: "dist-web",
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  configFile: false,
  logLevel: "silent",
  root: process.cwd(),
});
`;

/** Writes a compiled-asset manifest of the shape `@threenative/assets` emits. */
async function writeManifest(
  project: string,
  entries: Record<string, Record<string, unknown>>,
): Promise<void> {
  await mkdir(path.join(project, "public"), { recursive: true });
  await writeFile(
    path.join(project, "public/assets.manifest.json"),
    `${JSON.stringify({ entries, version: 1 }, null, 2)}\n`,
  );
}

describe("compressed assets on native targets", () => {
  it("bundles a game that ships no compressed asset for mobile without WASM", async () => {
    const project = await gameProject("threenative-ktx2-mobile-");

    for (const target of ["android", "ios"] as const) {
      const output = await bundle(project, target);
      const source = await readFile(output, "utf8");
      await expect(assertNativeBundleCompatible(output, target)).resolves.toBeUndefined();
      expect(source, `${target} bundle must not carry a WASM decoder`).not.toMatch(
        /\bWebAssembly\b/u,
      );
      expect(source).toContain("TN_NATIVE_KTX2_UNSUPPORTED");
      expect(source).toContain("TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED");
    }
  }, 180_000);

  it("keeps three's real decoders on desktop, which has a WASM engine", async () => {
    const project = await gameProject("threenative-ktx2-desktop-");

    const output = await bundle(project, "desktop");
    const source = await readFile(output, "utf8");
    await expect(assertNativeBundleCompatible(output, "desktop")).resolves.toBeUndefined();
    expect(source).toMatch(/\bWebAssembly\b/u);
    expect(source).not.toContain("TN_NATIVE_KTX2_UNSUPPORTED");
  }, 180_000);

  it("still fails TN_NATIVE_WASM_ON_MOBILE when the game itself reaches WASM", async () => {
    const project = await gameProject("threenative-wasm-guard-");
    await writeFile(
      path.join(project, "src/wasm.ts"),
      `const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
export const compiled = (): Promise<unknown> => WebAssembly.compile(bytes);
`,
    );
    await writeFile(
      path.join(project, "src/game.ts"),
      `import { defineGame } from "@threenative/core";
import { compiled } from "./wasm.js";
console.info(compiled);
export default defineGame({ scenes: {} });
`,
    );

    const output = await bundle(project, "android");
    expect(await readFile(output, "utf8")).toMatch(/\bWebAssembly\b/u);
    await expect(assertNativeBundleCompatible(output, "android")).rejects.toThrow(
      /TN_NATIVE_WASM_ON_MOBILE/u,
    );
  }, 180_000);

  it("refuses a mobile build whose compiled assets include KTX2, by name", async () => {
    const project = await gameProject("threenative-ktx2-refusal-");
    await writeManifest(project, {
      "textures/rock.png": {
        bytes: 4096,
        kind: "texture",
        output: "textures/rock.a1b2c3d4.ktx2",
        passes: ["ktx2"],
      },
    });

    await expect(build({ cwd: project, target: "android" })).rejects.toThrow(
      /TN_NATIVE_KTX2_UNSUPPORTED: android cannot ship compiled KTX2 textures \(textures\/rock\.png\)/u,
    );
    // The refusal must land before anything is written, not after an APK exists.
    await expect(readFile(path.join(project, ".threenative/build/game.js"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  }, 60_000);

  it("refuses a mobile build whose compiled models carry compressed geometry, by name", async () => {
    const project = await gameProject("threenative-meshopt-refusal-");
    await writeManifest(project, {
      "models/hero.glb": {
        bytes: 2048,
        extensions: ["EXT_meshopt_compression"],
        kind: "model",
        output: "models/hero.a1b2c3d4.glb",
        passes: ["models"],
      },
    });

    await expect(build({ cwd: project, target: "ios" })).rejects.toThrow(
      /TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED: ios cannot ship compressed model geometry \(models\/hero\.glb\)/u,
    );
  }, 60_000);

  it("accepts the same compiled assets on desktop and on web", async () => {
    const project = await gameProject("threenative-ktx2-desktop-assets-");
    await writeManifest(project, {
      "models/hero.glb": {
        extensions: ["EXT_meshopt_compression"],
        kind: "model",
        output: "models/hero.a1b2c3d4.glb",
      },
      "textures/rock.png": { kind: "texture", output: "textures/rock.a1b2c3d4.ktx2" },
    });
    const config = await loadConfig(project);

    for (const target of ["desktop", "web"] as const) {
      await expect(assertNativeAssetsCompatible(project, target, config)).resolves.toBeUndefined();
    }
  }, 60_000);

  it("fails closed on a manifest it cannot read", async () => {
    const project = await gameProject("threenative-manifest-closed-");
    await mkdir(path.join(project, "public"), { recursive: true });
    await writeFile(path.join(project, "public/assets.manifest.json"), "{not json");
    const config = await loadConfig(project);

    await expect(assertNativeAssetsCompatible(project, "android", config)).rejects.toThrow(
      /TN_NATIVE_ASSET_MANIFEST_INVALID/u,
    );
  }, 60_000);

  it("leaves the browser KTX2 path on three's real loader", async () => {
    const project = await gameProject("threenative-ktx2-browser-");
    // The project's own Vite, driven exactly as `threenative build` drives it for the web
    // target: no native conditions, no bundler plugins of ours.
    await run(process.execPath, ["--input-type=module", "-e", WEB_BUILD_SCRIPT], { cwd: project });

    const source = await readFile(path.join(project, "dist-web/web.js"), "utf8");
    // three's own KTX2Loader, its zstd decoder and its Basis transcoder wiring, untouched.
    expect(source).toContain("class KTX2Loader");
    expect(source).toContain("basis_transcoder");
    expect(source).toMatch(/\bWebAssembly\b/u);
    expect(source).not.toContain("TN_NATIVE_KTX2_UNSUPPORTED");
    expect(source).not.toContain("TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED");
  }, 180_000);
});
