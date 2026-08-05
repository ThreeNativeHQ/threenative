import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createProject } from "../src/index.js";

const templates = ["starter", "minimal"] as const;
const typecheckTemplates = ["starter", "minimal", "platformer"] as const;
const templateRoot = path.resolve("packages/create-threenative/templates");
const execFileAsync = promisify(execFile);

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(file)));
    else files.push(file);
  }
  return files;
}

async function sourceFiles(root: string): Promise<Array<[string, string]>> {
  const files = (await filesUnder(path.join(root, "src"))).filter((file) =>
    /\.(?:ts|tsx)$/u.test(file),
  );
  return Promise.all(files.map(async (file) => [file, await readFile(file, "utf8")] as const));
}

function runtimeExports(source: string): Array<{ callable: boolean; name: string }> {
  return [
    ...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)/gu),
  ].flatMap((match) => {
    const name = match[1] ?? match[2];
    return name === undefined ? [] : [{ callable: match[1] !== undefined, name }];
  });
}

function callPattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`\\b${escaped}\\s*\\(`, "u");
}

function referencePattern(name: string): RegExp {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u");
}

async function linkDependency(target: string, name: string, source: string): Promise<void> {
  const link = path.join(target, "node_modules", name);
  await mkdir(path.dirname(link), { recursive: true });
  await symlink(source, link, "dir");
}

async function findPnpmPackage(name: string): Promise<string> {
  const encoded = name.replaceAll("/", "+");
  const virtualStore = path.resolve("node_modules/.pnpm");
  const entry = (await readdir(virtualStore)).find((file) => file.startsWith(`${encoded}@`));
  if (entry === undefined) throw new Error(`Cannot find installed ${name} in the pnpm store.`);
  return path.join(virtualStore, entry, "node_modules", name);
}

async function linkScaffoldDependencies(target: string): Promise<void> {
  const packageJson = JSON.parse(await readFile(path.join(target, "package.json"), "utf8")) as {
    devDependencies?: Record<string, string>;
  };
  await linkDependency(target, "@threenative/core", path.resolve("packages/core"));
  await linkDependency(target, "@threenative/physics", path.resolve("packages/physics"));
  await linkDependency(target, "@threenative/playtest", path.resolve("packages/playtest"));
  await linkDependency(target, "three", path.resolve("packages/core/node_modules/three"));
  if (packageJson.devDependencies?.["@types/three"] !== undefined)
    await linkDependency(
      target,
      "@types/three",
      path.resolve("packages/core/node_modules/@types/three"),
    );
  await linkDependency(
    target,
    "@dimforge/rapier3d-compat",
    path.resolve("packages/physics/node_modules/@dimforge/rapier3d-compat"),
  );
  await linkDependency(target, "zustand", path.resolve("packages/core/node_modules/zustand"));
  await linkDependency(target, "typescript", path.resolve("packages/core/node_modules/typescript"));
  await linkDependency(target, "vite", await findPnpmPackage("vite"));
  await linkDependency(target, "@types/node", await findPnpmPackage("@types/node"));
  await mkdir(path.join(target, "node_modules/.bin"), { recursive: true });
  await symlink(
    path.resolve("packages/core/node_modules/typescript/bin/tsc"),
    path.join(target, "node_modules/.bin/tsc"),
  );
}

