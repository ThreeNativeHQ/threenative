import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DURABLE_PLAYTEST_TEMPLATES = [
  "starter",
  "minimal",
  "platformer",
  "action-rpg",
  "defense",
  "racing",
  "shooter",
] as const;

describe("starter playtest proof", () => {
  it.each(DURABLE_PLAYTEST_TEMPLATES)(
    "should name survives as the durable scenario in the %s guide",
    async (template) => {
      const guide = await readFile(
        path.resolve(`packages/create-threenative/templates/${template}/AGENTS.md`),
        "utf8",
      );

      expect(guide).toContain("playtests/survives.playtest.json");
    },
  );

  it.each(DURABLE_PLAYTEST_TEMPLATES)(
    "should drive the registered player with input in the %s durable scenario",
    async (template) => {
      const scenario = JSON.parse(
        await readFile(
          path.resolve(
            `packages/create-threenative/templates/${template}/playtests/survives.playtest.json`,
          ),
          "utf8",
        ),
      ) as {
        assert?: { movement?: { entity?: string; minDistance?: number } };
        steps?: Array<{ holdFrames?: number; holdTicks?: number; kind?: string; press?: string }>;
        subject?: string;
      };

      const inputStep = scenario.steps?.find(
        (step) => step.kind === "input" && step.press === "ArrowUp",
      );
      expect(scenario.subject).toBe("player");
      expect(scenario.assert?.movement?.entity).toBe("player");
      expect(scenario.assert?.movement?.minDistance).toBeGreaterThan(0);
      expect(inputStep).toMatchObject({ kind: "input", press: "ArrowUp" });
      expect(inputStep?.holdTicks ?? inputStep?.holdFrames).toBeGreaterThan(0);
    },
  );

  it("should register defense's input-controlled player subject", async () => {
    const scene = await readFile(
      path.resolve("packages/create-threenative/templates/defense/src/scenes/Defense.ts"),
      "utf8",
    );
    const player = await readFile(
      path.resolve("packages/create-threenative/templates/defense/src/entities/Player.ts"),
      "utf8",
    );
    const game = await readFile(
      path.resolve("packages/create-threenative/templates/defense/src/game.ts"),
      "utf8",
    );

    expect(scene).toContain('ctx.entities.add("player", player)');
    expect(scene).toContain("player.update(frameCtx, dt)");
    expect(player).toContain('ctx.input.vector("move")');
    expect(game).toContain("move: {");
  });

  it("should run survives first", async () => {
    const packageJson = JSON.parse(
      await readFile(
        path.resolve("packages/create-threenative/templates/starter/package.json"),
        "utf8",
      ),
    ) as { scripts: { test: string } };

    const survivesIndex = packageJson.scripts.test.indexOf("playtests/survives.playtest.json");
    const playIndex = packageJson.scripts.test.indexOf("playtests/play.playtest.json");

    expect(survivesIndex).toBeGreaterThanOrEqual(0);
    expect(playIndex).toBeGreaterThanOrEqual(0);
    expect(survivesIndex).toBeLessThan(playIndex);
  });

  it("should contain a loadable movement and score scenario", async () => {
    const scenario = await readFile(
      path.resolve("packages/create-threenative/templates/starter/playtests/play.playtest.json"),
      "utf8",
    );
    const parsed = JSON.parse(scenario) as {
      assert: {
        diagnostics: { noConsoleErrors: boolean; noNetworkErrors: boolean; runtimeReady: boolean };
        resources: unknown[];
      };
      steps: Array<{ press?: string }>;
    };
    const player = await readFile(
      path.resolve("packages/create-threenative/templates/starter/src/entities/Player.ts"),
      "utf8",
    );
    expect(parsed.steps[0]?.press).toBe("ArrowRight");
    expect(parsed.assert.diagnostics).toEqual({
      noConsoleErrors: true,
      noNetworkErrors: true,
      runtimeReady: true,
    });
    expect(parsed.assert.resources).toEqual([
      { id: "GameState", path: "score", gte: 1, changed: true },
    ]);
    expect(player).toContain('ctx.input.vector("move")');
  });

  it("should run the chase scenario in the platformer test chain", async () => {
    const packageJson = JSON.parse(
      await readFile(
        path.resolve("packages/create-threenative/templates/platformer/package.json"),
        "utf8",
      ),
    ) as { scripts: { "test:playtest": string; "test:terminal-loop": string } };
    const scenario = JSON.parse(
      await readFile(
        path.resolve(
          "packages/create-threenative/templates/platformer/playtests/chase.playtest.json",
        ),
        "utf8",
      ),
    ) as {
      warmupFrames: number;
      assert: {
        diagnostics: { noConsoleErrors: boolean; runtimeReady: boolean };
        movement: {
          pathLength: number;
          reachesPositionWithin: { maxDistance: number; position: number[] };
        };
      };
    };
    const avoidance = JSON.parse(
      await readFile(
        path.resolve(
          "packages/create-threenative/templates/platformer/playtests/avoidance.playtest.json",
        ),
        "utf8",
      ),
    ) as { warmupFrames: number };

    expect(packageJson.scripts["test:playtest"]).toContain("chase.playtest.json");
    expect(packageJson.scripts["test:terminal-loop"]).toContain("terminal-loop-win.playtest.json");
    expect(packageJson.scripts["test:terminal-loop"]).toContain("terminal-loop-fail.playtest.json");
    expect([scenario.warmupFrames, avoidance.warmupFrames]).toEqual([0, 0]);
    expect(scenario.assert.diagnostics).toEqual({ noConsoleErrors: true, runtimeReady: true });
    expect(scenario.assert.movement).toMatchObject({
      pathLength: 6,
      reachesPositionWithin: { maxDistance: 1.2, position: [0, 0.66, 0] },
    });
  });

  it("should run a load-bearing platformer physics assertion", async () => {
    const packageJson = JSON.parse(
      await readFile(
        path.resolve("packages/create-threenative/templates/platformer/package.json"),
        "utf8",
      ),
    ) as { scripts: { "test:playtest": string } };
    const scenario = JSON.parse(
      await readFile(
        path.resolve(
          "packages/create-threenative/templates/platformer/playtests/physics.playtest.json",
        ),
        "utf8",
      ),
    ) as {
      assert: { settled: Array<{ atStep: string; entity: string; minBodies: number }> };
      steps: Array<{ label: string }>;
    };

    expect(packageJson.scripts["test:playtest"]).toContain("physics.playtest.json");
    expect(scenario.steps).toContainEqual(expect.objectContaining({ label: "settled" }));
    expect(scenario.assert.settled).toEqual([{ atStep: "settled", entity: "crate", minBodies: 1 }]);
  });

  it("should ship numeric and signal assertions for both terminal outcomes", async () => {
    const root = path.resolve("packages/create-threenative/templates/platformer");
    const win = JSON.parse(
      await readFile(path.join(root, "playtests/terminal-loop-win.playtest.json"), "utf8"),
    ) as { assert: { resources: unknown[]; signals: unknown[] } };
    const fail = JSON.parse(
      await readFile(path.join(root, "playtests/terminal-loop-fail.playtest.json"), "utf8"),
    ) as { assert: { resources: unknown[]; signals: unknown[] } };

    expect(win.assert.resources).toContainEqual({
      changed: true,
      equals: 1,
      id: "GameState",
      path: "terminal",
    });
    expect(win.assert.resources).toContainEqual({
      atSteps: [{ equals: true, label: "reach-goal" }],
      id: "GameState",
      path: "grounded",
    });
    expect(win.assert.signals).toContainEqual({ entity: "game", minCount: 1, name: "won" });
    expect(fail.assert.resources).toContainEqual({
      changed: true,
      equals: 2,
      id: "GameState",
      path: "terminal",
    });
    expect(fail.assert.signals).toContainEqual({ entity: "game", minCount: 1, name: "lost" });
  });

  it("should ship a pause button, a seeded level, and a playable pickup sound", async () => {
    const game = await readFile(
      path.resolve("packages/create-threenative/templates/starter/src/game.ts"),
      "utf8",
    );
    const menu = await readFile(
      path.resolve("packages/create-threenative/templates/starter/src/ui/Menu.tsx"),
      "utf8",
    );
    const seed = await readFile(
      path.resolve("packages/create-threenative/templates/starter/playtests/seed.playtest.json"),
      "utf8",
    );
    const pickupAudio = await readFile(
      path.resolve("packages/create-threenative/templates/starter/public/pickup.ogg"),
    );

    expect(game).toContain("seed: 90210");
    expect(menu).toContain("game.pause()");
    expect(seed).toContain('"path": "levelX"');
    expect(pickupAudio.subarray(0, 4).toString("ascii")).toBe("OggS");
  });

  it("should assert the seeded level range instead of a generator draw", async () => {
    const seed = JSON.parse(
      await readFile(
        path.resolve("packages/create-threenative/templates/starter/playtests/seed.playtest.json"),
        "utf8",
      ),
    ) as {
      assert: {
        resources: Array<{
          changed?: boolean;
          equals?: unknown;
          gte?: number;
          id: string;
          lte?: number;
          path?: string;
        }>;
      };
    };
    const level = seed.assert.resources.find(
      ({ id, path: resourcePath }) => id === "GameState" && resourcePath === "levelX",
    );
    const play = await readFile(
      path.resolve("packages/create-threenative/templates/starter/src/scenes/Play.ts"),
      "utf8",
    );

    expect(level).toEqual({ changed: true, gte: -1, id: "GameState", lte: 1, path: "levelX" });
    expect(level).not.toHaveProperty("equals");
    expect(play).toContain("const randomStateBeforeLevel = ctx.random.state");
    expect(play).toContain(
      "const seededLevelX = ctx.random.state === randomStateBeforeLevel ? 2 : levelX",
    );
    expect(play).toContain("ctx.after(0.25, () => ctx.state.set({ levelX: seededLevelX }))");
  });

  it("should load the packaged texture and GLB through the starter scene", async () => {
    const play = await readFile(
      path.resolve("packages/create-threenative/templates/starter/src/scenes/Play.ts"),
      "utf8",
    );
    const texture = await readFile(
      path.resolve("packages/create-threenative/templates/starter/public/native-proof.png"),
    );
    const model = await readFile(
      path.resolve("packages/create-threenative/templates/starter/public/native-proof.glb"),
    );

    expect(play).toContain('ctx.assets.texture("native-proof.png")');
    expect(play).toContain('ctx.assets.model<{ scene: Group }>("native-proof.glb")');
    expect(play).toContain("TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb");
    expect(texture.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(model.subarray(0, 4).toString("ascii")).toBe("glTF");
  });

  it("should ship JSON scenarios for both templates and no legacy TypeScript scenario", async () => {
    const minimal = await readFile(
      path.resolve("packages/create-threenative/templates/minimal/playtests/play.playtest.json"),
      "utf8",
    );
    expect(JSON.parse(minimal)).toMatchObject({ name: "play", schemaVersion: 1, target: "web" });
    await expect(
      readFile(
        path.resolve("packages/create-threenative/templates/starter/tests/play.playtest.ts"),
        "utf8",
      ),
    ).rejects.toThrow();
    await expect(
      readFile(
        path.resolve("packages/create-threenative/templates/minimal/tests/play.playtest.ts"),
        "utf8",
      ),
    ).rejects.toThrow();
  });

  it("should start directly in Play without a redundant boot scene", async () => {
    const game = await readFile(
      path.resolve("packages/create-threenative/templates/starter/src/game.ts"),
      "utf8",
    );
    expect(game).toContain("scenes: { play: Play }");
    expect(game).toContain('start: "play"');
    await expect(
      readFile(
        path.resolve("packages/create-threenative/templates/starter/src/scenes/Boot.ts"),
        "utf8",
      ),
    ).rejects.toThrow();
  });
});
