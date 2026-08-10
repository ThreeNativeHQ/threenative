import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { assertNativeBundleCompatible, build } from "../src/build.js";

const run = promisify(execFile);
const roots: string[] = [];
const bundler = path.resolve("packages/runtime-native/scripts/bundle.mjs");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function projectRoot(prefix: string): Promise<string> {
  const project = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(project);
  await mkdir(path.join(project, "src"), { recursive: true });
  await mkdir(path.join(project, "node_modules"), { recursive: true });
  await symlink(path.resolve("node_modules/vite"), path.join(project, "node_modules/vite"));
  await writeFile(path.join(project, "package.json"), '{"name":"entry-proof","type":"module"}\n');
  return project;
}

async function bundle(
  project: string,
  target: "android" | "desktop" | "ios",
  entry = "src/game.ts",
): Promise<string> {
  const output = path.join(project, `dist/${target}.js`);
  await run(
    process.execPath,
    [bundler, "--project", project, "--entry", entry, "--target", target, "--output", output],
    { cwd: project },
  );
  return output;
}

describe("native template contract", () => {
  it("keeps the portable graph and generated start while excluding the web entry", async () => {
    const project = await projectRoot("threenative-native-entry-");
    await writeFile(
      path.join(project, "src/portable.ts"),
      'export const portableMarker = "TN_PORTABLE_MODULE_PRESENT";\n',
    );
    await writeFile(
      path.join(project, "src/ui.ts"),
      'export const uiMarker = "TN_WEB_UI_MODULE_PRESENT";\n',
    );
    await writeFile(
      path.join(project, "src/game.ts"),
      `import { portableMarker } from "./portable.js";
const arena = { start: async () => console.info(portableMarker) };
export default arena;
`,
    );
    await writeFile(
      path.join(project, "src/main.ts"),
      `import arena from "./game.js";
import { uiMarker } from "./ui.js";
console.info(arena, uiMarker);
`,
    );

    const output = await bundle(project, "desktop");
    const source = await readFile(output, "utf8");
    expect(source).toContain("/* TN_NATIVE_BUNDLE_SCOPE */\n(() => {");
    expect(source.trimEnd()).toMatch(/\}\)\(\);$/u);
    expect(source).toContain("TN_PORTABLE_MODULE_PRESENT");
    expect(source).toContain("TN_NATIVE_START_FAILED");
    expect(source).not.toContain("TN_WEB_UI_MODULE_PRESENT");
    for (const target of ["desktop", "android", "ios"] as const) {
      await expect(assertNativeBundleCompatible(output, target)).resolves.toBeUndefined();
    }
  });

  it("fails with TN_NATIVE_ENTRY_NO_DEFAULT when the portable entry has no default", async () => {
    const project = await projectRoot("threenative-native-default-");
    const output = path.join(project, "dist/desktop.js");
    await writeFile(path.join(project, "src/game.ts"), "export const game = { start() {} };\n");

    await expect(bundle(project, "desktop")).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "TN_NATIVE_ENTRY_NO_DEFAULT: src/game.ts must default-export the game.",
      ),
    });
    await expect(readFile(output, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects UI only when the portable entry imports it", async () => {
    const project = await projectRoot("threenative-native-ui-");
    await writeFile(
      path.join(project, "src/ui.ts"),
      `export const uiMarker = "TN_IMPORTED_UI_MODULE_PRESENT";
export function mount() { return document.getElementById("root"); }
`,
    );
    await writeFile(
      path.join(project, "src/game.ts"),
      `import { mount, uiMarker } from "./ui.js";
export default { start: async () => console.info(uiMarker, mount()) };
`,
    );

    const output = await bundle(project, "desktop");
    expect(await readFile(output, "utf8")).toContain("TN_IMPORTED_UI_MODULE_PRESENT");
    for (const target of ["desktop", "android", "ios"] as const) {
      await expect(assertNativeBundleCompatible(output, target)).rejects.toThrow(
        /TN_NATIVE_WEB_ONLY_UI/u,
      );
    }
  });

  it("uses normal package exports on desktop and native exports on mobile", async () => {
    const project = await projectRoot("threenative-native-conditions-");
    const dependency = path.join(project, "node_modules/condition-proof");
    await mkdir(dependency, { recursive: true });
    await writeFile(
      path.join(dependency, "package.json"),
      JSON.stringify({
        exports: { ".": { "threenative-native": "./native.js", import: "./web.js" } },
        name: "condition-proof",
        type: "module",
      }),
    );
    await writeFile(path.join(dependency, "web.js"), 'export const marker = "WEB_BACKEND";\n');
    await writeFile(
      path.join(dependency, "native.js"),
      'export const marker = "NATIVE_BACKEND";\n',
    );
    await writeFile(
      path.join(project, "src/game.ts"),
      `import { marker } from "condition-proof";
export default { start: async () => console.info(marker) };
`,
    );

    const desktop = await readFile(await bundle(project, "desktop"), "utf8");
    const android = await readFile(await bundle(project, "android"), "utf8");
    expect(desktop).toContain("WEB_BACKEND");
    expect(desktop).not.toContain("NATIVE_BACKEND");
    expect(android).toContain("NATIVE_BACKEND");
    expect(android).not.toContain("WEB_BACKEND");
  }, 15_000);

  it("passes public assets to every native packager", async () => {
    const project = await projectRoot("threenative-native-assets-");
    const runtime = path.join(project, "node_modules/@threenative/runtime-native");
    await mkdir(path.join(project, "public"), { recursive: true });
    await mkdir(path.join(runtime, "scripts"), { recursive: true });
    await writeFile(
      path.join(project, "src/game.ts"),
      "export default { start: async () => {} };\n",
    );
    await writeFile(path.join(project, "public/texture.png"), "texture\n");
    await writeFile(
      path.join(runtime, "package.json"),
      '{"name":"@threenative/runtime-native","type":"module"}\n',
    );
    await writeFile(
      path.join(runtime, "scripts/bundle.mjs"),
      `import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const output = process.argv[process.argv.indexOf("--output") + 1];
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, "globalThis.__nativeProof = true;\\n");
`,
    );
    for (const target of ["desktop", "android", "ios"] as const) {
      await writeFile(
        path.join(runtime, `scripts/package-${target}.mjs`),
        `import { writeFile } from "node:fs/promises";
await writeFile(new URL("../${target}-args.json", import.meta.url), JSON.stringify(process.argv.slice(2)));
`,
      );
      await build({ cwd: project, target });
      const args = JSON.parse(
        await readFile(path.join(runtime, `${target}-args.json`), "utf8"),
      ) as string[];
      expect(args, `${target} must receive public/`).toContain("--assets");
      expect(args, `${target} must receive public/`).toContain(path.join(project, "public"));
    }
  });
});
