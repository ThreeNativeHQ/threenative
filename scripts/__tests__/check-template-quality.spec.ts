import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  checkTemplateQuality,
  costCommentGaps,
  formatTemplateQualityReport,
  presetLiteralsIn,
  templateNames,
} from "../template-quality.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const QUALITY = `import type { IWorldEnvironmentOptions } from "./worldEnvironment.js";
const high: IWorldEnvironmentOptions = {
  // Bloom: ~4.6 ms.
  bloomEnabled: true,
};
const medium: IWorldEnvironmentOptions = {};
const low: IWorldEnvironmentOptions = {};
`;

const POST = `import { qualityPreset, resolveQualityTier } from "./quality.js";
export function setupPost(): void {
  const tier = resolveQualityTier({});
  console.info(\`TN_QUALITY_TIER \${tier}\`);
  qualityPreset(tier);
}
`;

const DOC = `# AGENTS.md

## Quality tiers

\`src/render/quality.ts\` names \`low\`, \`medium\` and \`high\`. Override with
\`setupPost(renderer, scene, camera, { tier: "low" })\`.
`;

async function fixture(
  overrides: { quality?: string; post?: string; doc?: string } = {},
): Promise<string> {
  const root = await makeTempDir("template-quality");
  const render = path.join(
    root,
    "packages",
    "create-threenative",
    "templates",
    "demo",
    "src",
    "render",
  );
  await mkdir(render, { recursive: true });
  await writeFile(path.join(render, "quality.ts"), overrides.quality ?? QUALITY);
  await writeFile(path.join(render, "postprocessing.ts"), overrides.post ?? POST);
  await writeFile(
    path.join(root, "packages", "create-threenative", "templates", "demo", "AGENTS.md"),
    overrides.doc ?? DOC,
  );
  return root;
}

describe("check-template-quality", () => {
  it("should pass against this repository's own templates", async () => {
    const report = await checkTemplateQuality(repoRoot);
    expect(formatTemplateQualityReport(report)).toMatch(/^template quality: /u);
    expect(report.findings).toEqual([]);
    expect(report.templates.length).toBeGreaterThanOrEqual(8);
  });

  it("should throw when it finds no templates at all", async () => {
    const empty = await makeTempDir("template-quality-empty");
    await mkdir(path.join(empty, "packages", "create-threenative", "templates"), {
      recursive: true,
    });
    await expect(checkTemplateQuality(empty)).rejects.toThrow(/TEMPLATE_QUALITY_NO_TEMPLATES/u);
  });

  it("should fail when a template has no quality module", async () => {
    const root = await fixture();
    const render = path.join(
      root,
      "packages",
      "create-threenative",
      "templates",
      "demo",
      "src",
      "render",
    );
    await writeFile(path.join(render, "quality.ts"), "");
    const report = await checkTemplateQuality(root);
    expect(formatTemplateQualityReport(report)).toContain(
      "demo: quality.ts declares no `high` tier",
    );
  });

  it("should fail when a postprocessing module still holds a preset literal", async () => {
    const root = await fixture({
      post: `${POST}\nconst desktopPreset = { bloomEnabled: true };\n`,
    });
    const report = await checkTemplateQuality(root);
    expect(formatTemplateQualityReport(report)).toContain("`desktopPreset` literal");
  });

  it("should fail when an enabled stage carries no measured cost", async () => {
    const root = await fixture({
      quality: QUALITY.replace("  // Bloom: ~4.6 ms.\n", ""),
    });
    const report = await checkTemplateQuality(root);
    expect(formatTemplateQualityReport(report)).toContain("bloomEnabled");
    expect(formatTemplateQualityReport(report)).toContain("no measured cost");
  });

  it("should accept `unmeasured` as an honest cost comment", () => {
    expect(costCommentGaps("  // unmeasured\n  ssrEnabled: true,\n")).toEqual([]);
    expect(costCommentGaps("  // it looks nice\n  ssrEnabled: true,\n")).toEqual([
      "ssrEnabled (line 2)",
    ]);
  });

  it("should fail when a template's AGENTS.md does not document the tier switch", async () => {
    const report = await checkTemplateQuality(await fixture({ doc: "# AGENTS.md\n" }));
    expect(formatTemplateQualityReport(report)).toContain("AGENTS.md does not name quality.ts");
    expect(formatTemplateQualityReport(report)).toContain("does not show the tier override");
  });

  it("should fail when postprocessing stops reporting the tier", async () => {
    const report = await checkTemplateQuality(
      await fixture({ post: POST.replace("TN_QUALITY_TIER ", "") }),
    );
    expect(formatTemplateQualityReport(report)).toContain("does not report TN_QUALITY_TIER");
  });

  it("should name both incumbent literals", () => {
    expect(presetLiteralsIn("const desktopPreset = {};\nconst mobilePreset = {};\n")).toEqual([
      "desktopPreset",
      "mobilePreset",
    ]);
  });

  it("should list template directories from disk", async () => {
    const root = await fixture();
    await expect(
      templateNames(path.join(root, "packages", "create-threenative", "templates")),
    ).resolves.toEqual(["demo"]);
  });
});
