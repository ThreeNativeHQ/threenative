import { execFile } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { loadConfig } from "../src/config.js";
import {
  cliHelp,
  createProject,
  discoverKitManifests,
  discoverTemplateNames,
  parseArgs,
} from "../src/index.js";

const run = promisify(execFile);

const TEMPLATE_ROOT = path.resolve("packages/create-threenative/templates");
const ASSET_MCP = "threenative-asset-mcp";
const SCULPT_MCP = "threenative-sculpt-mcp";
const ENGINE_MCP = "threenative-engine-mcp";
// Every server launches through a shim in `@threenative/core`, the one package a ThreeNative
// project always depends on directly, so the path resolves whatever the package manager did with
// the server packages themselves.
const CORE_SHIM = "./node_modules/@threenative/core/mcp";
const ALL_TEMPLATES = discoverTemplateNames(TEMPLATE_ROOT);

/** Stages a broken template in a throwaway copy of the template tree and hands the body its
 * root, so a negative control never edits the shipped templates. It used to edit them in place
 * and put them back: `createProject` resolved its own root, so there was nowhere else to stage
 * one. Vitest runs spec files in parallel, so any file scaffolding `starter` during that window
 * read a template that was broken on purpose for this one — `build.spec.ts` failed intermittently
 * on `must launch from './node_modules/', not '-y'`, a red with nothing wrong behind it.
 * `createProject` now takes a template root; the copy is this test's alone. */
