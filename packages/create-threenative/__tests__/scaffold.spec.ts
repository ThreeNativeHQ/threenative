import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createProject, parseArgs } from "../src/index.js";

const run = promisify(execFile);

const TEMPLATE_ROOT = path.resolve("packages/create-threenative/templates");
const ASSET_MCP = "threenative-asset-mcp";
const SCULPT_MCP = "threenative-sculpt-mcp";
const ALL_TEMPLATES = ["starter", "minimal", "platformer"] as const;

/** Edits a template in place, runs the body, and always puts the file back. The scaffolder
 * resolves its own template root, so a negative control cannot be staged anywhere else. */
async function withBrokenTemplateFile<T>(
  relativePath: string,
  content: string | undefined,
  body: () => Promise<T>,
): Promise<T> {
  const file = path.join(TEMPLATE_ROOT, relativePath);
  const original = await readFile(file, "utf8");
  try {
    if (content === undefined) await rm(file);
    else await writeFile(file, content);
    return await body();
  } finally {
    await writeFile(file, original);
  }
}

const STARTER_PATHS = [
  ".mcp.json",
  "AGENTS.md",
  "CLAUDE.md",
  "package.json",
  "threenative.config.ts",
  "index.html",
  "tailwind.config.ts",
  "tsconfig.json",
  "src/style.css",
  "src/game.ts",
  "src/main.ts",
  "src/scenes/Boot.ts",
  "src/scenes/Play.ts",
  "src/render/lighting.ts",
  "src/render/loading.ts",
  "src/render/hud.ts",
  "src/render/postprocessing.ts",
  "src/render/particles.ts",
  "src/render/palette.ts",
  "src/render/materials.ts",
  "src/render/shapes.ts",
  "src/render/camera.ts",
  "src/pick.ts",
  "src/render/sky.ts",
  "src/entities/Crate.ts",
  "src/entities/Player.ts",
  "src/ui/Hud.tsx",
  "src/ui/Menu.tsx",
  "src/ui/App.tsx",
  "src/state.ts",
  "playtest/boot-to-play.json",
  "playtests/play.playtest.json",
  "playtests/forward.playtest.json",
  "playtests/coyote.playtest.json",
  "playtests/buffer.playtest.json",
  "playtests/look.playtest.json",
  "playtests/pause.playtest.json",
  "playtests/respawn.playtest.json",
  "playtests/seed.playtest.json",
  "playtests/pick.playtest.json",
  "public/native-proof.glb",
  "public/native-proof.png",
  "public/icon.png",
  "public/pickup.ogg",
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
  "src/render/hud.ts",
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
  "playtests/physics.playtest.json",
];