describe("template contracts", () => {
  it("should import every module under each template render directory", async () => {
    for (const template of templates) {
      const root = path.join(templateRoot, template);
      const renderFiles = (await readdir(path.join(root, "src/render"))).filter((file) =>
        file.endsWith(".ts"),
      );
      const sources = await sourceFiles(root);
      for (const renderFile of renderFiles) {
        const stem = renderFile.slice(0, -3);
        const importers = sources.filter(
          ([file, source]) =>
            file !== path.join(root, "src/render", renderFile) &&
            source.includes(`/render/${stem}.js`),
        );
        expect(
          importers.map(([file]) => path.relative(root, file)),
          `${template}/${renderFile}`,
        ).not.toEqual([]);
      }
    }
  });

  it("should call every exported render integration symbol", async () => {
    for (const template of templates) {
      const root = path.join(templateRoot, template);
      const sources = await sourceFiles(root);
      for (const [file, source] of sources.filter(([file]) =>
        file.includes(`${path.sep}render${path.sep}`),
      )) {
        for (const { callable, name } of runtimeExports(source)) {
          const caller = sources.some(
            ([candidate, candidateSource]) =>
              candidate !== file &&
              (callable ? callPattern(name) : referencePattern(name)).test(
                candidateSource.replace(/^\s*import .*$/gmu, ""),
              ),
          );
          expect(caller, `${template}/${path.basename(file)}:${name}`).toBe(true);
        }
      }
    }
  });

  it("should use roundedBox for starter meshes and never teach the old vertical path", async () => {
    const sources = await sourceFiles(path.join(templateRoot, "starter"));
    for (const [file, source] of sources) {
      if (file.endsWith(`${path.sep}render${path.sep}shapes.ts`)) continue;
      expect(source, path.relative(templateRoot, file)).not.toContain("new BoxGeometry(");
      expect(source, path.relative(templateRoot, file)).not.toContain("#verticalVelocity");
    }
    const allTemplateFiles = await filesUnder(templateRoot);
    for (const file of allTemplateFiles) {
      if (/\.(?:ts|tsx|md|json)$/u.test(file))
        expect(await readFile(file, "utf8"), path.relative(templateRoot, file)).not.toContain(
          "#verticalVelocity",
        );
    }
  });

  it("should wire the spring arm, sky, movement API, and load gate", async () => {
    const play = await readFile(path.join(templateRoot, "starter/src/scenes/Play.ts"), "utf8");
    const starterPlayer = await readFile(
      path.join(templateRoot, "starter/src/entities/Player.ts"),
      "utf8",
    );
    const minimalPlayer = await readFile(
      path.join(templateRoot, "minimal/src/entities/Player.ts"),
      "utf8",
    );
    const boot = await readFile(path.join(templateRoot, "starter/src/scenes/Boot.ts"), "utf8");
    expect(play).toContain("createSpringArm");
    expect(play).toContain("createSpringArm(ctx.camera");
    expect(play).toContain("springArm");
    expect(play).toContain("roundedBox");
    expect(play).toContain("setupSky");
    expect(play).toContain("setupSky(ctx.scene");
    expect(play).toContain("KILL_PLANE");
    expect(play).toContain("player.respawn()");
    expect(play).toContain("this.#audio?.play(buffer)");
    for (const player of [starterPlayer, minimalPlayer]) {
      expect(player).toContain("moveAndSlide");
      expect(player).toContain("body.velocity");
      expect(player).toContain("const COYOTE_TIME = 0.12");
      expect(player).toContain("const JUMP_BUFFER = 0.14");
      expect(player).not.toContain(".move({");
    }
    expect(boot.indexOf("await ctx.assets.texture")).toBeGreaterThan(-1);
    expect(boot.indexOf("await ctx.assets.texture")).toBeLessThan(boot.indexOf('ctx.goto("play")'));
    const menu = await readFile(path.join(templateRoot, "starter/src/ui/Menu.tsx"), "utf8");
    expect(menu).toContain("game.pause()");
    expect(menu).toContain("game.resume()");
  });

  it("should set matched sky background and fog, and reject an incomplete gradient", async () => {
    const sky = await readFile(path.join(templateRoot, "starter/src/render/sky.ts"), "utf8");
    expect(sky).toContain("scene.background = top");
    expect(sky).toContain("scene.fog = new Fog(bottom, 18, 80)");
    expect(sky).toContain("options.top === undefined");
    expect(sky).toContain("options.bottom === undefined");
    expect(sky).toContain("throw new TypeError");
  });

  it("should document the rigged-asset path and AnimationPlayer", async () => {
    for (const template of templates) {
      const agents = await readFile(path.join(templateRoot, template, "AGENTS.md"), "utf8");
      expect(agents).toContain("AnimationPlayer");
      expect(agents).toContain(".glb` in `public/");
      expect(agents).toContain("ctx.assets.model");
    }
  });

  it("should list @types/three in every template that runs tsc", async () => {
    for (const template of typecheckTemplates) {
      const packageJson = JSON.parse(
        await readFile(path.join(templateRoot, template, "package.json"), "utf8"),
      ) as { devDependencies?: Record<string, string>; scripts?: Record<string, string> };
      if (packageJson.scripts?.typecheck === undefined) continue;
      expect(packageJson.devDependencies?.["@types/three"], template).toBeDefined();
    }
  });

  it("should use the visible platform object for platform physics", async () => {
    const platform = await readFile(
      path.join(templateRoot, "platformer/src/level/Platform.ts"),
      "utf8",
    );
    expect(platform).toContain("object: visual");
    expect(platform).not.toContain("visible: false");
    expect(platform).not.toContain("new Mesh(");
  });

  it("should typecheck a minimal scaffold without manual installs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "threenative-minimal-typecheck-"));
    try {
      const result = await createProject(
        { install: false, target: "minimal", template: "minimal" },
        root,
      );
      await linkScaffoldDependencies(result.target);
      await execFileAsync("pnpm", ["typecheck"], { cwd: result.target });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 15_000);

  it("should document and apply the forward axis conversion once per template", async () => {
    const movementFiles = [
      ["starter", "src/entities/Player.ts"],
      ["minimal", "src/entities/Player.ts"],
      ["platformer", "src/entities/Character.ts"],
    ] as const;
    for (const [template, relativePath] of movementFiles) {
      const source = await readFile(path.join(templateRoot, template, relativePath), "utf8");
      const agents = await readFile(path.join(templateRoot, template, "AGENTS.md"), "utf8");
      expect(
        source.split("\n").filter((line) => line.includes("-move.y")),
        template,
      ).toHaveLength(1);
      expect(agents).toContain('input.vector("move").y` is +up');
      expect(agents).toContain("`-move.y` conversion");
    }
    const forward = JSON.parse(
      await readFile(path.join(templateRoot, "starter/playtests/forward.playtest.json"), "utf8"),
    ) as { assert?: { movement?: { minAxisDelta?: { axis?: string; min?: number } } } };
    expect(forward.assert?.movement?.minAxisDelta).toEqual({ axis: "-z", min: 0.5 });
  });
});
