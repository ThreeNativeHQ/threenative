import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("starter playtest proof", () => {
  it("should contain movement and score assertions", async () => {
    const scenario = await readFile(
      path.resolve("packages/create-threenative/templates/starter/tests/play.playtest.ts"),
      "utf8",
    );
    const player = await readFile(
      path.resolve("packages/create-threenative/templates/starter/src/entities/Player.ts"),
      "utf8",
    );
    expect(scenario).toContain("ArrowRight");
    expect(scenario).toContain("score");
    expect(player).toContain('ctx.input.vector("move")');
  });
});
