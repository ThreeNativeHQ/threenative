import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProject, parseArgs } from "../src/index.js";

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
  "src/render/materials.ts",
  "src/render/shapes.ts",
  "src/render/camera.ts",
  "src/entities/Player.ts",
  "src/ui/Hud.tsx",
  "src/ui/Menu.tsx",
  "src/ui/App.tsx",
  "src/state.ts",
  "playtest/boot-to-play.json",
  "playtests/play.playtest.json",
  "public/pickup.ogg",
];

const PLATFORMER_PATHS = [
  "AGENTS.md",
  "CLAUDE.md",
  "package.json",
  "src/main.ts",
  "src/state.ts",
  "src/scenes/Boot.ts",
  "src/scenes/Level.ts",
  "src/entities/Character.ts",
  "src/entities/Patrol.ts",
  "src/entities/Pickup.ts",
  "src/level/Checkpoints.ts",
  "src/level/Platform.ts",
  "src/render/palette.ts",
  "src/render/rig.ts",
  "src/render/sky.ts",
  "src/render/terrain.ts",
  "playtests/jump.playtest.json",
  "playtests/patrol.playtest.json",
  "playtests/collect.playtest.json",
  "playtests/stomp.playtest.json",
  "playtests/stomp-rise.playtest.json",
  "playtests/respawn.playtest.json",
  "playtests/oneway.playtest.json",
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
