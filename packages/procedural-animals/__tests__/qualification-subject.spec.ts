import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLAYTEST_ASSERTION_REGISTRY, loadPlaytestScenario } from "../../playtest/dist/index.js";
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

describe("native animal fixture observation admission", () => {
  for (const filename of ["animals", "frustum", "lifecycle"]) {
    it(`requests only shipped desktop assertion observations for ${filename}`, async () => {
      const scenario = await loadPlaytestScenario(
        path.resolve("examples/procedural-animals"),
        `playtests/${filename}.native.playtest.json`,
      );
      const unsupported = PLAYTEST_ASSERTION_REGISTRY.filter(
        (entry) =>
          scenario.assert?.[entry.kind] !== undefined && !entry.supportedOn.includes("desktop"),
      ).map((entry) => entry.kind);
      expect(unsupported).toEqual([]);
    });
  }
  for (const filename of ["animals", "frustum"]) {
    it(`retains browser diagnostics and native motion/numeric observations for ${filename}`, async () => {
      const root = path.resolve("examples/procedural-animals");
      const web = await loadPlaytestScenario(root, `playtests/${filename}.playtest.json`);
      const native = await loadPlaytestScenario(root, `playtests/${filename}.native.playtest.json`);
      expect(web.assert?.diagnostics?.noRuntimeDiagnostics).toBe(true);
      expect(web.assert?.diagnostics?.noConsoleErrors).toBe(true);
      expect(web.steps).toEqual(native.steps);
      for (const kind of ["resources", "sceneNodes", "geometry"] as const)
        expect(native.assert?.[kind]).toEqual(web.assert?.[kind]);
    });
  }
});
