import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { assertNativeBundleCompatible, build, buildWeb, parseBuildArgs } from "../src/build.js";
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
      const root = await mkdtemp(path.join(os.tmpdir(), `threenative-web-${template}-`));
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
      expect(manifest.devDependencies?.["create-threenative"], template).toBe("0.1.0");
      expect(manifest.optionalDependencies?.["@threenative/runtime-native"], template).toBe(
        "0.1.12",
      );
      expect(manifest.pnpm?.onlyBuiltDependencies, template).toContain(
        "@threenative/runtime-native",
      );
      expect(manifest.threenative?.nativeEntry, template).toBe("src/game.ts");
    }
  });

  it("guards web-only UI on every native target and WASM on mobile only", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "threenative-mobile-bundle-"));
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
    const root = await mkdtemp(path.join(os.tmpdir(), "threenative-missing-entry-"));
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
