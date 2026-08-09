import { describe, expect, it } from "vitest";
import {
  LOCAL_FRAMEWORK_PACKAGES,
  RENDER_LAYER_FILES,
  TEMPLATE_NAMES,
  VISUAL_SCORE_FLOOR,
  inspectAllTemplates,
  validateVisualScores,
} from "../visual-gate.js";

describe("visual gate", () => {
  it("builds playtest before packages that import its export map", () => {
    const names = LOCAL_FRAMEWORK_PACKAGES.map(([name]) => name);
    expect(names.indexOf("@threenative/playtest")).toBeLessThan(names.indexOf("@threenative/core"));
  });

  it("finds the six live render files and quality floor in every template", () => {
    const results = inspectAllTemplates();
    expect(results).toHaveLength(TEMPLATE_NAMES.length);
    for (const result of results) {
      expect(result.errors, result.template).toEqual([]);
      for (const file of RENDER_LAYER_FILES) expect(result.files, result.template).toContain(file);
    }
  });

  it("rejects missing or below-floor human scores", () => {
    expect(() => validateVisualScores({})).toThrow("TN_VISUAL_SCORE_INVALID");
    expect(() =>
      validateVisualScores({
        templates: { minimal: 4, starter: 4, platformer: 3 },
        parity: { framework: 4, vanilla: 4 },
      }),
    ).toThrow(`TN_VISUAL_SCORE_FLOOR: platformer scored 3; floor is ${VISUAL_SCORE_FLOOR}.`);
  });

  it("accepts a complete score file only at or above the floor", () => {
    const scores = validateVisualScores({
      templates: { minimal: 4, starter: 5, platformer: 4 },
      parity: { framework: 4, vanilla: 4 },
    });
    expect(scores.templates).toEqual({ minimal: 4, starter: 5, platformer: 4 });
  });
});