describe("create-threenative", () => {
  it("should generate the starter tree without catalog protocols", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "threenative-scaffold-"));
    try {
      const result = await createProject(
        { install: false, target: "my-game", template: "starter" },
        root,
      );
      expect(result.template).toBe("starter");
      const packageJson = await readFile(path.join(result.target, "package.json"), "utf8");
      expect(packageJson).not.toContain("catalog:");
      for (const relativePath of STARTER_PATHS) {
        await expect(
          readFile(path.join(result.target, relativePath), "utf8"),
        ).resolves.toBeTruthy();
      }
      const pickupAudio = await readFile(path.join(result.target, "public/pickup.ogg"));
      expect(pickupAudio.subarray(0, 4).toString("ascii")).toBe("OggS");
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

  it("should generate loader-valid identifiers at the leading-digit boundary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "threenative-scaffold-identifiers-"));
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
    const root = await mkdtemp(path.join(os.tmpdir(), "threenative-minimal-render-"));
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
    const root = await mkdtemp(path.join(os.tmpdir(), "threenative-minimal-bundle-"));
    try {
      const result = await createProject(
        { install: false, target: "minimal-bundle", template: "minimal" },
        root,
      );
      const scope = path.join(result.target, "node_modules", "@threenative");
      await mkdir(scope, { recursive: true });
      await symlink(path.resolve("packages/core"), path.join(scope, "core"), "dir");
      await symlink(path.resolve("packages/physics"), path.join(scope, "physics"), "dir");
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
    const root = await mkdtemp(path.join(os.tmpdir(), "threenative-platformer-"));
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

  it("should launch both MCP servers from the project's own node_modules", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "threenative-mcp-"));
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
      expect(assetServer?.args[0]).toBe(`./node_modules/${ASSET_MCP}/dist/index.js`);
      const sculptServer = config.mcpServers["threenative-sculpt"];
      expect(sculptServer?.command).toBe("node");
      expect(sculptServer?.args[0]).toBe(`./node_modules/${SCULPT_MCP}/dist/server.js`);
      const manifest = JSON.parse(
        await readFile(path.join(result.target, "package.json"), "utf8"),
      ) as { devDependencies?: Record<string, string> };
      expect(manifest.devDependencies?.[ASSET_MCP]).toBeDefined();
      expect(manifest.devDependencies?.[SCULPT_MCP]).toBe("0.1.0");
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
          sculpt: manifest.devDependencies?.[SCULPT_MCP],
        };
      }),
    );
    expect(new Set(configs.map((config) => config.toString("utf8"))).size).toBe(1);
    expect(pins[0]?.asset).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(new Set(pins.map(({ asset }) => asset)).size, JSON.stringify(pins)).toBe(1);
    expect(pins[0]?.sculpt).toBe("0.1.0");
    expect(new Set(pins.map(({ sculpt }) => sculpt)).size, JSON.stringify(pins)).toBe(1);
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
    const root = await mkdtemp(path.join(os.tmpdir(), "threenative-mcp-missing-"));
    try {
      await withBrokenTemplateFile("starter/.mcp.json", undefined, async () => {
        await expect(
          createProject({ install: false, target: "my-game", template: "starter" }, root),
        ).rejects.toThrow(/no \.mcp\.json/u);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should throw when .mcp.json omits the sculpt server", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "threenative-mcp-sculpt-missing-"));
    try {
      const broken = JSON.stringify({
        mcpServers: {
          "threenative-assets": {
            command: "node",
            args: [`./node_modules/${ASSET_MCP}/dist/index.js`],
          },
        },
      });
      await withBrokenTemplateFile("starter/.mcp.json", broken, async () => {
        await expect(
          createProject({ install: false, target: "my-game", template: "starter" }, root),
        ).rejects.toThrow(/missing required MCP server 'threenative-sculpt'/u);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should throw when .mcp.json names a package the project does not depend on", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "threenative-mcp-undeclared-"));
    try {
      const broken = JSON.stringify({
        mcpServers: {
          "threenative-assets": {
            command: "node",
            args: [`./node_modules/${ASSET_MCP}/dist/index.js`],
          },
          "threenative-sculpt": {
            command: "node",
            args: ["./node_modules/not-a-dependency/dist/index.js"],
          },
        },
      });
      await withBrokenTemplateFile("starter/.mcp.json", broken, async () => {
        await expect(
          createProject({ install: false, target: "my-game", template: "starter" }, root),
        ).rejects.toThrow(/not-a-dependency.*does not depend on/u);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should throw when .mcp.json launches an unpinned remote package", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "threenative-mcp-npx-"));
    try {
      const broken = JSON.stringify({
        mcpServers: {
          "threenative-assets": {
            command: "node",
            args: [`./node_modules/${ASSET_MCP}/dist/index.js`],
          },
          "threenative-sculpt": { command: "npx", args: ["-y", SCULPT_MCP] },
        },
      });
      await withBrokenTemplateFile("starter/.mcp.json", broken, async () => {
        await expect(
          createProject({ install: false, target: "my-game", template: "starter" }, root),
        ).rejects.toThrow(/must launch from '\.\/node_modules\/'/u);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should accept a local playtest package for scaffold smoke tests", () => {
    expect(
      parseArgs(["my-game", "--no-install", "--playtest-package", "/tmp/playtest.tgz"]),
    ).toEqual({
      install: false,
      packageSources: { "@threenative/playtest": "/tmp/playtest.tgz" },
      target: "my-game",
    });
  });

  it("should keep a local native runtime optional", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "threenative-local-runtime-"));
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
