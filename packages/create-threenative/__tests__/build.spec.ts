import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import {
  assertNativeBundleCompatible,
  build,
  buildWeb,
  nativeOrientation,
  parseBuildArgs,
  writePackagingConfig,
} from "../src/build.js";
import { createProject } from "../src/index.js";

const run = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function tree(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(file);
      else result[path.relative(directory, file)] = await readFile(file, "utf8");
    }
  }
  await walk(directory);
  return result;
}

async function installDeterministicVite(project: string): Promise<string> {
  const bin = path.join(project, "node_modules", ".bin", "vite");
  await mkdir(path.dirname(bin), { recursive: true });
  await writeFile(
    bin,
    `#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const index = process.argv.indexOf("--outDir");
const out = path.resolve(index === -1 ? "dist" : process.argv[index + 1]);
await mkdir(path.join(out, "assets"), { recursive: true });
const manifest = JSON.parse(await readFile("package.json", "utf8"));
await writeFile(path.join(out, "index.html"), "<main>" + manifest.name + "</main>\\n");
await writeFile(path.join(out, "assets", "game.js"), "export const game = true;\\n");
`,
  );
  await chmod(bin, 0o755);
  return bin;
}

describe("threenative build", () => {
  it("resolves every declared brand input through the live packaging-config caller", async () => {
    const config = {
      app: {
        build: 4,
        icon: "public/icon.png",
        icons: {
          android: {
            background: "#123456",
            foreground: "public/foreground.png",
            monochrome: "public/monochrome.png",
          },
          ios: { dark: "public/dark.png", tinted: "public/tinted.png" },
          web: {
            appleTouch: "public/touch.png",
            favicon: "public/favicon.svg",
            maskable: "public/maskable.png",
            monochrome: "public/web-mono.png",
          },
        },
        id: "com.example.game",
        name: "Brand Game",
        version: "1.2.3",
      },
      bootSplash: { backgroundColor: "#123456", image: "public/launch.png" },
      display: { fullscreen: true, keepScreenOn: false, orientation: "landscape" as const },
      nativeEntry: "src/game.ts",
      renderer: { preferWebGPU: true },
      window: { height: 720, resizable: true, title: "Brand Game", width: 1280 },
    };

    const root = await makeTempDir("threenative-brand-build-");
    roots.push(root);
    const output = await writePackagingConfig(root, config);
    const resolved = JSON.parse(await readFile(output, "utf8"));
    expect(resolved.app.icon).toBe(path.join(root, "public/icon.png"));
    expect(resolved.app.icons?.android?.foreground).toBe(path.join(root, "public/foreground.png"));
    expect(resolved.app.icons?.ios?.tinted).toBe(path.join(root, "public/tinted.png"));
    expect(resolved.app.icons?.web?.favicon).toBe(path.join(root, "public/favicon.svg"));
    expect(resolved.bootSplash?.image).toBe(path.join(root, "public/launch.png"));
    expect(resolved.app.icons?.android?.background).toBe("#123456");
  });

  it("keeps build as the only command and target as a flag", () => {
    expect(parseBuildArgs(["build"])).toEqual({ target: "web", viteArgs: [] });
    expect(parseBuildArgs(["build", "--target", "desktop"])).toEqual({
      target: "desktop",
      viteArgs: [],
    });
    expect(() => parseBuildArgs(["package"])).toThrow(/Usage: threenative build/u);
    expect(() => parseBuildArgs(["build", "--target", "console"])).toThrow(/console/u);
  });

  it("delegates byte-identically to the same Vite binary for every template", async () => {
    for (const template of ["minimal", "starter", "platformer"] as const) {
      const root = await makeTempDir(`threenative-web-${template}-`);
      roots.push(root);
      const { target } = await createProject({ install: false, target: "game", template }, root);
      const vite = await installDeterministicVite(target);
      await run(vite, ["build", "--outDir", "vite-dist"], { cwd: target });
      await buildWeb(target, ["--outDir", "cli-dist"]);
      expect(await tree(path.join(target, "cli-dist")), template).toEqual(
        await tree(path.join(target, "vite-dist")),
      );
    }
  });

  it("ships the CLI and native runtime pins in every template", async () => {
    for (const template of ["minimal", "starter", "platformer"] as const) {
      const manifest = JSON.parse(
        await readFile(
          path.resolve("packages/create-threenative/templates", template, "package.json"),
          "utf8",
        ),
      ) as {
        devDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
        pnpm?: { onlyBuiltDependencies?: string[] };
        scripts?: Record<string, string>;
        threenative?: { nativeEntry?: string };
      };
      expect(manifest.scripts?.build, template).toBe("threenative build");
      expect(manifest.scripts?.["build:web"], template).toBe("threenative build --target web");
      expect(manifest.scripts?.["build:desktop"], template).toBe(
        "threenative build --target desktop",
      );
      expect(manifest.scripts?.["build:android"], template).toBe(
        "threenative build --target android",
      );
      expect(manifest.scripts?.["build:ios"], template).toBe("threenative build --target ios");
      // Read off the workspace manifests rather than written as literals. What matters is that a
      // scaffolded project pins the versions this repository actually publishes; a literal here
      // turns every release bump into a failing test that says nothing about that.
      const published = async (name: string): Promise<string> =>
        (
          JSON.parse(await readFile(path.resolve("packages", name, "package.json"), "utf8")) as {
            version: string;
          }
        ).version;
      expect(manifest.devDependencies?.["create-threenative"], template).toBe(
        await published("create-threenative"),
      );
      expect(manifest.optionalDependencies?.["@threenative/runtime-native"], template).toBe(
        await published("runtime-native"),
      );
      expect(manifest.pnpm?.onlyBuiltDependencies, template).toContain(
        "@threenative/runtime-native",
      );
      expect(manifest.threenative, template).toBeUndefined();
      await expect(
        readFile(`packages/create-threenative/templates/${template}/threenative.config.ts`, "utf8"),
      ).resolves.toContain("display");
    }
  });

  it("parses every orientation and defaults missing orientation to landscape", async () => {
    const root = await makeTempDir("threenative-orientation-");
    roots.push(root);
    const manifest = path.join(root, "package.json");
    const config = path.join(root, "threenative.config.ts");
    await writeFile(manifest, JSON.stringify({ name: "orientation-proof" }));
    for (const orientation of ["landscape", "portrait", "sensor"] as const) {
      await writeFile(config, `export default { display: { orientation: "${orientation}" } };\n`);
      await expect(nativeOrientation(root)).resolves.toBe(orientation);
    }
    await writeFile(config, "export default {};\n");
    await expect(nativeOrientation(root)).resolves.toBe("landscape");
  });

  it("fails the native build with a named code for an unrecognised orientation", async () => {
    const root = await makeTempDir("threenative-invalid-orientation-");
    roots.push(root);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src/game.ts"), "export default { start: async () => {} };\n");
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "invalid-orientation" }),
    );
    await writeFile(
      path.join(root, "threenative.config.ts"),
      'export default { display: { orientation: "sideways" } };\n',
    );

    await expect(build({ cwd: root, target: "desktop" })).rejects.toThrow(
      /TN_NATIVE_ORIENTATION_INVALID/u,
    );
  });

  it("guards web-only UI on every native target and WASM on mobile only", async () => {
    const root = await makeTempDir("threenative-mobile-bundle-");
    roots.push(root);
    const native = path.join(root, "native.js");
    const wasm = path.join(root, "wasm.js");
    const react = path.join(root, "react.js");
    await writeFile(native, "globalThis.__THREENATIVE_NATIVE__.physics.createSimulation();\n");
    await writeFile(wasm, "WebAssembly.instantiate(bytes); // rapier_wasm\n");
    await writeFile(react, 'createRoot(document.getElementById("root")).render(app);\n');
    for (const target of ["desktop", "android", "ios"] as const) {
      await expect(assertNativeBundleCompatible(native, target)).resolves.toBeUndefined();
      await expect(assertNativeBundleCompatible(react, target)).rejects.toThrow(
        /TN_NATIVE_WEB_ONLY_UI.*src\/main\.ts.*PRD-051/u,
      );
    }
    await expect(assertNativeBundleCompatible(wasm, "desktop")).resolves.toBeUndefined();
    for (const target of ["android", "ios"] as const) {
      await expect(assertNativeBundleCompatible(wasm, target)).rejects.toThrow(
        /TN_NATIVE_WASM_ON_MOBILE.*src\/game\.ts.*PRD-052/u,
      );
    }
  });

  it("fails closed when the declared native entry is missing", async () => {
    const root = await makeTempDir("threenative-missing-entry-");
    roots.push(root);
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "missing-entry", threenative: { nativeEntry: "src/portable.ts" } }),
    );

    await expect(build({ cwd: root, target: "desktop" })).rejects.toThrow(
      /TN_NATIVE_ENTRY_MISSING: src\/portable\.ts/u,
    );
  });

  it("routes iOS through the verified simulator packager instead of a source build", async () => {
    const source = await readFile("packages/create-threenative/src/build.ts", "utf8");
    expect(source).toContain('path.join(runtimeRoot, "scripts", "package-ios.mjs")');
    expect(source).toContain("`${await projectName(cwd)}.app`");
    expect(source).not.toMatch(/iOS target is OPEN/u);
    expect(source).not.toMatch(/target === "ios"[\s\S]{0,500}(?:cmake|xcodebuild|cargo)/u);
    await expect(
      build({ cwd: "/unused", target: "ios", viteArgs: ["--device", "phone"] }),
    ).rejects.toThrow(/simulator-only.*device signing remains OPEN/u);
  });
});
