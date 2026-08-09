import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("starter playtest proof", () => {
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
    ) as { scripts: { "test:playtest": string } };
    const scenario = JSON.parse(
      await readFile(
        path.resolve(
          "packages/create-threenative/templates/platformer/playtests/chase.playtest.json",
        ),
        "utf8",
      ),
    ) as {
      assert: {
        diagnostics: { noConsoleErrors: boolean; runtimeReady: boolean };
        movement: {
          pathLength: number;
          reachesPositionWithin: { maxDistance: number; position: number[] };
        };
      };
    };

    expect(packageJson.scripts["test:playtest"]).toContain("chase.playtest.json");
    expect(scenario.assert.diagnostics).toEqual({ noConsoleErrors: true, runtimeReady: true });
    expect(scenario.assert.movement).toMatchObject({
      pathLength: 9,
      reachesPositionWithin: { maxDistance: 1.2, position: [0, 0.66, 0] },
    });
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

  it("should ship a boot-to-play jump scenario", async () => {
    const game = await readFile(
      path.resolve("packages/create-threenative/templates/starter/src/game.ts"),
      "utf8",
    );
    const boot = await readFile(
      path.resolve("packages/create-threenative/templates/starter/src/scenes/Boot.ts"),
      "utf8",
    );
    const player = await readFile(
      path.resolve("packages/create-threenative/templates/starter/src/entities/Player.ts"),
      "utf8",
    );
    const scenario = await readFile(
      path.resolve("packages/create-threenative/templates/starter/playtest/boot-to-play.json"),
      "utf8",
    );

    expect(game).toContain("scenes: { boot: Boot, play: Play }");
    expect(game).toContain("buttons: [0]");
    expect(boot).toContain('ctx.goto("play")');
    expect(player).toContain('ctx.input.justPressed("jump")');
    expect(scenario).toContain('"axis": "+y"');
  });
});
