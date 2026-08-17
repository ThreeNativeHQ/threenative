import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOCAL_FRAMEWORK_PACKAGES,
  RENDER_LAYER_FILES,
  TEMPLATE_NAMES,
  VISUAL_SCORE_FLOOR,
  captureAllTemplates,
  inspectAllTemplates,
  validateVisualScores,
  visualServerProcessGroup,
} from "../visual-gate.js";

describe("visual gate", () => {
  it("builds playtest before packages that import its export map", () => {
    const names = LOCAL_FRAMEWORK_PACKAGES.map(([name]) => name);
    expect(names.indexOf("@threenative/playtest")).toBeLessThan(names.indexOf("@threenative/core"));
  });

  it("terminates the complete visual server process group outside Windows", () => {
    expect(visualServerProcessGroup(1234, "linux")).toBe(-1234);
    expect(visualServerProcessGroup(1234, "win32")).toBe(1234);
  });

  it("finds the six live render files and quality floor in every template", () => {
    const results = inspectAllTemplates();
    expect(results).toHaveLength(TEMPLATE_NAMES.length);
    for (const result of results) {
      expect(result.errors, result.template).toEqual([]);
      for (const file of RENDER_LAYER_FILES) expect(result.files, result.template).toContain(file);
    }
  });

  it("discovers an unregistered broken template and reports its missing render file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "threenative-visual-discovery-"));
    const broken = path.join(root, "unregistered-broken");
    try {
      await cp(path.resolve("packages/create-threenative/templates/platformer"), broken, {
        recursive: true,
      });
      const manifest = JSON.parse(await readFile(path.join(broken, "kit.json"), "utf8")) as {
        name: string;
      };
      await writeFile(
        path.join(broken, "kit.json"),
        `${JSON.stringify({ ...manifest, name: "unregistered-broken" })}\n`,
      );
      await unlink(path.join(broken, "src/render/postprocessing.ts"));

      const result = inspectAllTemplates(root).find(
        ({ template }) => template === "unregistered-broken",
      );
      expect(result?.errors).toContain("unregistered-broken: missing src/render/postprocessing.ts");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("persists every template capture through the production orchestration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "threenative-visual-capture-sync-"));
    const visualRoot = path.join(root, "visuals");
    try {
      const captures = await captureAllTemplates(
        path.join(root, "capture-root"),
        {},
        {
          captureTemplate: async (template) => ({
            content: Buffer.from(`${template} visual-gate capture`),
            stats: {
              brightPixelRatio: 1,
              distinctColors: 8,
              height: 1,
              luminanceStdDev: 1,
              width: 1,
            },
          }),
          visualRoot,
        },
      );

      expect(captures.map(({ template }) => template)).toEqual([...TEMPLATE_NAMES]);
      for (const template of TEMPLATE_NAMES) {
        const capture = Buffer.from(`${template} visual-gate capture`);
        expect(await readFile(path.join(visualRoot, `${template}.png`))).toEqual(capture);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects missing or below-floor human scores", () => {
    expect(() => validateVisualScores({})).toThrow("TN_VISUAL_SCORE_INVALID");
    const scores = Object.fromEntries(TEMPLATE_NAMES.map((template) => [template, 4]));
    expect(() =>
      validateVisualScores({
        templates: { ...scores, platformer: 3 },
        parity: { framework: 4, vanilla: 4 },
      }),
    ).toThrow(`TN_VISUAL_SCORE_FLOOR: platformer scored 3; floor is ${VISUAL_SCORE_FLOOR}.`);
  });

  it("rejects stale template score entries", () => {
    const templates = Object.fromEntries(TEMPLATE_NAMES.map((template) => [template, 4]));
    expect(() =>
      validateVisualScores({
        templates: { ...templates, retired: 4 },
        parity: { framework: 4, vanilla: 4 },
      }),
    ).toThrow("TN_VISUAL_SCORE_TEMPLATES_MISMATCH: missing none; stale retired.");
  });

  it("accepts a complete score file only at or above the floor", () => {
    const templates = Object.fromEntries(TEMPLATE_NAMES.map((template) => [template, 4]));
    const scores = validateVisualScores({
      templates,
      parity: { framework: 4, vanilla: 4 },
    });
    expect(scores.templates).toEqual(templates);
  });
});
