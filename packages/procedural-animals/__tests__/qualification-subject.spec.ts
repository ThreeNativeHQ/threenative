import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadPlaytestScenario } from "../../playtest/dist/index.js";
import { observedEntityIds } from "../../playtest/src/runner/shared.js";

describe("installed animal harness entity request", () => {
  for (const filename of ["animals", "animals.native", "frustum", "frustum.native"]) {
    it(`requests the actual wolf entity for ${filename}`, async () => {
      const scenario = await loadPlaytestScenario(
        path.resolve("examples/procedural-animals"),
        `playtests/${filename}.playtest.json`,
      );
      expect(observedEntityIds(scenario)).toContain("wolf-0");
    });
  }
});
