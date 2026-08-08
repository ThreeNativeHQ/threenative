import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createProject, parseArgs } from "../src/index.js";

const run = promisify(execFile);

const STARTER_PATHS = [
  "AGENTS.md",
  "CLAUDE.md",
  "package.json",
  "threenative.config.ts",
  "index.html",
  "tailwind.config.ts",
  "tsconfig.json",
  "src/style.css",
  "src/main.ts",
  "src/scenes/Boot.ts",
  "src/scenes/Play.ts",
  "src/render/lighting.ts",
  "src/render/postprocessing.ts",
  "src/render/particles.ts",
  "src/render/palette.ts",
  "src/render/materials.ts",
  "src/render/shapes.ts",
  "src/render/camera.ts",
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
  "public/pickup.ogg",
];

const MINIMAL_RENDER_PATHS = [
  "src/render/palette.ts",
  "src/render/camera.ts",
  "src/render/sky.ts",
  "src/render/lighting.ts",
  "src/render/materials.ts",
  "src/render/postprocessing.ts",
] as const;

const PLATFORMER_PATHS = [
  "AGENTS.md",
  "CLAUDE.md",
  "package.json",
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
  "src/render/materials.ts",
  "src/render/rig.ts",
  "src/render/sky.ts",
  "src/render/postprocessing.ts",
  "src/render/terrain.ts",
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
        await run(path.resolve("node_modules/.bin/vite"), ["build", result.target], {
          cwd: process.cwd(),
        });
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

  it("should accept a local playtest package for scaffold smoke tests", () => {
    expect(
      parseArgs(["my-game", "--no-install", "--playtest-package", "/tmp/playtest.tgz"]),
    ).toEqual({
      install: false,
      packageSources: { "@threenative/playtest": "/tmp/playtest.tgz" },
      target: "my-game",
    });
  });
});
