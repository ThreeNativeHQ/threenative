import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { auditAllTemplates } from "../../../scripts/instruction-budget.js";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { createProject } from "../src/index.js";
import { createSpringArm } from "../templates/starter/src/render/camera.js";

const templates = ["starter", "minimal"] as const;
const brandingTemplates = [
  "action-rpg",
  "defense",
  "minimal",
  "platformer",
  "racing",
  "shooter",
  "starter",
] as const;
const typecheckTemplates = ["starter", "minimal", "platformer"] as const;
// Only `minimal` still ships a camera-attached geometry HUD, because it is the one template with
// no React and therefore no other way to draw one. Round 10 removed it from platformer, shooter,
// racing and defense, where it rendered *on top of* their React HUD: four templates drew the same
// numbers twice, and in shooter the overlap was unreadable.
const geometryHudTemplates = ["minimal"] as const;
const templateRoot = path.resolve("packages/create-threenative/templates");
const agentDocsRoot = path.resolve("packages/create-threenative/agent-docs");
const requiredSharedFragments = [
  "framework-blocks-you",
  "asset-mcp-loop",
  "sculpt-loop",
  "look-at-it-and-budget-the-look",
  "ctx-surface",
  "engine-capabilities",
  "playtest-fail-closed",
  "performance-default",
  // PRD-228: the shipped resolutionScale convention. Its own fragment rather than a paragraph
  // in performance-default, which carries an executable 130-word cap and a different subject.
  "pixel-budget",
] as const;
// The frame-time ceiling stays mandatory; PRD-214 added an fps floor and per-phase ceilings
// beside it, so the pattern bounds the opening of the object rather than its whole shape.
const performanceBoundPattern = /"performance":\s*\{\s*"maxFrameMsP95":\s*33\s*[,}]/u;
const externalMcps = ["threenative-asset-mcp", "threenative-sculpt-mcp"] as const;
const execFileAsync = promisify(execFile);

