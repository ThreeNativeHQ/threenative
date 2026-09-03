import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parsePng } from "@threenative/assets";
import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { auditAllTemplates } from "../../../scripts/instruction-budget.js";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { createProject } from "../src/index.js";
import { createSpringArm } from "../templates/starter/src/render/camera.js";

const templates = ["starter", "minimal"] as const;
/**
 * Every template that advertises a `typecheck` script, read from the shipped manifests rather
 * than listed here — a template added tomorrow is covered the day it ships, and one that stops
 * advertising the script is a manifest change, not a silent hole.
 */
async function typecheckTemplates(): Promise<string[]> {
  const names: string[] = [];
  for (const template of await templateNames()) {
    const packageJson = JSON.parse(
      await readFile(path.join(templateRoot, template, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    if (packageJson.scripts?.typecheck !== undefined) names.push(template);
  }
  if (names.length === 0) throw new Error("No template advertises a typecheck script.");
  return names;
}
// Only `minimal` still ships a camera-attached geometry HUD, because it is the one template with
// no React and therefore no other way to draw one. Round 10 removed it from platformer, shooter,
// racing and defense, where it rendered *on top of* their React HUD: four templates drew the same
// numbers twice, and in shooter the overlap was unreadable.
const geometryHudTemplates = ["minimal"] as const;
const templateRoot = path.resolve("packages/create-threenative/templates");
const authoringSkills = [
  ["prd-creator", ".agent/prd/PRD.md", "explicit approval"],
  ["threenative-capabilities", "engine_search_capabilities", "@threenative/physics/navigation"],
  ["threenative-playtest", "TN_PLAYTEST_SCENARIO_ASSERTS_NOTHING", "doctor"],
  ["threenative-assets", "asset_search_sources", "sculpt_spec_gate"],
  ["threenative-visuals", "Budget real time for the look", "--browser-recipe webgpu"],
  ["threenative-performance", "TN_FRAME_BUDGET", "Unexecuted platforms stay unverified"],
  ["threenative-ui", "data-tn-interactive", "useUiState"],
  ["threenative-context", "ctx.pointer", "ctx.raycastAll"],
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
  await linkDependency(target, "@threenative/ui", path.resolve("packages/ui"));
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

async function linkScaffoldBuildDependencies(target: string): Promise<void> {
  await linkScaffoldDependencies(target);
  for (const name of [
    "@tailwindcss/vite",
    "@types/react",
    "@types/react-dom",
    "@vitejs/plugin-react",
    "react",
    "react-dom",
    "react-reconciler",
    "tailwindcss",
  ]) {
    await linkDependency(target, name, await findPnpmPackage(name));
  }
}

describe("template contracts", () => {
  it("requires every discovered template to ship a bounded performance scenario", async () => {
    const names = await templateNames();
    // A floor, not a pin: a kit that ships tomorrow must be covered without editing this number,
    // and a discovery that silently returned nothing must still fail.
    expect(names.length).toBeGreaterThanOrEqual(8);

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
    // One per kit, derived rather than pinned: a kit that ships two performance scenarios or none
    // is the defect this catches, and a kit added tomorrow is covered without a number to edit.
    expect(performanceAssertions, "non-empty performance assertions").toHaveLength(names.length);
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
        // PRD-222 Phase 1: the Tier 3 fps floor ships beside the ceilings.
        "minFps",
      ]);
      expect(performance.minFps, template).toBe(30);
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
    for (const template of await templateNames()) {
      const root = path.join(templateRoot, template);
      const [config, index, main, vite] = await Promise.all([
        readFile(path.join(root, "threenative.config.ts"), "utf8"),
        readFile(path.join(root, "index.html"), "utf8"),
        readFile(path.join(root, "src/main.ts"), "utf8"),
        readFile(path.join(root, "vite.config.ts"), "utf8"),
      ]);
      expect(vite, template).toContain("createWebBrandPlugin()");
      // No launch/name card in the DOM. A scaffolded game shows its own in-canvas loading
      // screen and then the game — never a branded splash with the project's name on it.
      // The owner asked for this repeatedly; the assertion is inverted so it stays gone.
      expect(index, template).not.toContain("data-threenative-launch");
      expect(index, template).not.toContain("threenative-launch-card");
      expect(main, template).not.toContain("data-threenative-launch");
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

  it("ships a generated, restyleable boot-failure surface in every template", async () => {
    for (const template of await templateNames()) {
      const root = path.join(templateRoot, template);
      const [style, main] = await Promise.all([
        readFile(path.join(root, "src/style.css"), "utf8"),
        readFile(path.join(root, "src/main.ts"), "utf8"),
      ]);
      expect(style, template).toContain('[data-threenative-canvas-error="true"]');
      expect(style, template).toMatch(/position:\s*fixed/u);
      expect(style, template).toMatch(/z-index:\s*1000/u);
      expect(style, template).toContain("overflow-wrap: anywhere");
      if (template === "minimal") {
        expect(main, template).toContain("threenative-canvas-error");
        expect(main.replace(/\s+/gu, ""), template).toContain("game.start().then");
      }
    }
  });

  it("requires the starter boot-failure screenshot to keep its error text readable", async () => {
    const scenario = JSON.parse(
      await readFile(
        path.join(templateRoot, "starter/playtests/boot-failure.playtest.json"),
        "utf8",
      ),
    ) as {
      assert?: {
        visual?: Array<{
          region?: { maxDarkPixelRatio?: number };
        }>;
      };
    };
    const maxDarkPixelRatio = scenario.assert?.visual?.[0]?.region?.maxDarkPixelRatio;

    expect(maxDarkPixelRatio).toBeDefined();
    expect(maxDarkPixelRatio).toBeGreaterThanOrEqual(0);
    expect(maxDarkPixelRatio).toBeLessThan(1);
  });

  it("declares a packaged native icon in every template config", async () => {
    for (const template of await templateNames()) {
      const root = path.join(templateRoot, template);
      const config = await readFile(path.join(root, "threenative.config.ts"), "utf8");
      expect(config, template).toMatch(/\bicon:\s*["']public\/icon\.png["']/u);
      const icon = parsePng(await readFile(path.join(root, "public/icon.png")));
      expect(icon, template).toBeDefined();
      expect(icon?.width, template).toBe(1024);
      expect(icon?.height, template).toBe(1024);
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
      for (const [file, source] of sources.filter(
        ([file]) =>
          file.includes(`${path.sep}render${path.sep}`) &&
          !file.includes(`${path.sep}render${path.sep}effects${path.sep}`),
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

  it("should keep the starter ridge on one classic Worker path with disposal", async () => {
    const [controller, worker, play] = await Promise.all([
      readFile(path.join(templateRoot, "starter/src/render/rockRidge.ts"), "utf8"),
      readFile(path.join(templateRoot, "starter/src/render/rockRidge.worker.ts"), "utf8"),
      readFile(path.join(templateRoot, "starter/src/scenes/Play.ts"), "utf8"),
    ]);
    expect(controller).toContain("new Blob");
    expect(controller).toContain("new Worker(url)");
    expect(controller).toContain("state.requestedGeneration");
    expect(controller).toContain("message.generation !== state.requestedGeneration");
    expect(controller).toContain("previous.geometry.dispose()");
    expect(controller).toContain('error.name = "TN_ROCK_RIDGE_TOPOLOGY_INVALID"');
    expect(controller).not.toContain('type: "module"');
    expect(worker).toContain("createImplicitSurfaceWorkerSource");
    expect(worker).toContain("[result.indices.buffer, result.positions.buffer]");
    expect(worker).not.toContain("@threenative/");
    expect(play).toContain("this.#scenery?.dispose()");
    expect(play).toContain('ctx.entities.add("scenery.ridge", scenery)');
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

    const contextSkill = await readFile(
      path.resolve(
        "packages/create-threenative/agent-files/.agents/skills/threenative-context/SKILL.md",
      ),
      "utf8",
    );
    expect(contextSkill).toContain("# ThreeNative context surface");
    expect(contextSkill).toContain('| `ctx.goto("<scene-name>")` |');
    expect(contextSkill).toContain("`ctx.goto(name)` rebuilds the scene without resetting state");
    expect(contextSkill).toContain("ctx.state.set({ /* copy this game's initial-state shape */ })");
    expect(contextSkill).toContain(
      '`game.goto("<scene-name>")` from React resets declared initial state first',
    );
    expect(contextSkill).toContain("deterministic only when `defineGame({ seed })` is configured");
    expect(contextSkill).toContain("goto` and then `return`");
    expect(contextSkill).not.toContain("That is your entire restart button");
    expect(contextSkill).not.toContain("probably does not exist");
    for (const template of await templateNames()) {
      const agents = await readFile(path.join(templateRoot, template, "AGENTS.md"), "utf8");
      expect(agents).toContain(".agents/skills/threenative-context/SKILL.md");
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
      // Not every kit has a horizon. An interior draws no dome at all, and demanding one there
      // would have forced `puzzle` to ship a gradient sky that read, above its walls, as a
      // hard-edged blue triangle — a hole in the room. So the rule is conditional on there being
      // a dome, and the else branch is not an escape hatch: a `sky.ts` that draws no dome must
      // still say what the horizon *is*, by setting `scene.background`. A file that does neither
      // is the defect this test was written for, and still fails.
      const drawsDome = /BackSide/u.test(source);
      if (!drawsDome) {
        expect(source, `${file}: a sky with no dome must still set scene.background`).toMatch(
          /scene\.background\s*=/u,
        );
        continue;
      }
      // A dome whose colour comes from an atmosphere node builds `MeshBasicNodeMaterial`; the
      // contract is the `fog: false` flag on whichever of the two the template chose, never the
      // class name, so matching only the non-node class would let a fogged node dome through.
      const material = /new MeshBasic(?:Node)?Material\(\{[^}]*\}\)/u.exec(source)?.[0];
      expect(material, `${file}: sky dome must build a MeshBasic(Node)Material`).toBeDefined();
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

  it("should make core the single automatic owner of external MCP dependencies", async () => {
    const packagesRoot = path.resolve("packages");
    for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(packagesRoot, entry.name, "package.json");
      const manifest = await readFile(manifestPath, "utf8").catch(() => undefined);
      for (const packageName of externalMcps) {
        if (entry.name === "core") expect(manifest ?? "", packageName).toContain(packageName);
        else expect(manifest ?? "", `${entry.name}/${packageName}`).not.toContain(packageName);
      }
    }
  });

  it("should keep the root instructions under 100 lines and move workflows into skills", async () => {
    const packageAgents = await readFile(
      path.resolve("packages/create-threenative/AGENTS.md"),
      "utf8",
    );
    expect(
      packageAgents.split(/\r?\n/u).length,
      "packages/create-threenative/AGENTS.md",
    ).toBeLessThan(100);
    for (const template of await templateNames()) {
      const agents = await readFile(path.join(templateRoot, template, "AGENTS.md"), "utf8");
      expect(agents.split(/\r?\n/u).length, `${template}/AGENTS.md`).toBeLessThan(100);
      for (const [skill, ...markers] of authoringSkills) {
        expect(agents, `${template}/${skill} Codex link`).toContain(
          `.agents/skills/${skill}/SKILL.md`,
        );
        expect(agents, `${template}/${skill} Claude link`).toContain(
          `.claude/skills/${skill}/SKILL.md`,
        );
      }
    }

    for (const [skill, ...markers] of authoringSkills) {
      const bodies = await Promise.all(
        [".agents/skills", ".claude/skills"].map(async (host) => {
          const body = await readFile(
            path.resolve("packages/create-threenative/agent-files", host, skill, "SKILL.md"),
            "utf8",
          );
          for (const marker of markers)
            expect(body, `${host}/${skill}/${marker}`).toContain(marker);
          return body;
        }),
      );
      expect(new Set(bodies).size, `${skill} host adapters drifted`).toBe(1);
    }
  });

  it("should make capability discovery a critical gate before PRD planning", async () => {
    for (const template of await templateNames()) {
      for (const file of ["AGENTS.md", "CLAUDE.md"]) {
        const instructions = await readFile(path.join(templateRoot, template, file), "utf8");
        expect(instructions, `${template}/${file}/critical gate`).toMatch(
          /critical.*(?:step|gate)/iu,
        );
        expect(instructions, `${template}/${file}/capability skill`).toContain(
          "`threenative-capabilities`",
        );
        expect(instructions, `${template}/${file}/prd skill`).toContain("`prd-creator`");
        expect(instructions, `${template}/${file}/full request`).toContain(
          "engine_search_capabilities",
        );
        expect(
          instructions.indexOf("`threenative-capabilities`"),
          `${template}/${file}/capabilities before PRD`,
        ).toBeLessThan(instructions.indexOf("`prd-creator`"));
        expect(instructions, `${template}/${file}/approval gate`).toMatch(/explicit approval/iu);
        expect(instructions, `${template}/${file}/execution handoff`).toMatch(
          /execute|implement/iu,
        );
      }
    }
  });

  it("should proactively reuse the active browser session for Fab CLI authentication", async () => {
    const skill = await readFile(
      path.resolve(
        "packages/create-threenative/agent-files/.agents/skills/threenative-assets/SKILL.md",
      ),
      "utf8",
    );
    expect(skill).toContain("fabcli auth login");
    expect(skill).toContain("Claude browser");
    expect(skill).toContain("chrome:control-chrome");
    expect(skill).toMatch(/active.*session/iu);
    expect(skill).toMatch(/never.*(?:cookie|token)|(?:cookie|token).*never/iu);
    expect(skill).toMatch(/Unreal-only/iu);
    expect(skill).toContain("`fab_import_asset`");
    expect(skill).toContain("`asset_import_unreal`");
    expect(skill).toContain("UNREAL_SOURCE_UNCOOKED");
  });

  it("should document a bounded performance assertion in every template", async () => {
    const skill = await readFile(
      path.resolve(
        "packages/create-threenative/agent-files/.agents/skills/threenative-performance/SKILL.md",
      ),
      "utf8",
    );
    expect(skill.split(/\s+/u).filter(Boolean).length).toBeLessThan(260);
    expect(skill).toContain("agent-docs/assertion-reference.md#performance");
    expect(skill).toMatch(performanceBoundPattern);
    for (const template of await templateNames()) {
      const agents = await readFile(path.join(templateRoot, template, "AGENTS.md"), "utf8");
      expect(agents, `${template}/threenative-performance`).toContain(
        ".agents/skills/threenative-performance/SKILL.md",
      );
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
    const skill = await readFile(
      path.resolve(
        "packages/create-threenative/agent-files/.agents/skills/threenative-performance/SKILL.md",
      ),
      "utf8",
    );
    expect(skill).toContain("Unexecuted platforms stay unverified");
    expect(skill).toContain(
      "Withdraw thermally-confounded Tiers 1–3 comparisons; always report Tier 4",
    );
    for (const target of expectedTargets) expect(skill).toContain(target);

    for (const template of await templateNames()) {
      const agents = await readFile(path.join(templateRoot, template, "AGENTS.md"), "utf8");
      expect(agents, `${template}/unexecuted`).toContain(
        ".agents/skills/threenative-performance/SKILL.md",
      );
    }
  });

  // P2-2: the same checker the scripts-side spec exercises on fixtures, run over the real
  // template tree. A template that grows past its measured word budget, drops a mandatory
  // inline section, names a reference page the bundle does not ship, or whose CLAUDE.md
  // mirror drifted, fails here with a diagnostic naming the defect.
  it("should keep every generated instruction pair bounded", async () => {
    const audits = await auditAllTemplates(path.resolve("."));
    // A floor, not a pin, for the same reason as the performance-scenario contract above.
    expect(audits.length).toBeGreaterThanOrEqual(8);
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
    const skillPaths = authoringSkills.flatMap(([skill]) => [
      `.agents/skills/${skill}/SKILL.md`,
      `.claude/skills/${skill}/SKILL.md`,
    ]);
    try {
      for (const template of await templateNames()) {
        const result = await createProject(
          { install: false, target: `generated-${template}`, template },
          root,
        );
        for (const file of ["AGENTS.md", "CLAUDE.md"]) {
          const docs = await readFile(path.join(result.target, file), "utf8");
          expect(docs, `${template}/${file}`).not.toMatch(/<!--\s*(?:shared:|\/shared)/u);
          expect(docs.split(/\r?\n/u).length, `${template}/${file}`).toBeLessThan(100);
          expect(docs, `${template}/${file}/critical capability gate`).toMatch(
            /critical.*(?:step|gate)/iu,
          );
          expect(
            docs.indexOf("`threenative-capabilities`"),
            `${template}/${file}/capabilities before PRD`,
          ).toBeLessThan(docs.indexOf("`prd-creator`"));
        }
        for (const relativePath of skillPaths) {
          const skill = await readFile(path.join(result.target, relativePath), "utf8");
          expect(skill, `${template}/${relativePath}`).toContain("name:");
          if (relativePath.includes("threenative-capabilities")) {
            expect(skill, `${template}/${relativePath}/planning prerequisite`).toContain(
              "critical planning prerequisite",
            );
            expect(skill, `${template}/${relativePath}/PRD handoff`).toContain("`prd-creator`");
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
    const skill = await readFile(
      path.resolve(
        "packages/create-threenative/agent-files/.agents/skills/threenative-assets/SKILL.md",
      ),
      "utf8",
    );
    const mentioned = [...skill.matchAll(/`(sculpt_[a-z0-9_]+)`/gu)].map(
      (match) => match[1] as string,
    );
    expect(mentioned.filter((name) => !served.has(name))).toEqual([]);
    for (const name of surface.recommended) expect(skill, name).toContain(name);
    for (const template of await templateNames()) {
      const agents = await readFile(path.join(templateRoot, template, "AGENTS.md"), "utf8");
      expect(agents, `${template}/threenative-assets`).toContain(
        ".agents/skills/threenative-assets/SKILL.md",
      );
    }
    const coreManifest = JSON.parse(
      await readFile(path.resolve("packages/core/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(coreManifest.dependencies?.["threenative-sculpt-mcp"]).toBe(surface.version);
  });

  it("should list @types/three in every template that runs tsc", async () => {
    for (const template of await typecheckTemplates()) {
      const packageJson = JSON.parse(
        await readFile(path.join(templateRoot, template, "package.json"), "utf8"),
      ) as { devDependencies?: Record<string, string> };
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

  // `vite build` does not typecheck, so a template can ship a red `npm run typecheck` and still
  // pass every other gate here — which is exactly what happened: the starter's render chain
  // shipped 16 errors on a scaffold nobody had edited. This runs the script the template itself
  // advertises, on a scaffold nobody has edited, against the same `three` and `@types/three` a
  // user installs. It is the only gate that reads a template the way `tsc` does.
  it("should typecheck a pristine scaffold of every template that advertises the script", async () => {
    // Every template is checked before anything is reported: stopping at the first red would
    // leave the templates after it untested, which is how a hole this size stays open.
    const failures: string[] = [];
    for (const template of await typecheckTemplates()) {
      const root = await makeTempDir(`threenative-${template}-typecheck-`);
      try {
        const result = await createProject({ install: false, target: template, template }, root);
        await linkScaffoldBuildDependencies(result.target);
        await execFileAsync("pnpm", ["typecheck"], { cwd: result.target });
      } catch (error) {
        // `tsc` names the file and line on stdout; without it the failure says only that a
        // command exited non-zero, which is not a report anyone can act on.
        const details = error as { stdout?: string; stderr?: string };
        const output = `${details.stdout ?? ""}${details.stderr ?? ""}`.trim();
        failures.push(`${template}:\n${output === "" ? String(error) : output}`);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
    expect(failures.join("\n\n")).toBe("");
  }, 180_000);

  it("should build a scaffold after deleting its optional realism effects", async () => {
    const root = await makeTempDir("threenative-optional-effects-");
    try {
      const result = await createProject(
        { install: false, target: "optional-effects", template: "starter" },
        root,
      );
      for (const file of ["lensDistortion.ts", "sparkle.ts", "gradualBackground.ts"]) {
        await rm(path.join(result.target, "src/render/effects", file));
      }
      await linkScaffoldBuildDependencies(result.target);
      const vite = await findPnpmPackage("vite");
      await execFileAsync(process.execPath, [path.join(vite, "bin/vite.js"), "build"], {
        cwd: result.target,
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 30_000);

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
