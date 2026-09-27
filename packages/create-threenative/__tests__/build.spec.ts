import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rgbaPng } from "../../../test-support/png.js";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import {
  assertNativeAssetsCompatible,
  assertNativeBundleCompatible,
  assertNativeUiRendererCompatible,
  build,
  buildUi,
  buildWeb,
  nativeOrientation,
  parseBuildArgs,
  publishStagedArtifact,
  runtimeHasWebAssembly,
  stagingPath,
  writePackagingConfig,
} from "../src/build.js";
import { ANDROID_RELEASE_SIGNING_ENV } from "../src/doctor.js";
import { createProject } from "../src/index.js";

const run = promisify(execFile);
const roots: string[] = [];

// Putting the previous artifact back only happens on a rename that failed, so one `rename` is made
// to fail for the staged path alone. The put-back renames from the `.previous-` sibling instead, so
// the restore itself still goes through the real filesystem — a mock that failed every rename would
// leave the previous artifact stranded in the aside, which is the opposite of what this proves.
const renameFault = vi.hoisted(() => ({ from: undefined as string | undefined }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    rename: async (from: string, to: string) => {
      if (from === renameFault.from) {
        throw Object.assign(new Error(`EXDEV: rename ${from} -> ${to} refused`), { code: "EXDEV" });
      }
      return original.rename(from, to);
    },
  };
});

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
  const vite = path.join(project, "node_modules", "vite");
  const bin = path.join(vite, "bin", "vite.js");
  await mkdir(path.dirname(bin), { recursive: true });
  await writeFile(
    path.join(vite, "package.json"),
    JSON.stringify({ name: "vite", type: "module", bin: { vite: "bin/vite.js" } }),
  );
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
  return bin;
}

/** The workspace's own Vite, symlinked into a temp project that has no install of its own. */
async function linkWorkspaceVite(project: string): Promise<void> {
  const entry = (await readdir(path.resolve("node_modules/.pnpm"))).find((name) =>
    name.startsWith("vite@"),
  );
  if (entry === undefined) throw new Error("The workspace Vite package is missing.");
  await symlink(
    path.resolve("node_modules/.pnpm", entry, "node_modules/vite"),
    path.join(project, "node_modules/vite"),
    "dir",
  );
}

// A physically separate copy of a package the bundle may end up carrying twice: same name, same
// export, a marker naming which copy answered.
async function writeStubPackage(
  directory: string,
  exported: string,
  marker: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({
      main: "index.js",
      name: path.basename(directory),
      type: "module",
      version: "1.0.0",
    }),
  );
  await writeFile(
    path.join(directory, "index.js"),
    `export const ${exported} = () => ${JSON.stringify(marker)};\n`,
  );
}

