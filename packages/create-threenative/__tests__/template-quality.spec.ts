import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  QUALITY_TIERS,
  costCommentGaps,
  enabledStages,
  presetLiteralsIn,
  templateNames,
} from "../../../scripts/template-quality.js";

const templatesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "templates");

/** Every template on disk, so one added tomorrow is covered the day it ships. */
const names = await templateNames(templatesDir);

interface IQualityModule {
  readonly qualityPreset: (tier: string) => Record<string, unknown>;
  readonly resolveQualityTier: (request?: { mobile?: boolean; tier?: string }) => string;
}

async function load(template: string): Promise<IQualityModule> {
  return (await import(
    path.join(templatesDir, template, "src", "render", "quality.ts")
  )) as IQualityModule;
}

describe("template quality tiers", () => {
  it("should find the eight shipped templates rather than an empty list", () => {
    expect(names.length).toBeGreaterThanOrEqual(8);
    expect(names).toContain("starter");
  });

  it("should ship a quality module in every template", async () => {
    const missing: string[] = [];
    for (const name of names) {
      const file = path.join(templatesDir, name, "src", "render", "quality.ts");
      await readFile(file, "utf8").catch(() => missing.push(name));
    }
    expect(missing).toEqual([]);
  });

  it("should leave no preset literal behind in any postprocessing module", async () => {
    const leftovers: string[] = [];
    for (const name of names) {
      const source = await readFile(
        path.join(templatesDir, name, "src", "render", "postprocessing.ts"),
        "utf8",
      );
      if (presetLiteralsIn(source).length > 0) leftovers.push(name);
    }
    expect(leftovers).toEqual([]);
  });

  it("should read the quality module from every postprocessing module", async () => {
    const unwired: string[] = [];
    for (const name of names) {
      const source = await readFile(
        path.join(templatesDir, name, "src", "render", "postprocessing.ts"),
        "utf8",
      );
      if (!source.includes('from "./quality.js"')) unwired.push(name);
    }
    expect(unwired).toEqual([]);
  });

  it("should throw when the tier is not a known name", async () => {
    const { resolveQualityTier } = await load("starter");
    expect(() => resolveQualityTier({ tier: "ultra" })).toThrow(/"ultra"/u);
  });

  it("should throw from qualityPreset too, rather than returning the default", async () => {
    const { qualityPreset } = await load("starter");
    expect(() => qualityPreset("ultra")).toThrow(/"ultra"/u);
  });

  it("should resolve low when the platform is mobile and no tier is given", async () => {
    const { resolveQualityTier } = await load("starter");
    expect(resolveQualityTier({ mobile: true })).toBe("low");
    expect(resolveQualityTier({ mobile: false })).toBe("high");
    expect(resolveQualityTier()).toBe("high");
  });

  it("should let an explicit tier override the platform", async () => {
    const { resolveQualityTier } = await load("starter");
    expect(resolveQualityTier({ mobile: true, tier: "high" })).toBe("high");
    expect(resolveQualityTier({ mobile: false, tier: "low" })).toBe("low");
  });

  it("should differ between low and high in at least one enabled stage", async () => {
    for (const name of names) {
      const { qualityPreset } = await load(name);
      expect(
        qualityPreset("low"),
        `${name}: low and high render the same thing, so the switch is three names for one look`,
      ).not.toEqual(qualityPreset("high"));
    }
  });

  it("should give medium its own look, between the other two", async () => {
    for (const name of names) {
      const { qualityPreset } = await load(name);
      expect(qualityPreset("medium"), `${name}: medium equals high`).not.toEqual(
        qualityPreset("high"),
      );
      expect(qualityPreset("medium"), `${name}: medium equals low`).not.toEqual(
        qualityPreset("low"),
      );
    }
  });

  it("should never enable at a cheaper tier a stage the tier above leaves off", async () => {
    for (const name of names) {
      const { qualityPreset } = await load(name);
      const high = enabledStages(qualityPreset("high"));
      const medium = enabledStages(qualityPreset("medium"));
      const low = enabledStages(qualityPreset("low"));
      expect(
        medium.filter((stage) => !high.includes(stage)),
        `${name}: medium over high`,
      ).toEqual([]);
      expect(
        low.filter((stage) => !medium.includes(stage)),
        `${name}: low over medium`,
      ).toEqual([]);
    }
  });

  it("should carry a cost comment for every stage the high tier enables", async () => {
    for (const name of names) {
      const source = await readFile(
        path.join(templatesDir, name, "src", "render", "quality.ts"),
        "utf8",
      );
      expect(
        costCommentGaps(source),
        `${name}: stages enabled with no measured cost beside them`,
      ).toEqual([]);
    }
  });

  it("should keep sailing's SSGI and SSR off at every tier", async () => {
    const { qualityPreset } = await load("sailing");
    for (const tier of QUALITY_TIERS) {
      expect(qualityPreset(tier).ssrEnabled, `sailing ${tier}`).toBe(false);
      expect(qualityPreset(tier).ssgiEnabled, `sailing ${tier}`).toBe(false);
    }
  });

  it("should document the tiers and the override in every template's AGENTS.md", async () => {
    const undocumented: string[] = [];
    for (const name of names) {
      const doc = await readFile(path.join(templatesDir, name, "AGENTS.md"), "utf8");
      const documented =
        doc.includes("quality.ts") &&
        QUALITY_TIERS.every((tier) => doc.includes(`\`${tier}\``)) &&
        doc.includes('tier: "low"');
      if (!documented) undocumented.push(name);
    }
    expect(undocumented).toEqual([]);
  });

  it("should list every template directory, not a hard-coded eight", async () => {
    const onDisk = (await readdir(templatesDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(names).toEqual(onDisk);
  });
});
