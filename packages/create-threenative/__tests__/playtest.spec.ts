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
      assert: { diagnostics: { noConsoleErrors: boolean; runtimeReady: boolean }; hud: unknown[] };
      steps: Array<{ press?: string }>;
    };
    const player = await readFile(
      path.resolve("packages/create-threenative/templates/starter/src/entities/Player.ts"),
      "utf8",
    );
    expect(parsed.steps[0]?.press).toBe("ArrowRight");
    expect(parsed.assert.diagnostics).toEqual({ noConsoleErrors: true, runtimeReady: true });
    expect(parsed.assert.hud).toEqual([{ id: "score", path: "#root", textIncludes: "1" }]);
    expect(player).toContain('ctx.input.vector("move")');
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
    const main = await readFile(
      path.resolve("packages/create-threenative/templates/starter/src/main.ts"),
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

    expect(main).toContain("scenes: { boot: Boot, play: Play }");
    expect(main).toContain("buttons: [0]");
    expect(boot).toContain('ctx.goto("play")');
    expect(player).toContain('ctx.input.justPressed("jump")');
    expect(scenario).toContain('"axis": "+y"');
  });
});
