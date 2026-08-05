import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const templates = ["starter", "minimal"] as const;
const templateRoot = path.resolve("packages/create-threenative/templates");

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
});