async function withBrokenTemplateFile<T>(
  relativePath: string,
  content: string | undefined,
  body: (root: string) => Promise<T>,
): Promise<T> {
  const root = await makeTempDir("threenative-broken-template-");
  try {
    await cp(TEMPLATE_ROOT, root, { recursive: true });
    const file = path.join(root, relativePath);
    if (content === undefined) await rm(file);
    else await writeFile(file, content);
    return await body(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

const STARTER_PATHS = [
  // Ignores the asset compile step's generated outputs; the sources in assets/ ship.
  ".gitignore",
  ".mcp.json",
  "AGENTS.md",
  "CLAUDE.md",
  "kit.json",
  "package.json",
  "threenative.config.ts",
  "tools/look.mjs",
  "index.html",
  "tailwind.config.ts",
  "tsconfig.json",
  "src/style.css",
  "vite.config.ts",
  "src/game.ts",
  "src/main.ts",
  "src/scenes/Play.ts",
  "src/render/lighting.ts",
  "src/render/postprocessing.ts",
  "src/render/palette.ts",
  "src/render/materials.ts",
  "src/render/shapes.ts",
  "src/render/camera.ts",
  "src/render/sky.ts",
  "src/render/scenery.ts",
  "src/render/loading.ts",
  "src/entities/Crate.ts",
  "src/entities/Goal.ts",
  "src/entities/Player.ts",
  "src/ui/Hud.tsx",
  "src/ui/HudContent.tsx",
  "src/ui/Menu.tsx",
  "src/ui/NativeHud.tsx",
  "src/ui/App.tsx",
  "src/state.ts",
  "playtests/survives.playtest.json",
  "playtests/assets.playtest.json",
  "playtests/play.playtest.json",
  "playtests/forward.playtest.json",
  "native-playtests/react-hud.playtest.json",
  "playtests/coyote.playtest.json",
  "playtests/buffer.playtest.json",
  "playtests/look.playtest.json",
  "playtests/pause.playtest.json",
  "playtests/respawn.playtest.json",
  "playtests/goal.playtest.json",
  "playtests/gameover.playtest.json",
  "playtests/seed.playtest.json",
  "assets/native-proof.glb",
  "assets/native-proof.png",
  "public/icon.png",
  "assets/pickup.wav",
  // P2-2: the searchable reference bundle every generated project must ship.
  "agent-docs/assertion-reference.md",
  "agent-docs/capture-the-frame.md",
  "agent-docs/ctx-cookbook.md",
  "agent-docs/debug-surface.md",
  "agent-docs/finding-assets.md",
  "agent-docs/gameplay-recipes.md",
  "agent-docs/sculpt-from-a-reference.md",
  "agent-docs/visual-baseline.md",
];

const MINIMAL_RENDER_PATHS = [
  "src/render/palette.ts",
  "src/render/camera.ts",
  "src/render/sky.ts",
  "src/render/lighting.ts",
  "src/render/loading.ts",
  "src/render/hud.ts",
  "src/render/materials.ts",
  "src/render/postprocessing.ts",
] as const;

const PLATFORMER_PATHS = [
  "AGENTS.md",
  "CLAUDE.md",
  "kit.json",
  "package.json",
  "threenative.config.ts",
  "src/game.ts",
  "src/main.ts",
  "src/state.ts",
  "src/scenes/Boot.ts",
  "src/scenes/Level.ts",
  "src/entities/Character.ts",
  "src/entities/Chaser.ts",
  "src/entities/Patrol.ts",
  "src/entities/Pickup.ts",
  "src/level/Checkpoints.ts",
  "src/level/Platform.ts",
  "src/render/palette.ts",
  "src/render/camera.ts",
  "src/render/lighting.ts",
  "src/render/loading.ts",
  "src/render/materials.ts",
  "src/render/rig.ts",
  "src/render/sky.ts",
  "src/render/postprocessing.ts",
  "src/render/terrain.ts",
  "public/icon.png",
  "playtests/jump.playtest.json",
  "playtests/patrol.playtest.json",
  "playtests/collect.playtest.json",
  "playtests/stomp.playtest.json",
  "playtests/stomp-rise.playtest.json",
  "playtests/respawn.playtest.json",
  "playtests/oneway.playtest.json",
  "playtests/collision-layers.playtest.json",
  "playtests/chase.playtest.json",
  "playtests/avoidance.playtest.json",
  "playtests/performance.playtest.json",
  "playtests/terminal-loop-win.playtest.json",
  "playtests/terminal-loop-fail.playtest.json",
  "playtests/native/touch-controls.playtest.json",
];

describe("create-threenative", () => {
  it("discovers manifests and generates its template help from them", () => {
    const manifests = discoverKitManifests(TEMPLATE_ROOT);
    expect(manifests.map(({ name }) => name)).toEqual(
      [...manifests].map(({ name }) => name).sort(),
    );
    for (const name of ["minimal", "platformer", "starter"]) {
      expect(manifests.some((manifest) => manifest.name === name)).toBe(true);
    }
    expect(manifests.find(({ name }) => name === "platformer")).toMatchObject({
      blurb: expect.any(String),
      genre: "platformer",
      kit: true,
      title: "Platformer",
    });
    const help = cliHelp();
    expect(help).toContain("Templates:");
    const width = Math.max(...manifests.map(({ name }) => name.length));
    for (const manifest of manifests) {
      expect(help).toContain(
        `${manifest.name.padEnd(width)}  ${manifest.title}: ${manifest.blurb}`,
      );
    }
  });

  // P2-2: the bounded instructions name long recipes by their shipped path. This is the
  // generated-project check behind the "omit reference copying" negative control: with
  // `copyReferenceBundle` removed from `createProject`, the scaffold itself throws
  // `RED observed: referenced recipe missing` before this body ever runs.
  it("should copy bounded references with project placeholders", async () => {
    const root = await makeTempDir("threenative-reference-bundle-");
    try {
      const result = await createProject(
        { install: false, target: "my-game", template: "starter" },
        root,
      );
      const bundleDirectory = path.join(result.target, "agent-docs");
      const shipped = (await readdir(bundleDirectory)).sort();
      expect(shipped).toEqual([
        "assertion-reference.md",
        "capability-reference.md",
        "capture-the-frame.md",
        "ctx-cookbook.md",
        "debug-surface.md",
        "finding-assets.md",
        "gameplay-recipes.md",
        "mobile-memory-budget.md",
        "sculpt-from-a-reference.md",
        "visual-baseline.md",
      ]);
      for (const file of shipped) {
        const page = await readFile(path.join(bundleDirectory, file), "utf8");
        expect(page, file).not.toContain("__PROJECT_NAME__");
        expect(page, file).not.toContain("__PROJECT_ID__");
      }
      const agents = await readFile(path.join(result.target, "AGENTS.md"), "utf8");
      expect(agents).toContain("`agent-docs/finding-assets.md`");
      for (const file of shipped) {
        // Every path the instructions name must resolve inside the generated project.
        expect(agents, file).toContain(`agent-docs/${file}`);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("should generate the starter tree without catalog protocols", async () => {
    const root = await makeTempDir("threenative-scaffold-");
    try {
      const result = await createProject(
        { install: false, target: "my-game", template: "starter" },
        root,
      );
      expect(result.template).toBe("starter");
      const packageJson = await readFile(path.join(result.target, "package.json"), "utf8");
      expect(packageJson).not.toContain("catalog:");
      expect(STARTER_PATHS).toContain("playtests/survives.playtest.json");
      for (const relativePath of STARTER_PATHS) {
        await expect(
          readFile(path.join(result.target, relativePath), "utf8"),
        ).resolves.toBeTruthy();
      }
      // A scaffolded project must land with audio every target can decode, WAV included, or its
      // first `--target android` build installs and shows nothing.
      const pickupAudio = await readFile(path.join(result.target, "assets/pickup.wav"));
      expect(pickupAudio.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(pickupAudio.subarray(8, 12).toString("ascii")).toBe("WAVE");
      const agents = await readFile(path.join(result.target, "AGENTS.md"), "utf8");
      expect(agents).toContain("my-game");
      expect(agents).not.toContain("__PROJECT_NAME__");
      await expect(readFile(path.join(result.target, "CLAUDE.md"), "utf8")).resolves.toContain(
        "Generated mirror of AGENTS.md",
      );
      await expect(
        readFile(path.join(result.target, "src/entities/Player.ts"), "utf8"),
      ).resolves.toContain("debug()");
      await expect(
        readFile(path.join(result.target, "src/scenes/Play.ts"), "utf8"),
      ).resolves.toContain('ctx.entities.add("player"');
      const renderFiles = await Promise.all(
        ["lighting.ts", "postprocessing.ts", "materials.ts"].map((file) =>
          readFile(path.join(result.target, "src/render", file), "utf8"),
        ),
      );
      expect(renderFiles.join("\n")).not.toContain("@threenative/");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // The compile step owns public/'s generated outputs; the sources ship in assets/. With no
  // raw copy left in public/, any dev server or build must compile first — which is what
  // playtests/assets.playtest.json proves against a served game.
  it("should ship source assets and never scaffold an empty assets directory", async () => {
    const root = await makeTempDir("threenative-scaffold-assets-");
    try {
      const result = await createProject(
        { install: false, target: "my-game", template: "starter" },
        root,
      );
      await expect(
        readFile(path.join(result.target, "assets/native-proof.glb")),
      ).resolves.toBeTruthy();
      const gitignore = await readFile(path.join(result.target, ".gitignore"), "utf8");
      expect(gitignore).toContain("public/assets.manifest.json");
      for (const absent of ["assets/.gitkeep", "public/assets.manifest.json"]) {
        await expect(stat(path.join(result.target, absent))).rejects.toThrow();
      }
      // The packed CLI itself depends on @threenative/assets, so a local-pack install needs a
      // pnpm override per provided source, not just a rewritten direct pin.
      const sourced = await createProject(
        {
          install: false,
          packageSources: {
            "@threenative/assets": "/tmp/assets.tgz",
            "create-threenative": "/tmp/cli.tgz",
          },
          target: "sourced-game",
          template: "starter",
        },
        root,
      );
      const sourcedManifest = JSON.parse(
        await readFile(path.join(sourced.target, "package.json"), "utf8"),
      ) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        pnpm?: { overrides?: Record<string, string> };
      };
      expect(sourcedManifest.devDependencies?.["@threenative/assets"]).toBe("file:/tmp/assets.tgz");
      expect(sourcedManifest.dependencies?.["@threenative/assets"]).toBeUndefined();
      expect(sourcedManifest.pnpm?.overrides).toMatchObject({
        "@threenative/assets": "file:/tmp/assets.tgz",
        "create-threenative": "file:/tmp/cli.tgz",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should generate loader-valid identifiers at the leading-digit boundary", async () => {
    const root = await makeTempDir("threenative-scaffold-identifiers-");
    try {
      for (const [target, expectedId] of [
        ["123-game", "com.threenative.game123game"],
        ["fox-game", "com.threenative.foxgame"],
      ] as const) {
        const result = await createProject({ install: false, target, template: "minimal" }, root);
        await expect(loadConfig(result.target)).resolves.toMatchObject({
          app: { id: expectedId },
        });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should scaffold the minimal six-file render layer", async () => {
    const root = await makeTempDir("threenative-minimal-render-");
    try {
      const result = await createProject(
        { install: false, target: "minimal-look", template: "minimal" },
        root,
      );
      for (const relativePath of MINIMAL_RENDER_PATHS) {
        await expect(
          readFile(path.join(result.target, relativePath), "utf8"),
        ).resolves.toBeTruthy();
      }
      await expect(readFile(path.join(result.target, "src/game.ts"), "utf8")).resolves.toContain(
        "export default game",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should not ship recast in a build that never imports the navigation entry", async () => {
    const root = await makeTempDir("threenative-minimal-bundle-");
    try {
      const result = await createProject(
        { install: false, target: "minimal-bundle", template: "minimal" },
        root,
      );
      const scope = path.join(result.target, "node_modules", "@threenative");
      await mkdir(scope, { recursive: true });
      await symlink(path.resolve("packages/core"), path.join(scope, "core"), "dir");
      await symlink(path.resolve("packages/physics"), path.join(scope, "physics"), "dir");
      // The template vite.config.ts imports watchAssets from @threenative/assets in serve
      // mode; a build that resolves the config needs the package present to reject it.
      await symlink(path.resolve("packages/assets"), path.join(scope, "assets"), "dir");
      await symlink(
        path.resolve("packages/create-threenative"),
        path.join(result.target, "node_modules", "create-threenative"),
        "dir",
      );
      const pnpmPackages = await readdir(path.resolve("node_modules/.pnpm"));
      const vitePackage = pnpmPackages.find((entry) => entry.startsWith("vite@"));
      const threePackage = pnpmPackages.find((entry) => entry.startsWith("three@"));
      if (vitePackage === undefined || threePackage === undefined) {
        throw new Error("Bundle isolation requires the workspace Vite and Three.js packages.");
      }
      await symlink(
        path.resolve("node_modules/.pnpm", vitePackage, "node_modules/vite"),
        path.join(result.target, "node_modules", "vite"),
        "dir",
      );
      await symlink(
        path.resolve("node_modules/.pnpm", threePackage, "node_modules/three"),
        path.join(result.target, "node_modules", "three"),
        "dir",
      );
      try {
        const viteCli = path.resolve(
          "node_modules/.pnpm",
          vitePackage,
          "node_modules/vite/bin/vite.js",
        );
        await run(process.execPath, [viteCli, "build", result.target], { cwd: process.cwd() });
      } catch (error) {
        const output = error as { code?: string | number; stderr?: string; stdout?: string };
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} code=${output.code ?? "unknown"}\n${output.stdout ?? ""}\n${output.stderr ?? ""}`,
        );
      }
      const distRoot = path.join(result.target, "dist");
      const entries = await readdir(distRoot, { recursive: true });
      const files = (
        await Promise.all(
          entries.map(async (entry) => {
            const relativePath = String(entry);
            return (await stat(path.join(distRoot, relativePath))).isFile()
              ? relativePath
              : undefined;
          }),
        )
      ).filter((entry): entry is string => entry !== undefined);
      const artifactNames = files.filter((file) => file.toLowerCase().includes("recast"));
      const contents = await Promise.all(
        files.map(async (file) => {
          const value = await readFile(path.join(result.target, "dist", file));
          return value.toString("utf8");
        }),
      );

      expect(artifactNames).toEqual([]);
      expect(contents.join("\n")).not.toMatch(/recast-navigation|@recast-navigation/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  it("should parse the no-install and template flags", () => {
    expect(parseArgs(["my-game", "--template", "minimal", "--no-install"])).toEqual({
      install: false,
      target: "my-game",
      template: "minimal",
    });
  });

  it("should scaffold the platformer template with no catalog protocols", async () => {
    const root = await makeTempDir("threenative-platformer-");
    try {
      const result = await createProject(
        { install: false, target: "fox-run", template: "platformer" },
        root,
      );
      expect(result.template).toBe("platformer");
      const packageJson = await readFile(path.join(result.target, "package.json"), "utf8");
      expect(packageJson).not.toContain("catalog:");
      for (const relativePath of PLATFORMER_PATHS) {
        await expect(
          readFile(path.join(result.target, relativePath), "utf8"),
        ).resolves.toBeTruthy();
      }
      await expect(
        readFile(path.join(result.target, "src/entities/Character.ts"), "utf8"),
      ).resolves.toContain("PLATFORMER_FEEL");
      await expect(
        readFile(path.join(result.target, "src/scenes/Level.ts"), "utf8"),
      ).resolves.toContain('ctx.entities.add("player"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should launch all three MCP servers through the core shims", async () => {
    const root = await makeTempDir("threenative-mcp-");
    try {
      const result = await createProject(
        { install: false, target: "my-game", template: "starter" },
        root,
      );
      const raw = await readFile(path.join(result.target, ".mcp.json"), "utf8");
      expect(raw).not.toContain("npx");
      const config = JSON.parse(raw) as {
        mcpServers: Record<string, { args: string[]; command: string }>;
      };
      const assetServer = config.mcpServers["threenative-assets"];
      expect(assetServer?.command).toBe("node");
      expect(assetServer?.args[0]).toBe(`${CORE_SHIM}/assets.mjs`);
      const sculptServer = config.mcpServers["threenative-sculpt"];
      expect(sculptServer?.command).toBe("node");
      expect(sculptServer?.args[0]).toBe(`${CORE_SHIM}/sculpt.mjs`);
      const engineServer = config.mcpServers["threenative-engine"];
      expect(engineServer?.command).toBe("node");
      expect(engineServer?.args[0]).toBe(`${CORE_SHIM}/engine.mjs`);
      const manifest = JSON.parse(
        await readFile(path.join(result.target, "package.json"), "utf8"),
      ) as { devDependencies?: Record<string, string> };
      expect(manifest.devDependencies?.[ASSET_MCP]).toBeDefined();
      expect(manifest.devDependencies?.[SCULPT_MCP]).toBe("0.1.0");
      expect(manifest.devDependencies?.[ENGINE_MCP]).toBe("0.2.0");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should ship the same MCP config and pins in every template", async () => {
    const configs = await Promise.all(
      ALL_TEMPLATES.map((template) => readFile(path.join(TEMPLATE_ROOT, template, ".mcp.json"))),
    );
    const pins = await Promise.all(
      ALL_TEMPLATES.map(async (template) => {
        const manifest = JSON.parse(
          await readFile(path.join(TEMPLATE_ROOT, template, "package.json"), "utf8"),
        ) as { devDependencies?: Record<string, string> };
        return {
          asset: manifest.devDependencies?.[ASSET_MCP],
          engine: manifest.devDependencies?.[ENGINE_MCP],
          sculpt: manifest.devDependencies?.[SCULPT_MCP],
        };
      }),
    );
    expect(new Set(configs.map((config) => config.toString("utf8"))).size).toBe(1);
    expect(pins[0]?.asset).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(new Set(pins.map(({ asset }) => asset)).size, JSON.stringify(pins)).toBe(1);
    expect(pins[0]?.sculpt).toBe("0.1.0");
    expect(new Set(pins.map(({ sculpt }) => sculpt)).size, JSON.stringify(pins)).toBe(1);
    expect(pins[0]?.engine).toBe("0.2.0");
    expect(new Set(pins.map(({ engine }) => engine)).size, JSON.stringify(pins)).toBe(1);
  });

  it("should document only tools the pinned asset MCP actually serves", async () => {
    const surface = JSON.parse(
      await readFile(path.resolve("packages/create-threenative/asset-mcp-tools.json"), "utf8"),
    ) as { recommended: string[]; tools: string[]; version: string };
    const served = new Set(surface.tools);
    const namespaces = new Set(surface.tools.map((tool) => tool.split("_")[0]));
    for (const template of ALL_TEMPLATES) {
      const agents = await readFile(path.join(TEMPLATE_ROOT, template, "AGENTS.md"), "utf8");
      const mentioned = [...agents.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/gu)]
        .map((match) => match[1] as string)
        .filter((name) => namespaces.has(name.split("_")[0] as string));
      expect(
        mentioned.filter((name) => !served.has(name)),
        template,
      ).toEqual([]);
      for (const name of surface.recommended) expect(agents, `${template}/${name}`).toContain(name);
      const manifest = JSON.parse(
        await readFile(path.join(TEMPLATE_ROOT, template, "package.json"), "utf8"),
      ) as { devDependencies?: Record<string, string> };
      expect(manifest.devDependencies?.[ASSET_MCP], template).toBe(surface.version);
    }
  });

  it("should throw when .mcp.json is missing from the template", async () => {
    const root = await makeTempDir("threenative-mcp-missing-");
    try {
      await withBrokenTemplateFile("starter/.mcp.json", undefined, async (templates) => {
        await expect(
          createProject(
            { install: false, target: "my-game", template: "starter" },
            root,
            templates,
          ),
        ).rejects.toThrow(/no \.mcp\.json/u);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    // Copies every template tree into a temp dir, which is thousands of files; the 5 s default
    // trips on a loaded machine and reports a timeout where there is no defect.
  }, 30_000);

  it("should throw when .mcp.json omits the sculpt server", async () => {
    const root = await makeTempDir("threenative-mcp-sculpt-missing-");
    try {
      const broken = JSON.stringify({
        mcpServers: {
          "threenative-assets": {
            command: "node",
            args: [`${CORE_SHIM}/assets.mjs`],
          },
        },
      });
      await withBrokenTemplateFile("starter/.mcp.json", broken, async (templates) => {
        await expect(
          createProject(
            { install: false, target: "my-game", template: "starter" },
            root,
            templates,
          ),
        ).rejects.toThrow(/missing required MCP server 'threenative-sculpt'/u);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    // Copies every template tree into a temp dir, which is thousands of files; the 5 s default
    // trips on a loaded machine and reports a timeout where there is no defect.
  }, 30_000);

  it("should throw when .mcp.json omits the engine server", async () => {
    const root = await makeTempDir("threenative-mcp-engine-missing-");
    try {
      const broken = JSON.stringify({
        mcpServers: {
          "threenative-assets": {
            command: "node",
            args: [`${CORE_SHIM}/assets.mjs`],
          },
          "threenative-sculpt": {
            command: "node",
            args: [`${CORE_SHIM}/sculpt.mjs`],
          },
        },
      });
      await withBrokenTemplateFile("starter/.mcp.json", broken, async (templates) => {
        await expect(
          createProject(
            { install: false, target: "my-game", template: "starter" },
            root,
            templates,
          ),
        ).rejects.toThrow(/missing required MCP server 'threenative-engine'/u);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("should throw when .mcp.json names a package the project does not depend on", async () => {
    const root = await makeTempDir("threenative-mcp-undeclared-");
    try {
      const broken = JSON.stringify({
        mcpServers: {
          "threenative-assets": {
            command: "node",
            args: [`${CORE_SHIM}/assets.mjs`],
          },
          "threenative-sculpt": {
            command: "node",
            args: ["./node_modules/not-a-dependency/dist/index.js"],
          },
          "threenative-engine": {
            command: "node",
            args: [`${CORE_SHIM}/engine.mjs`],
          },
        },
      });
      await withBrokenTemplateFile("starter/.mcp.json", broken, async (templates) => {
        await expect(
          createProject(
            { install: false, target: "my-game", template: "starter" },
            root,
            templates,
          ),
        ).rejects.toThrow(/not-a-dependency.*does not depend on/u);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    // Copies every template tree into a temp dir, which is thousands of files; the 5 s default
    // trips on a loaded machine and reports a timeout where there is no defect.
  }, 30_000);

  it("should throw when .mcp.json launches an unpinned remote package", async () => {
    const root = await makeTempDir("threenative-mcp-npx-");
    try {
      const broken = JSON.stringify({
        mcpServers: {
          "threenative-assets": {
            command: "node",
            args: [`${CORE_SHIM}/assets.mjs`],
          },
          "threenative-sculpt": { command: "npx", args: ["-y", SCULPT_MCP] },
          "threenative-engine": {
            command: "node",
            args: [`${CORE_SHIM}/engine.mjs`],
          },
        },
      });
      await withBrokenTemplateFile("starter/.mcp.json", broken, async (templates) => {
        await expect(
          createProject(
            { install: false, target: "my-game", template: "starter" },
            root,
            templates,
          ),
        ).rejects.toThrow(/must launch from '\.\/node_modules\/'/u);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    // Copies every template tree into a temp dir, which is thousands of files; the 5 s default
    // trips on a loaded machine and reports a timeout where there is no defect.
  }, 30_000);

  it("should accept a local playtest package for scaffold smoke tests", () => {
    expect(
      parseArgs(["my-game", "--no-install", "--playtest-package", "/tmp/playtest.tgz"]),
    ).toEqual({
      install: false,
      packageSources: { "@threenative/playtest": "/tmp/playtest.tgz" },
      target: "my-game",
    });
  });

  it("should accept a local engine MCP package for offline scaffold tests", () => {
    expect(
      parseArgs(["my-game", "--no-install", "--engine-mcp-package", "/tmp/engine-mcp.tgz"]),
    ).toEqual({
      install: false,
      packageSources: { "threenative-engine-mcp": "/tmp/engine-mcp.tgz" },
      target: "my-game",
    });
  });

  it("should accept the short local runtime package override", () => {
    expect(parseArgs(["my-game", "--no-install", "--runtime-package", "/tmp/runtime.tgz"])).toEqual(
      {
        install: false,
        packageSources: { "@threenative/runtime-native": "/tmp/runtime.tgz" },
        target: "my-game",
      },
    );
  });

  it("should keep a local native runtime optional", async () => {
    const root = await makeTempDir("threenative-local-runtime-");
    try {
      const result = await createProject(
        {
          install: false,
          packageSources: { "@threenative/runtime-native": "/tmp/runtime.tgz" },
          target: "my-game",
        },
        root,
      );
      const manifest = JSON.parse(await readFile(path.join(result.target, "package.json"), "utf8"));
      expect(manifest.optionalDependencies["@threenative/runtime-native"]).toBe(
        "file:/tmp/runtime.tgz",
      );
      expect(manifest.dependencies["@threenative/runtime-native"]).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