async function templateNames(): Promise<string[]> {
  return (await readdir(templateRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function performanceScenarioFile(template: string): string {
  return template === "minimal" || template === "starter"
    ? "playtests/play.playtest.json"
    : "playtests/performance.playtest.json";
}

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

function hudGlyphProof(source: string, text: string) {
  const characters = /const CHARS = "([^"]+)"/u.exec(source)?.[1];
  const encoded = /"([0-9a-f ]+)"\s*\.split\(" "\)/u.exec(source)?.[1];
  if (characters === undefined || encoded === undefined)
    throw new Error("Malformed HUD glyph data");
  const glyphs = encoded.split(" ").map((hex) => BigInt(`0x${hex}`));
  if (glyphs.length !== characters.length) throw new Error("HUD glyph table is incomplete");
  const points: Array<[number, number]> = [];
  for (const [character, value] of [...text].entries()) {
    if (value === " ") continue;
    const glyph = glyphs[characters.indexOf(value)];
    if (glyph === undefined) throw new Error(`Missing HUD glyph: ${value}`);
    for (let pixel = 0; pixel < 35; pixel += 1)
      if ((glyph & (1n << BigInt(pixel))) !== 0n)
        points.push([character * 6 + (pixel % 5), Math.floor(pixel / 5)]);
  }
  if (points.length === 0) throw new Error("HUD glyph proof is blank");
  return {
    brightPixels: points.length,
    bounds: [
      Math.min(...points.map(([x]) => x)),
      Math.min(...points.map(([, y]) => y)),
      Math.max(...points.map(([x]) => x)),
      Math.max(...points.map(([, y]) => y)),
    ],
  };
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
  // Every template's vite.config.ts imports watchAssets from here since PRD-094 phase 4;
  // tsc reads vite.config.ts through the root-level *.ts include.
  await linkDependency(target, "@threenative/assets", path.resolve("packages/assets"));
  await linkDependency(target, "@threenative/playtest", path.resolve("packages/playtest"));
  await linkDependency(target, "create-threenative", path.resolve("packages/create-threenative"));
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
  it("requires every discovered template to ship a bounded performance scenario", async () => {
    const names = await templateNames();
    expect(names).toHaveLength(7);

    const performanceAssertions: string[] = [];
    const emptyPerformanceAssertions: string[] = [];
    for (const template of names) {
      const playtestRoot = path.join(templateRoot, template, "playtests");
      const playtests = (await filesUnder(playtestRoot)).filter((file) =>
        file.endsWith(".playtest.json"),
      );
      for (const playtest of playtests) {
        const scenario = JSON.parse(await readFile(playtest, "utf8")) as {
          assert?: { performance?: Record<string, unknown> };
        };
        const performance = scenario.assert?.performance;
        if (performance === undefined) continue;
        const relative = path.relative(templateRoot, playtest);
        if (Object.keys(performance).length === 0) emptyPerformanceAssertions.push(relative);
        else performanceAssertions.push(relative);
      }
    }
    expect(performanceAssertions, "non-empty performance assertions").toHaveLength(7);
    expect(emptyPerformanceAssertions, "empty performance assertions").toEqual([]);

    for (const template of names) {
      const scenarioFile = performanceScenarioFile(template);
      const scenarioPath = path.join(templateRoot, template, scenarioFile);
      const source = await readFile(scenarioPath, "utf8").catch(() => undefined);
      expect(source, `${template}/${scenarioFile}`).toBeDefined();
      if (source === undefined) continue;

      const scenario = JSON.parse(source) as {
        assert?: {
          performance?: Record<string, unknown>;
        };
        steps?: Array<{ holdTicks?: number; waitTicks?: number }>;
        viewport?: { height?: number; width?: number };
        warmupFrames?: number;
      };
      const performance = scenario.assert?.performance;
      expect(performance, `${template} performance assertion`).toBeDefined();
      if (performance === undefined) continue;

      expect(Object.keys(performance).sort(), template).toEqual([
        "maxDrawCalls",
        "maxFrameMsP95",
        "maxTriangles",
      ]);
      expect(performance.maxFrameMsP95, template).toBe(33);
      expect(typeof performance.maxDrawCalls, template).toBe("number");
      expect(typeof performance.maxTriangles, template).toBe("number");
      expect(performance.maxDrawCalls, template).toBeGreaterThan(0);
      expect(performance.maxTriangles, template).toBeGreaterThan(0);
      expect(scenario.viewport, template).toEqual({ height: 1080, width: 1920 });
      expect(scenario.warmupFrames, template).toBe(60);
      expect(
        scenario.steps?.reduce(
          (ticks, step) => ticks + (step.holdTicks ?? 0) + (step.waitTicks ?? 0),
          0,
        ),
        template,
      ).toBeGreaterThanOrEqual(600);
    }
  });

  it("wires the brand adapter, launch handoff, and generated loading source in every template", async () => {
    for (const template of brandingTemplates) {
      const root = path.join(templateRoot, template);
      const [config, index, main, vite] = await Promise.all([
        readFile(path.join(root, "threenative.config.ts"), "utf8"),
        readFile(path.join(root, "index.html"), "utf8"),
        readFile(path.join(root, "src/main.ts"), "utf8"),
        readFile(path.join(root, "vite.config.ts"), "utf8"),
      ]);
      expect(vite, template).toContain("createWebBrandPlugin()");
      expect(index, template).toContain("data-threenative-launch");
      expect(main, template).toContain("requestAnimationFrame");
      expect(main, template).toContain("launch.remove()");
      expect(config, template).toContain("bootSplash");
      expect(config, template).toContain("icons");
      expect(config, template).not.toMatch(/loading\s*:/u);

      const sources = await sourceFiles(root);
      const loadingSource = sources.find(([file]) => file.endsWith("src/render/loading.ts"))?.[1];
      expect(loadingSource, template).toContain("createLoadingScreen");
      expect(loadingSource, template).toContain("safeArea");
      expect(loadingSource, template).toContain("fillImage");
      expect(
        sources.some(
          ([file, source]) =>
            file.endsWith(".ts") &&
            !file.endsWith("src/render/loading.ts") &&
            source.includes("createLoadingScreen("),
        ),
        template,
      ).toBe(true);
    }
  });

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
            (file !== path.join(root, "src/render", renderFile) &&
              source.includes(`/render/${stem}.js`)) ||
            source.includes(`./${stem}.js`),
        );
        expect(
          importers.map(([file]) => path.relative(root, file)),
          `${template}/${renderFile}`,
        ).not.toEqual([]);
      }
    }
  });

  it("should never draw two HUDs at once", async () => {
    // Round 10's blind baseline caught this: four templates mounted a camera-attached geometry HUD
    // from the portable scene *and* a React <Hud /> from src/ui/App.tsx, so both drew the same
    // numbers over each other on web. In shooter the overlap made the upper-left quarter of the
    // frame unreadable and scored its UX 1 of 5. Nothing reported it — a doubled HUD typechecks,
    // lints, and passes every playtest, because the assertions read game state rather than pixels.
    const roots = (await readdir(templateRoot, { withFileTypes: true })).filter((entry) =>
      entry.isDirectory(),
    );
    expect(roots.length).toBeGreaterThanOrEqual(4);
    for (const entry of roots) {
      const root = path.join(templateRoot, entry.name);
      const sources = await sourceFiles(root);
      const mountsReactHud = sources.some(
        ([file, source]) => file.endsWith("App.tsx") && /<Hud\b/u.test(source),
      );
      // Call sites only. The definition in src/render/hud.ts also matches `createHud(`, and a
      // template that ships the file without calling it draws nothing twice.
      const mountsGeometryHud = sources.some(
        ([file, source]) =>
          !file.endsWith(path.join("src", "render", "hud.ts")) && /\bcreateHud\s*\(/u.test(source),
      );
      // A DOM readout counts too. `minimal` ships no React and slipped through the first version of
      // this check while drawing a #score chip from main.ts *and* a geometry HUD showing SCORE —
      // the same doubling, one layer down. A blind score read the chip overlapping the glyphs.
      const mountsDomHud = sources.some(([, source]) =>
        /querySelector<[^>]*>\("#(?:score|hud)"\)/u.test(source),
      );
      const layers = [mountsReactHud, mountsGeometryHud, mountsDomHud].filter(Boolean).length;
      expect(
        layers,
        `${entry.name} mounts ${layers} HUD layers; they render on top of each other`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it("should ship a user-owned geometry HUD in templates that use one", async () => {
    for (const template of geometryHudTemplates) {
      const root = path.join(templateRoot, template);
      const hud = await readFile(path.join(root, "src/render/hud.ts"), "utf8");
      const scene = await readFile(path.join(root, "src/scenes/Play.ts"), "utf8");
      expect(hud, template).toContain("InstancedMesh");
      expect(hud, template).toContain("camera.add(root)");
      expect(hud, template).toContain("renderOrder");
      expect(hud, template).toContain("TIME ");
      expect(hud, template).not.toMatch(/CanvasTexture|document\.|window\.|@threenative\//u);
      expect(scene, template).toContain("createHud(");
      expect(scene, template).toMatch(/ctx\.add\((?:ctx\.)?camera\)/u);
      expect(scene, template).toContain("hud.update(");
      expect(scene, template).toMatch(/ctx\.entities\.add\(\s*"hud"/u);
      expect(hudGlyphProof(hud, "SCORE 1200"), template).toEqual({
        brightPixels: 161,
        bounds: [0, 0, 58, 6],
      });
    }
    expect(() => hudGlyphProof('const CHARS = "";', "SCORE 1200")).toThrow(
      "Malformed HUD glyph data",
    );
  });

  it("should ship exactly one starter HUD", async () => {
    const hud = await readFile(path.join(templateRoot, "starter/src/ui/Hud.tsx"), "utf8");
    // `useUiState`, not `useGameState`: the HUD reads the game's PUBLISHED state, because on every
    // native target it renders in another process and cannot hold the game object at all.
    expect(hud).toContain("useUiState");
    expect(hud).not.toContain("useGameState");
    await expect(
      readFile(path.join(templateRoot, "starter/src/render/hud.ts"), "utf8"),
    ).rejects.toThrow();
  });

  /**
   * Source checks above prove the HUD is written. This pins the proof that it *runs*: a
   * scenario each template's `pnpm test` executes must observe the booted HUD's live glyph
   * count. Delete the assertion from a scenario and this goes red, so the observation cannot
   * quietly disappear and leave the source checks looking like coverage.
   *
   * The assertion is `changed`, not a floor: any floor is already satisfied by the warmup
   * value, which the runner correctly rejects as trivial.
   */
  it("should observe the booted geometry HUD in templates that use one", async () => {
    for (const template of geometryHudTemplates) {
      // Every template's HUD has to expose the count, whether or not its scenario reads it.
      const source = await readFile(path.join(templateRoot, template, "src/render/hud.ts"), "utf8");
      expect(source, template).toMatch(/glyphs:\s*0/u);
      expect(source, template).toContain("this.glyphs = instance");
    }

    const root = path.join(templateRoot, "minimal");
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    expect(manifest.scripts?.test ?? "").toContain('--scenario "playtests/*.playtest.json"');
    // Without the bridge the scenario fails closed on TN_PLAYTEST_BRIDGE_MISSING.
    expect(await readFile(path.join(root, "src/game.ts"), "utf8")).toContain("playtest(");

    const scenario = JSON.parse(
      await readFile(path.join(root, "playtests/play.playtest.json"), "utf8"),
    );
    const hud = (scenario.assert?.components ?? []).find(
      (entry: { entity?: string }) => entry.entity === "hud",
    );
    expect(hud, "the minimal template boots without observing its HUD").toEqual({
      changed: true,
      component: "glyphs",
      entity: "hud",
    });
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

  it("should wire the spring arm, sky, and movement API", async () => {
    const play = await readFile(path.join(templateRoot, "starter/src/scenes/Play.ts"), "utf8");
    const camera = await readFile(path.join(templateRoot, "starter/src/render/camera.ts"), "utf8");
    const starterPlayer = await readFile(
      path.join(templateRoot, "starter/src/entities/Player.ts"),
      "utf8",
    );
    const minimalPlayer = await readFile(
      path.join(templateRoot, "minimal/src/entities/Player.ts"),
      "utf8",
    );
    expect(play).toContain("createSpringArm");
    expect(play).toContain("createSpringArm(ctx.camera");
    expect(play).toContain("springArm");
    expect(play).toContain("roundedBox");
    expect(play).toContain("setupSky");
    expect(play).toContain("setupSky(ctx.scene");
    expect(play).toContain("KILL_PLANE");
    expect(play).toContain("player.respawn()");
    expect(play).toContain("if (respawned) frameCtx.state.flush()");
    expect(play).toContain("audio.play(buffer)");
    expect(play).toContain('frameCtx.input.axis("zoom")');
    expect(play).toContain("springArm.dolly");
    expect(camera).toContain("dolly");
    for (const player of [starterPlayer, minimalPlayer]) {
      expect(player).toContain("moveAndSlide");
      expect(player).toContain("body.velocity");
      expect(player).toContain("const COYOTE_TIME = 0.12");
      expect(player).toContain("const JUMP_BUFFER = 0.14");
      expect(player).not.toContain(".move({");
    }
    // Pause and resume moved out of the menu and into `src/game.ts`, because on every native
    // target the UI is in another process and cannot call the game. It sends a named intent and
    // the game decides what the name means; both halves are asserted rather than just the button.
    const menu = await readFile(path.join(templateRoot, "starter/src/ui/Menu.tsx"), "utf8");
    expect(menu).toContain('send(paused ? "resume" : "pause")');
    const gameEntry = await readFile(path.join(templateRoot, "starter/src/game.ts"), "utf8");
    expect(gameEntry).toContain("game.pause()");
    expect(gameEntry).toContain("game.resume()");
  });

  it("should dolly the starter spring arm toward its target for positive zoom intent", () => {
    const camera = new PerspectiveCamera();
    const arm = createSpringArm(camera);
    const target = new Vector3();

    arm.snap(target);
    const startingDistance = camera.position.distanceTo(target);
    arm.dolly(1, 1 / 60);
    arm.follow(target, 1 / 60);

    expect(camera.position.distanceTo(target)).toBeLessThan(startingDistance);
  });

  it("should demonstrate the complete ctx lifecycle surface", async () => {
    const play = await readFile(path.join(templateRoot, "starter/src/scenes/Play.ts"), "utf8");
    const menu = await readFile(path.join(templateRoot, "starter/src/ui/Menu.tsx"), "utf8");
    const gameEntry = await readFile(path.join(templateRoot, "starter/src/game.ts"), "utf8");
    expect(play).toContain('frameCtx.goto("play")');
    expect(play).toContain("frameCtx.state.set(Play.initialState)");
    expect(play).toContain("frameCtx.state.flush()");
    expect(play).toContain("ctx.tween(");
    expect(play).toContain("ctx.after(");
    expect(play).toContain("pickup.monitoring = false");
    // The restart button sends an intent; `src/game.ts` is what calls goto.
    expect(menu).toContain('send("restart")');
    expect(gameEntry).toContain('game.goto("play")');

    const restart = JSON.parse(
      await readFile(path.join(templateRoot, "starter/playtests/restart.playtest.json"), "utf8"),
    ) as {
      assert: {
        resources: Array<{
          atSteps?: Array<{ equals: number; label: string }>;
          changed?: boolean;
          equals?: number;
          path: string;
        }>;
      };
    };
    const score = restart.assert.resources.find(
      ({ path: resourcePath }) => resourcePath === "score",
    );
    expect(score).toMatchObject({
      atSteps: [
        { equals: 1, label: "collected" },
        { equals: 0, label: "restarted" },
      ],
    });
    expect(score?.changed).toBeUndefined();
    // audio, player and goal survive the collect; the pickup is the fourth and is removed
    // when it is taken, so the restart puts the count back up rather than down.
    expect(restart.assert.resources).toContainEqual({
      atSteps: [
        { equals: 3, label: "collected" },
        { equals: 4, label: "restarted" },
      ],
      id: "state",
      path: "entityCount",
    });

    for (const template of await templateNames()) {
      const agents = await readFile(path.join(templateRoot, template, "AGENTS.md"), "utf8");
      expect(agents).toContain(
        "## The `ctx` surface — you already have these, do not rebuild them",
      );
      expect(agents).toContain('| `ctx.goto("<scene-name>")` |');
      expect(agents).toContain("`ctx.goto(name)` rebuilds the scene without resetting game state");
      expect(agents).toContain("ctx.state.set({ /* copy this game's initial-state shape */ })");
      expect(agents).toContain(
        '`game.goto("<scene-name>")` also rebuilds the scene, but it resets the game\'s state',
      );
      expect(agents).toContain("deterministic only when `defineGame({ seed })` is configured");
      expect(agents).toContain("goto` and then `return`");
      expect(agents).not.toContain("That is your entire restart button");
      expect(agents).not.toContain("probably does not exist");
    }
  });

  it("should decay the platformer coyote timer every update", async () => {
    const character = await readFile(
      path.join(templateRoot, "platformer/src/entities/Character.ts"),
      "utf8",
    );
    expect(character).toContain("this.#coyote = Math.max(0, this.#coyote - dt);");
  });

  it("should set matched sky background and fog, and reject an incomplete gradient", async () => {
    const sky = await readFile(path.join(templateRoot, "starter/src/render/sky.ts"), "utf8");
    expect(sky).toContain("scene.background = top");
    expect(sky).toContain("resolved.top === undefined");
    expect(sky).toContain("resolved.bottom === undefined");
    expect(sky).toContain("throw new TypeError");
    // Round 9 lost the visual column to fog reaching the playable middle distance: a blind judge
    // chose against the build because "the distance fogs to near-white". The near plane belongs
    // past where the next jump is, not 18 units from the camera.
    const range = /new Fog\([^,]+,\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\)/u.exec(sky);
    expect(range, "starter sky must construct a Fog with a literal near and far").not.toBeNull();
    const [near, far] = [Number(range?.[1]), Number(range?.[2])];
    expect(near).toBeGreaterThanOrEqual(40);
    expect(far).toBeGreaterThan(near);
  });

  it("should never let fog swallow a template's sky dome", async () => {
    // A sky dome is the horizon, so fog must never apply to it. Where it does and the dome sits
    // at or past the fog far plane, the dome renders as one flat fog-coloured wash and the
    // authored gradient never reaches the screen. Round 9 found this shipping in four templates
    // at once — starter, minimal, platformer and shooter — with nothing reporting it: typecheck,
    // lint and every playtest pass on a flat sky.
    const skies = (await readdir(templateRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(templateRoot, entry.name, "src/render/sky.ts"));
    const checked: string[] = [];
    for (const file of skies) {
      const source = await readFile(file, "utf8").catch(() => undefined);
      if (source === undefined) continue;
      checked.push(file);
      const material = /new MeshBasicMaterial\(\{[^}]*\}\)/u.exec(source)?.[0];
      expect(material, `${file}: sky dome must build a MeshBasicMaterial`).toBeDefined();
      expect(material, `${file}: sky dome material must set fog: false`).toContain("fog: false");
    }
    // Fail closed: a glob that matched nothing would otherwise pass this test silently.
    expect(checked.length).toBeGreaterThanOrEqual(4);
  });

  it("should document the rigged-asset path and AnimationPlayer", async () => {
    for (const template of templates) {
      const agents = await readFile(path.join(templateRoot, template, "AGENTS.md"), "utf8");
      expect(agents).toContain("AnimationPlayer");
      expect(agents).toContain(".glb` in `assets/");
      expect(agents).toContain("ctx.assets.model");
    }
  });

  // A generated project's agent cannot fix a framework bug: the packages arrive as bundled JS
  // with no sourcemaps. Left without an instruction it either stalls on the gap or contorts the
  // game around it, and both outcomes are worse than a plain Three.js patch plus a report of what
  // blocked it. Every template says so, because the agent reads only the one it was scaffolded
  // with.
  it("should tell the agent to drop to plain Three.js when the framework blocks it", async () => {
    const names = (await readdir(templateRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(names.length).toBeGreaterThan(3);
    for (const template of names) {
      const agents = await readFile(path.join(templateRoot, template, "AGENTS.md"), "utf8");
      expect(agents, template).toContain("## When the framework blocks you, write plain Three.js");
      expect(agents, template).toMatch(/broken, missing, or does not do what you need/);
      expect(agents, template).toMatch(/Report what blocked you/);
    }
  });

  it("should keep external MCPs out of every workspace package", async () => {
    const packagesRoot = path.resolve("packages");
    for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(packagesRoot, entry.name, "package.json");
      const manifest = await readFile(manifestPath, "utf8").catch(() => undefined);
      for (const packageName of externalMcps)
        expect(manifest ?? "", `${entry.name}/${packageName}`).not.toContain(packageName);
    }
  });

  it("should require every shared agent fragment in every template", async () => {
    const names = await templateNames();
    expect(names.length).toBeGreaterThanOrEqual(7);
    const fragmentFiles = (await readdir(agentDocsRoot))
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.slice(0, -3))
      .sort();
    expect(fragmentFiles).toEqual([...requiredSharedFragments].sort());
    for (const template of names) {
      const agents = await readFile(path.join(templateRoot, template, "AGENTS.md"), "utf8");
      for (const fragment of requiredSharedFragments) {
        expect(agents, `${template}/${fragment}`).toContain(`<!-- shared: ${fragment} -->`);
      }
    }
  });

  it("should document a bounded performance assertion in every template", async () => {
    const fragment = await readFile(path.join(agentDocsRoot, "performance-default.md"), "utf8");
    expect(fragment.split(/\s+/u).filter(Boolean).length).toBeLessThan(130);
    expect(fragment).toContain("agent-docs/assertion-reference.md#performance");
    expect(fragment).toMatch(performanceBoundPattern);
    for (const template of await templateNames()) {
      const agents = await readFile(path.join(templateRoot, template, "AGENTS.md"), "utf8");
      expect(agents, `${template}/performance-default`).toContain(
        "agent-docs/assertion-reference.md#performance",
      );
      expect(agents, `${template}/performance-default`).toMatch(performanceBoundPattern);
    }
  });

  it("should render every platform performance target into every template", async () => {
    const expectedTargets = [
      "|1|Starter/browser-desktop|60fps|display-refresh|",
      "|1|Starter/browser-Android|30fps|58fps|",
      "|1|Starter/native-desktop|60fps|display-refresh|",
      "|1|Starter/native-Android|55fps|58fps|",
      "|1|Starter/native-iOS|unverified|no-number|",
      "|1|All-platform/hostGap-p95|—|≤4ms|",
      "|1|All-platform/update-p95|—|≤2ms|",
      "|1|All-platform/residual-p95|—|≤0.5ms|",
      "|1|All-platform/overlay-p95|—|≤1ms|",
      "|2|Same-device-fps-parity|.85|.95|",
      "|2|Inverted-render-p95-parity|.80|.95|",
      "|3|Light|55fps|58fps|",
      "|3|Medium|30fps|58fps|",
      "|3|Heavy|30fps|58fps|",
      "|4|Sustained-duration|10min|10min|",
      "|4|Final/opening-fps|.75|.90|",
      "|4|Last-minute-heavy|25fps|50fps|",
      "|4|Peak-battery-temperature|≤45C|≤40C|",
      "|4|Thermal-status|≤2|≤1|",
      "|4|Whole-device-current|—|report;not-gated|",
    ] as const;
    const fragment = await readFile(path.join(agentDocsRoot, "performance-default.md"), "utf8");
    expect(fragment).toContain("Unexecuted platforms stay unverified");
    expect(fragment).toContain(
      "Withdraw thermally-confounded Tiers 1–3 comparisons; always report Tier 4",
    );
    for (const target of expectedTargets) expect(fragment).toContain(target);

    for (const template of await templateNames()) {
      const agents = await readFile(path.join(templateRoot, template, "AGENTS.md"), "utf8");
      expect(agents, `${template}/unexecuted`).toContain("Unexecuted platforms stay unverified");
      expect(agents, `${template}/thermal-confound`).toContain(
        "Withdraw thermally-confounded Tiers 1–3 comparisons; always report Tier 4",
      );
      for (const target of expectedTargets)
        expect(agents, `${template}/${target}`).toContain(target);
    }
  });

  // P2-2: the same checker the scripts-side spec exercises on fixtures, run over the real
  // template tree. A template that grows past its measured word budget, drops a mandatory
  // inline section, names a reference page the bundle does not ship, or whose CLAUDE.md
  // mirror drifted, fails here with a diagnostic naming the defect.
  it("should keep every generated instruction pair bounded", async () => {
    const audits = await auditAllTemplates(path.resolve("."));
    expect(audits).toHaveLength(7);
    for (const audit of audits) {
      expect(
        audit.violations,
        `${audit.template}: ${audit.violations.map(({ message }) => message).join("; ")}`,
      ).toEqual([]);
    }
    for (const audit of audits) {
      // The bundle pages a template's instructions name must be exactly the ones the
      // scaffolder ships, so discovery cannot silently rot.
      expect(audit.references.length, `${audit.template} references nothing`).toBeGreaterThan(0);
    }
  });

  it("should scaffold flat agent docs without shared marker comments", async () => {
    const root = await makeTempDir("threenative-shared-agent-scaffold-");
    const sharedBodies = await Promise.all(
      requiredSharedFragments.map(
        async (fragment) =>
          [
            fragment,
            (await readFile(path.join(agentDocsRoot, `${fragment}.md`), "utf8")).trim(),
          ] as const,
      ),
    );
    try {
      for (const template of await templateNames()) {
        const result = await createProject(
          { install: false, target: `generated-${template}`, template },
          root,
        );
        for (const file of ["AGENTS.md", "CLAUDE.md"]) {
          const docs = await readFile(path.join(result.target, file), "utf8");
          expect(docs, `${template}/${file}`).not.toMatch(/<!--\s*(?:shared:|\/shared)/u);
          for (const [fragment, body] of sharedBodies) {
            expect(docs, `${template}/${file}/${fragment}`).toContain(body);
          }
        }
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 30_000);

  it("should document only tools the pinned sculpt MCP serves", async () => {
    const surface = JSON.parse(
      await readFile(path.resolve("packages/create-threenative/sculpt-mcp-tools.json"), "utf8"),
    ) as { recommended: string[]; tools: string[]; version: string };
    const served = new Set(surface.tools);
    for (const template of await templateNames()) {
      const agents = await readFile(path.join(templateRoot, template, "AGENTS.md"), "utf8");
      const mentioned = [...agents.matchAll(/`(sculpt_[a-z0-9_]+)`/gu)].map(
        (match) => match[1] as string,
      );
      expect(
        mentioned.filter((name) => !served.has(name)),
        template,
      ).toEqual([]);
      for (const name of surface.recommended) expect(agents, `${template}/${name}`).toContain(name);
      const manifest = JSON.parse(
        await readFile(path.join(templateRoot, template, "package.json"), "utf8"),
      ) as { devDependencies?: Record<string, string> };
      expect(manifest.devDependencies?.["threenative-sculpt-mcp"], template).toBe(surface.version);
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
    const root = await makeTempDir("threenative-minimal-typecheck-");
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

  // Every template reads `input.vector("move")` and six of the seven used to inherit that
  // binding invisibly from a default, so nothing in the generated project showed an agent what
  // an axis binding looks like. The same templates bound their buttons with `down`, teaching
  // the reading of that field the type does not mean. Round 9 friction ledger.
  it("should declare the move axis and bind buttons with keys", async () => {
    const names = (await readdir(templateRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(names.length).toBeGreaterThan(3);
    for (const template of names) {
      const source = await readFile(path.join(templateRoot, template, "src/game.ts"), "utf8");
      expect(source, template).toMatch(/move: \{[\s\S]*?up: \[/);
      const buttonBindings = source
        .split("\n")
        .filter((line) => /^\s+\w+: \{[^\n]*\bdown: \[/.test(line));
      expect(buttonBindings, `${template} binds a button with down instead of keys`).toEqual([]);
    }
  });

  // The generated instructions told an agent to use xvfb-run, which replaces a successful
  // command's exit status with a failing one, and listed Chromium flags without
  // --enable-features=Vulkan — documenting the SwiftShader configuration the same file calls
  // invalid evidence.
  it("should never instruct xvfb-run or a flag list missing Vulkan", async () => {
    const names = (await readdir(templateRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const template of names) {
      const agentsPath = path.join(templateRoot, template, "AGENTS.md");
      const agents = await readFile(agentsPath, "utf8").catch(() => undefined);
      if (agents === undefined) continue;
      const lines = agents.split("\n");
      lines.forEach((line, index) => {
        // A mention is fine when it carries the warning; an instruction to run it is not.
        // The warning wraps, so read the sentence around the mention rather than the line.
        if (/xvfb-run/.test(line)) {
          const sentence = lines.slice(Math.max(0, index - 3), index + 4).join(" ");
          expect(sentence, `${template} AGENTS.md line ${index + 1}`).toMatch(
            /\bnot\b|\bnever\b|rather than|replaces a successful/i,
          );
        }
      });
      // Positive requirement rather than a guard against the old flag list: a file that tells
      // an agent how to capture WebGPU must name the configuration that actually reaches the
      // GPU driver, not one that leaves Chromium on its CPU rasteriser.
      if (/headed/i.test(agents) && /WebGPU/.test(agents)) {
        expect(agents, `${template} AGENTS.md`).toMatch(
          /--browser-recipe webgpu|--enable-features=Vulkan/,
        );
      }
    }
  });
});