describe("threenative build", () => {
  it('does not allow the mutation "audio worker pool remains referenced after build completion"', async () => {
    const root = await makeTempDir("threenative-build-exit-");
    roots.push(root);
    const { target } = await createProject(
      { install: false, target: "game", template: "starter" },
      root,
    );
    await installDeterministicVite(target);
    const cli = path.resolve("packages/create-threenative/dist/threenative.js");

    const result = await new Promise<{ code: number | null; timedOut: boolean }>((resolve) => {
      const child = spawn(process.execPath, [cli, "build"], {
        cwd: target,
        stdio: "ignore",
      });
      // Deliberately generous, and not a performance budget. What separates the defect from a
      // healthy build is exit versus never-exit: a live worker pool holds the event loop open
      // forever, so any ceiling catches it, while a slow runner is still a build that finishes.
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        resolve({ code: null, timedOut: true });
      }, 60_000);
      child.once("exit", (code) => {
        clearTimeout(timeout);
        resolve({ code, timedOut: false });
      });
    });

    expect(result).toEqual({ code: 0, timedOut: false });
  }, 90_000);

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
      display: {
        fullscreen: true,
        keepScreenOn: false,
        maxFps: 60,
        orientation: "landscape" as const,
      },
      nativeEntry: "src/game.ts",
      renderer: { preferWebGPU: true },
      ui: { renderer: "native" as const },
      window: { height: 720, maximized: false, resizable: true, title: "Brand Game", width: 1280 },
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
    // PRD-448: the CLI consumes --profile itself; Vite never sees it.
    expect(parseBuildArgs(["build", "--profile", "compact", "--base", "/g/"])).toEqual({
      profile: "compact",
      target: "web",
      viteArgs: ["--base", "/g/"],
    });
    expect(() => parseBuildArgs(["build", "--profile"])).toThrow(/--profile requires a value/u);
  });

  // PRD-212 phase 2. The CLI must reject an unsupported request before any work, and pass a
  // supported one through unchanged to the Android packager.
  it("parses and validates the Android mode/format request", () => {
    expect(
      parseBuildArgs(["build", "--target", "android", "--mode", "release", "--format", "aab"]),
    ).toEqual({ target: "android", mode: "release", format: "aab", viteArgs: [] });
    expect(parseBuildArgs(["build", "--target", "android", "--mode", "release"])).toEqual({
      target: "android",
      mode: "release",
      viteArgs: [],
    });
    expect(() => parseBuildArgs(["build", "--target", "android", "--format", "aab"])).toThrow(
      /--format aab requires --mode release/u,
    );
    expect(() => parseBuildArgs(["build", "--mode", "release"])).toThrow(
      /supported only for --target android/u,
    );
    expect(() => parseBuildArgs(["build", "--target", "android", "--mode", "staging"])).toThrow(
      /Unknown build mode/u,
    );
    expect(() => parseBuildArgs(["build", "--target", "android", "--format"])).toThrow(
      /--format requires a value/u,
    );
    // A repeated flag must not leak its value into viteArgs.
    expect(
      parseBuildArgs([
        "build",
        "--target",
        "android",
        "--mode",
        "release",
        "--mode",
        "release",
        "--format",
        "apk",
      ]).viteArgs,
    ).toEqual([]);
  });

  it("rejects an unsupported mode/format request in build() before touching the project", async () => {
    await expect(build({ cwd: "/unused", target: "web", mode: "release" })).rejects.toThrow(
      /supported only for --target android/u,
    );
    await expect(
      build({ cwd: "/unused", target: "android", mode: "debug", format: "aab" }),
    ).rejects.toThrow(/--format aab requires --mode release/u);
  });

  // PRD-212 phase 3. Doctor predicts the signing properties a release needs; the packager must
  // read exactly those four or the prediction becomes a prerequisite no build has.
  it("spells the release signing properties the same way doctor predicts them", async () => {
    const source = await readFile(
      path.resolve("packages/runtime-native/scripts/package-android.mjs"),
      "utf8",
    );
    for (const name of ANDROID_RELEASE_SIGNING_ENV) {
      expect(source, name).toContain(name);
    }
  });

  it("runs the installed Vite CLI through Node without a platform shell shim", async () => {
    for (const template of ["minimal", "starter", "platformer"] as const) {
      const root = await makeTempDir(`threenative-web-${template}-`);
      roots.push(root);
      const { target } = await createProject({ install: false, target: "game", template }, root);
      const vite = await installDeterministicVite(target);
      await run(process.execPath, [vite, "build", "--outDir", "vite-dist"], { cwd: target });
      await buildWeb(target, ["--outDir", "web build & release"]);
      expect(await tree(path.join(target, "web build & release")), template).toEqual(
        await tree(path.join(target, "vite-dist")),
      );
    }
  });

  // PRD-448. The web build publishes the way a native artifact already does, so the last working
  // `dist` is what a player is served until a build that finished replaces it. A Vite run that
  // dies half-way through its write must not take that with it.
  it("leaves the previous web outDir byte-identical when Vite fails", async () => {
    const root = await makeTempDir("threenative-web-failed-");
    roots.push(root);
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "web-failed" }));
    // Writes into whatever outDir it was handed, then fails: the shape of a real build that dies
    // after emptying the directory, which is the write the old in-place outDir could not survive.
    const vite = await installDeterministicVite(root);
    await writeFile(
      vite,
      `#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const index = process.argv.indexOf("--outDir");
const out = path.resolve(index === -1 ? "dist" : process.argv[index + 1]);
await mkdir(out, { recursive: true });
await writeFile(path.join(out, "index.html"), "half-written\\n");
process.exit(1);
`,
    );
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "dist", "index.html"), "previous\n");
    const previous = await tree(path.join(root, "dist"));

    await expect(buildWeb(root)).rejects.toThrow(/exited with code 1/u);

    expect(await tree(path.join(root, "dist"))).toEqual(previous);
    expect((await readdir(root)).filter((name) => name.startsWith(".staging-"))).toEqual([]);
  });

  it("replaces the previous web outDir with the finished build", async () => {
    const root = await makeTempDir("threenative-web-published-");
    roots.push(root);
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "web-published" }));
    await installDeterministicVite(root);
    // A file only the previous build wrote: a published outDir is replaced, never merged into.
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "dist", "stale.txt"), "last release\n");

    await buildWeb(root);

    await expect(readFile(path.join(root, "dist", "index.html"), "utf8")).resolves.toContain(
      "web-published",
    );
    expect(existsSync(path.join(root, "dist", "stale.txt"))).toBe(false);
    expect((await readdir(root)).filter((name) => name.startsWith(".staging-"))).toEqual([]);
  });

  /** A web project whose profile caps the artifact at a ceiling the stub Vite output exceeds. */
  async function budgetedWebProject(severity: "error" | "warn"): Promise<string> {
    const root = await makeTempDir("threenative-web-budget-");
    roots.push(root);
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "web-budget" }));
    await writeFile(
      path.join(root, "threenative.config.ts"),
      [
        "export default {",
        "  buildProfiles: {",
        '    defaults: { web: "capped" },',
        "    profiles: {",
        `      capped: { artifactBudget: { artifactBytes: { limit: 10, severity: "${severity}" } } },`,
        "    },",
        "  },",
        "};",
        "",
      ].join("\n"),
    );
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "dist", "index.html"), "previous\n");
    await installDeterministicVite(root);
    return root;
  }

  // PRD-448. `artifactBudget` was measured for native artifacts only, so a web build shipped
  // whatever it produced under a profile that declared a hard ceiling: the one target a player
  // downloads was the one the budget never saw.
  it("refuses a web build over its profile's artifact budget and leaves the previous dist", async () => {
    const root = await budgetedWebProject("error");

    await expect(buildWeb(root)).rejects.toThrow(
      /TN_BUILD_ARTIFACT_BUDGET_EXCEEDED.*artifactBytes measured \d+ bytes over its 10-byte limit/u,
    );

    expect(await readFile(path.join(root, "dist", "index.html"), "utf8")).toBe("previous\n");
    expect((await readdir(root)).filter((name) => name.startsWith(".staging-"))).toEqual([]);
  });

  it("prints the same sentence and publishes a web build whose ceiling only warns", async () => {
    const root = await budgetedWebProject("warn");
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });

    await buildWeb(root);

    expect(await readFile(path.join(root, "dist", "index.html"), "utf8")).toContain("web-budget");
    expect(lines.join("")).toMatch(
      /threenative build: artifactBytes measured \d+ bytes over its 10-byte limit\.\n/u,
    );
  });

  /**
   * A real Vite project whose cook writes to `cooked/`, so the only thing that can put the cooked
   * bytes in `dist` is the build telling Vite where its `publicDir` is. `ownPublicDir` is the one
   * choice the build must not overrule.
   */
  async function cookedOutputProject(ownPublicDir?: string): Promise<string> {
    const root = await makeTempDir("threenative-web-cooked-");
    roots.push(root);
    await mkdir(path.join(root, "assets"), { recursive: true });
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "node_modules"), { recursive: true });
    await linkWorkspaceVite(root);
    // The bake copies three's Basis transcoder next to its output, resolved through the project.
    await symlink(
      path.resolve("packages/core/node_modules/three"),
      path.join(root, "node_modules/three"),
      "dir",
    );
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "cooked-output", type: "module" }),
    );
    await writeFile(
      path.join(root, "threenative.config.ts"),
      'export default { assets: { concurrency: 1, output: "cooked" } };\n',
    );
    await writeFile(
      path.join(root, "index.html"),
      '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>\n',
    );
    await writeFile(path.join(root, "src", "main.ts"), 'console.info("cooked");\n');
    await writeFile(
      path.join(root, "assets", "rock.png"),
      rgbaPng({
        blue: (x, y) => (x * 31 + y * 17) % 256,
        green: (x, y) => (x * 7 + y * 29) % 256,
        height: 64,
        red: (x, y) => (x * 13 + y * 11) % 256,
        width: 64,
      }),
    );
    if (ownPublicDir !== undefined) {
      await mkdir(path.join(root, ownPublicDir), { recursive: true });
      await writeFile(path.join(root, ownPublicDir, "brand.txt"), "the project's own choice\n");
      await writeFile(
        path.join(root, "vite.config.ts"),
        `import { defineConfig } from "vite";\nexport default defineConfig({ publicDir: ${JSON.stringify(ownPublicDir)} });\n`,
      );
    }
    return root;
  }

  // PRD-448. A project that cooked anywhere but `public/` shipped a `dist` with no
  // `assets.manifest.json` in it: Vite copied its own `publicDir` and the cook's output sat next
  // to the build, unread. The build knows the asset root, so the build is what has to say so.
  it("builds a web dist out of the configured asset root, and keeps a publicDir the project set", async () => {
    const cooked = await cookedOutputProject();

    await buildWeb(cooked);

    const manifest = JSON.parse(
      await readFile(path.join(cooked, "dist", "assets.manifest.json"), "utf8"),
    ) as { entries: Record<string, { output: string } | undefined> };
    // Nothing was ever cooked into Vite's default, so the served manifest cannot have come from
    // it: the bytes in `dist` are the ones the config named.
    expect(existsSync(path.join(cooked, "public"))).toBe(false);
    expect(
      existsSync(path.join(cooked, "dist", String(manifest.entries["rock.png"]?.output))),
    ).toBe(true);

    // An explicit `publicDir` is the project's own decision, and the build leaves it alone.
    const own = await cookedOutputProject("brand");
    await buildWeb(own);
    expect(await readFile(path.join(own, "dist", "brand.txt"), "utf8")).toBe(
      "the project's own choice\n",
    );
    expect(existsSync(path.join(own, "dist", "assets.manifest.json"))).toBe(false);
  }, 180_000);

  it("stages under the artifact's own name and publishes every file the packager wrote beside it", async () => {
    const root = await makeTempDir("threenative-publish-family-");
    roots.push(root);
    const final = path.join(root, "dist-native", "space-game");
    const staging = stagingPath(final);
    // Packagers name things after their output's basename, so the staged name must be the real one.
    expect(path.basename(staging)).toBe("space-game");
    await mkdir(path.dirname(staging), { recursive: true });
    for (const name of ["space-game", "space-game.tar.gz", "space-game-setup.exe"])
      await writeFile(path.join(path.dirname(staging), name), `${name}\n`);
    await writeFile(`${final}.tar.gz`, "previous container\n");

    await publishStagedArtifact(final, staging);

    for (const name of ["space-game", "space-game.tar.gz", "space-game-setup.exe"])
      await expect(readFile(path.join(root, "dist-native", name), "utf8")).resolves.toBe(
        `${name}\n`,
      );
    expect(await readdir(path.join(root, "dist-native"))).toEqual([
      "space-game",
      "space-game-setup.exe",
      "space-game.tar.gz",
    ]);
  });

  it("puts the previous artifact back when the rename-in fails", async () => {
    const root = await makeTempDir("threenative-publish-restore-");
    roots.push(root);
    const final = path.join(root, "game.js");
    const staging = stagingPath(final);
    await writeFile(final, "previous artifact\n");
    await mkdir(path.dirname(staging), { recursive: true });
    await writeFile(staging, "new artifact\n");
    renameFault.from = staging;

    await expect(publishStagedArtifact(final, staging)).rejects.toThrow(/EXDEV/u);

    renameFault.from = undefined;
    await expect(readFile(final, "utf8")).resolves.toBe("previous artifact\n");
    // The aside the previous artifact was moved to is gone: it went back rather than being left
    // stranded under a second name. The staged artifact itself is the caller's to remove, which
    // is what `buildWeb` and `packageStaged` do with it.
    expect(existsSync(path.join(path.dirname(staging), "game.js.previous"))).toBe(false);
  });

  it("drops a cook output the current bake does not declare from the web outDir", async () => {
    // Vite copies the whole output root, so without the packagers' own selector an orphan from
    // an earlier bake ships in every web build and is never loaded by anything. The bake is the
    // real one: only a bake that actually cooked something leaves a manifest naming its outputs.
    const root = await makeTempDir("threenative-web-orphan-");
    roots.push(root);
    await mkdir(path.join(root, "assets"), { recursive: true });
    const runtime = path.join(root, "node_modules", "@threenative", "runtime-native", "scripts");
    await mkdir(runtime, { recursive: true });
    await writeFile(
      path.join(runtime, "..", "package.json"),
      '{"name":"@threenative/runtime-native","type":"module"}\n',
    );
    await writeFile(
      path.join(runtime, "asset-manifest.mjs"),
      await readFile(path.resolve("packages/runtime-native/scripts/asset-manifest.mjs"), "utf8"),
    );
    // The bake copies three's Basis transcoder next to its output, resolved through the project.
    await symlink(
      path.resolve("packages/core/node_modules/three"),
      path.join(root, "node_modules", "three"),
      "dir",
    );
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "web-orphan" }));
    await writeFile(
      path.join(root, "threenative.config.ts"),
      "export default { assets: { concurrency: 1 } };\n",
    );
    await writeFile(
      path.join(root, "assets", "rock.png"),
      rgbaPng({
        blue: (x, y) => (x * 31 + y * 17) % 256,
        green: (x, y) => (x * 7 + y * 29) % 256,
        height: 64,
        red: (x, y) => (x * 13 + y * 11) % 256,
        width: 64,
      }),
    );
    // A cook output from a bake this one knows nothing about: an orphan no game loads.
    await mkdir(path.join(root, "public"), { recursive: true });
    await writeFile(path.join(root, "public", "ghost.22222222.png"), "orphan");
    const vite = await installDeterministicVite(root);
    await writeFile(
      vite,
      `#!/usr/bin/env node
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
// The outDir it was handed, as Vite honours it: the build stages its own sibling.
const index = process.argv.indexOf("--outDir");
const out = path.resolve(index === -1 ? "dist" : process.argv[index + 1]);
mkdirSync(out, { recursive: true });
cpSync("public", out, { recursive: true });
`,
    );

    await buildWeb(root);

    const manifest = JSON.parse(
      await readFile(path.join(root, "dist", "assets.manifest.json"), "utf8"),
    ) as { entries: Record<string, { output: string }> };
    expect(existsSync(path.join(root, "dist", manifest.entries["rock.png"]?.output ?? ""))).toBe(
      true,
    );
    expect(existsSync(path.join(root, "dist", "ghost.22222222.png"))).toBe(false);
  }, 60_000);

  it("emits index.html for the native overlay loader", async () => {
    const root = await makeTempDir("threenative-ui-build-");
    roots.push(root);
    await mkdir(path.join(root, "src/ui"), { recursive: true });
    await mkdir(path.join(root, "node_modules"), { recursive: true });
    const vitePackage = (await readdir(path.resolve("node_modules/.pnpm"))).find((entry) =>
      entry.startsWith("vite@"),
    );
    if (vitePackage === undefined) throw new Error("The workspace Vite package is missing.");
    await symlink(
      path.resolve("node_modules/.pnpm", vitePackage, "node_modules/vite"),
      path.join(root, "node_modules/vite"),
      "dir",
    );
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "ui-build" }));
    await writeFile(path.join(root, "src/ui/main.tsx"), "export const ui = true;\n");

    const output = await buildUi(root, {
      ui: { renderer: "web" },
    } as Parameters<typeof buildUi>[1]);
    await expect(readFile(path.join(output, "index.html"), "utf8")).resolves.toContain("assets/");
    await expect(readFile(path.join(output, "ui.html"), "utf8")).rejects.toThrow();
  });

  it("preserves a project-owned file while building the native UI page", async () => {
    const root = await makeTempDir("threenative-ui-project-file-");
    roots.push(root);
    await mkdir(path.join(root, "src/ui"), { recursive: true });
    await mkdir(path.join(root, "node_modules"), { recursive: true });
    const vitePackage = (await readdir(path.resolve("node_modules/.pnpm"))).find((entry) =>
      entry.startsWith("vite@"),
    );
    if (vitePackage === undefined) throw new Error("The workspace Vite package is missing.");
    await symlink(
      path.resolve("node_modules/.pnpm", vitePackage, "node_modules/vite"),
      path.join(root, "node_modules/vite"),
      "dir",
    );
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "ui-build" }));
    await writeFile(path.join(root, "src/ui/main.tsx"), "export const ui = true;\n");
    const projectFile = path.join(root, ".threenative-ui.html");
    await writeFile(projectFile, "project-owned\n");

    await buildUi(root, {
      ui: { renderer: "web" },
    } as Parameters<typeof buildUi>[1]);

    await expect(readFile(projectFile, "utf8")).resolves.toBe("project-owned\n");
  });

  // The native web view loads exactly one page, so whatever `src/ui/main.tsx` imports and
  // whatever a linked package imports have to be the same React: a second copy carries its own
  // null dispatcher and every hook throws on the phone. pnpm links `@threenative/ui` from
  // outside the game, so its `react` resolves beside the engine rather than beside the game.
  // Two physically separate stub packages stand in for that here, and the entry compares the
  // identities the bundle actually produced rather than the config text that asked for them.
  it("bundles one copy of a peer the entry and a linked package both import", async () => {
    const root = await makeTempDir("threenative-ui-dedupe-");
    roots.push(root);
    const project = path.join(root, "game");
    const linked = path.join(root, "engine", "linked-hud");
    await mkdir(path.join(project, "src/ui"), { recursive: true });
    await mkdir(path.join(project, "node_modules"), { recursive: true });
    const vitePackage = (await readdir(path.resolve("node_modules/.pnpm"))).find((entry) =>
      entry.startsWith("vite@"),
    );
    if (vitePackage === undefined) throw new Error("The workspace Vite package is missing.");
    await symlink(
      path.resolve("node_modules/.pnpm", vitePackage, "node_modules/vite"),
      path.join(project, "node_modules/vite"),
      "dir",
    );
    await writeStubPackage(path.join(project, "node_modules/react"), "useState", "root-react");
    await writeStubPackage(path.join(project, "node_modules/hud-theme"), "token", "root-theme");
    await writeStubPackage(path.join(linked, "node_modules/react"), "useState", "linked-react");
    await writeStubPackage(path.join(linked, "node_modules/hud-theme"), "token", "linked-theme");
    await writeFile(
      path.join(linked, "package.json"),
      JSON.stringify({ main: "index.js", name: "linked-hud", type: "module", version: "1.0.0" }),
    );
    await writeFile(
      path.join(linked, "index.js"),
      'export { useState as linkedUseState } from "react";\nexport { token as linkedToken } from "hud-theme";\n',
    );
    await symlink(linked, path.join(project, "node_modules/linked-hud"), "dir");
    await writeFile(
      path.join(project, "package.json"),
      JSON.stringify({ name: "ui-dedupe", type: "module" }),
    );
    // `hud-theme` is the project's own dedupe entry and `modulePreload` its own build option.
    // Both have to survive the merge: the first proves the engine's entries were added to the
    // project's list instead of replacing it, the second keeps the built page runnable in Node.
    await writeFile(
      path.join(project, "vite.config.js"),
      'export default { build: { modulePreload: false }, resolve: { dedupe: ["hud-theme"] } };\n',
    );
    await writeFile(
      path.join(project, "src/ui/main.tsx"),
      [
        'import { token } from "hud-theme";',
        'import { linkedToken, linkedUseState } from "linked-hud";',
        'import { useState } from "react";',
        "",
        "const duplicated = [",
        '  useState === linkedUseState ? "" : `react ${useState()}/${linkedUseState()}`,',
        '  token === linkedToken ? "" : `hud-theme ${token()}/${linkedToken()}`,',
        "].filter(Boolean);",
        'if (duplicated.length > 0) throw new Error(`TN_UI_DUPLICATE_PEER: ${duplicated.join(", ")}`);',
        "globalThis.tnUiPeers = { react: useState(), theme: token() };",
        "",
      ].join("\n"),
    );

    const output = await buildUi(project, {
      ui: { renderer: "web" },
    } as Parameters<typeof buildUi>[1]);
    const page = await readFile(path.join(output, "index.html"), "utf8");
    const entry = /src="\.\/(?<chunk>[^"]+\.js)"/u.exec(page)?.groups?.chunk;
    if (entry === undefined) throw new Error(`The built page loads no module:\n${page}`);
    await import(pathToFileURL(path.join(output, entry)).href);

    expect((globalThis as { tnUiPeers?: unknown }).tnUiPeers).toEqual({
      react: "root-react",
      theme: "root-theme",
    });
  }, 60_000);

  it("accepts web UI bundles for every native host that stages them", () => {
    expect(() => assertNativeUiRendererCompatible("android", "web")).not.toThrow();
    expect(() => assertNativeUiRendererCompatible("desktop", "web", "linux")).not.toThrow();
    // The Windows and macOS desktop overlays are proved by the hosted starter lanes, so the public
    // guard now admits them (PRD-217 phase 3B). A desktop window system with no overlay still
    // refuses rather than packaging a bundle nothing renders.
    expect(() => assertNativeUiRendererCompatible("desktop", "web", "darwin")).not.toThrow();
    expect(() => assertNativeUiRendererCompatible("desktop", "web", "win32")).not.toThrow();
    expect(() => assertNativeUiRendererCompatible("ios", "web")).not.toThrow();
    expect(() => assertNativeUiRendererCompatible("desktop", "web", "freebsd")).toThrow(
      /TN_UI_RENDERER_UNSUPPORTED.*desktop.*freebsd/u,
    );
  });

  it("accepts the decoder-free Android manifest produced by the asset compiler", async () => {
    const root = await makeTempDir("threenative-mobile-assets-");
    roots.push(root);
    await mkdir(path.join(root, "public"), { recursive: true });
    const manifestPath = path.join(root, "public", "assets.manifest.json");
    const config = { assets: { output: "public" } } as Parameters<
      typeof assertNativeAssetsCompatible
    >[2];
    await writeFile(
      manifestPath,
      JSON.stringify({
        entries: {
          "models/hero.glb": {
            extensions: ["KHR_mesh_quantization"],
            output: "models/hero.12345678.glb",
          },
          "models/rock.glb": {
            output: "models/rock.87654321.glb",
            sharedImages: [{ codec: "none", output: "shared/images/1234567890abcdef.none.png" }],
          },
        },
        version: 1,
      }),
    );

    await expect(assertNativeAssetsCompatible(root, "android", config)).resolves.toBeUndefined();

    await writeFile(
      manifestPath,
      JSON.stringify({
        entries: {
          "models/hero.glb": {
            extensions: ["EXT_meshopt_compression"],
            output: "models/hero.12345678.glb",
          },
        },
        version: 1,
      }),
    );
    await expect(assertNativeAssetsCompatible(root, "android", config)).rejects.toThrow(
      "TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED",
    );
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

  // PRD-217 acceptance criterion 4. The UI layer now renders react-dom on every target, and the
  // temptation is to conclude this guard has been superseded. It has not: the guard is about the
  // PORTABLE entry — the graph that reaches `THREE.Scene` — and the UI ships as a separate bundle
  // the packager stages under `assets/ui/`, which never passes through here. A game whose
  // `src/game.ts` mounts React is still refused, whatever its `ui.renderer` says.
  it("still refuses react-dom in the portable entry after the UI layer landed", async () => {
    const root = await makeTempDir("threenative-portable-guard-");
    roots.push(root);
    const portable = path.join(root, "game.js");
    await writeFile(
      portable,
      'import { createRoot } from "react-dom/client";\nexport default defineGame({});\n',
    );
    for (const target of ["desktop", "android", "ios"] as const) {
      await expect(assertNativeBundleCompatible(portable, target)).rejects.toThrow(
        /TN_NATIVE_WEB_ONLY_UI/u,
      );
    }
  });

  it("fails closed when the declared native entry is missing", async () => {
    const root = await makeTempDir("threenative-missing-entry-");
    roots.push(root);
    await mkdir(path.join(root, "assets"), { recursive: true });
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

describe("runtime WebAssembly capability", () => {
  const runtime = path.resolve("packages/create-threenative/src/build.ts");
  const version = (engine: string): string =>
    `TN_COLD_START:{"segment":"process","atMs":0.000}\nMystral Native Runtime v0.3.3\nNative WebGPU JS runtime - wgpu-native + ${engine} build\n`;

  it("reads the engine from the runtime binary, not the target", () => {
    const probe = (_binary: string, args: readonly string[]) => {
      expect(args).toEqual(["--version"]);
      return { status: 0, stdout: version("quickjs"), stderr: "" };
    };
    expect(runtimeHasWebAssembly(runtime, probe as never)).toBe(false);
    expect(
      runtimeHasWebAssembly(runtime, (() => ({ status: 0, stdout: version("jsc") })) as never),
    ).toBe(false);
    expect(
      runtimeHasWebAssembly(runtime, (() => ({ status: 0, stdout: version("v8") })) as never),
    ).toBe(true);
  });

  it("keeps the WASM desktop backend when the runtime is unknown or unreadable", () => {
    expect(runtimeHasWebAssembly(undefined)).toBe(true);
    expect(runtimeHasWebAssembly("/no/such/runtime")).toBe(true);
    expect(runtimeHasWebAssembly(runtime, (() => ({ status: 1, stdout: "" })) as never)).toBe(true);
    expect(
      runtimeHasWebAssembly(runtime, (() => {
        throw new Error("EACCES");
      }) as never),
    ).toBe(true);
  });
});
