import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  INSTRUCTION_BUDGETS,
  MANDATORY_INLINE_PROBES,
  auditAllTemplates,
  auditTemplate,
  countWords,
  referenceTargets,
  renderInstructionText,
} from "../instruction-budget.js";

/**
 * Fixture layout mirrors the shipped one in miniature: a template pair plus a shared fragment
 * and the reference bundle it points at. Every test owns its temp root so mutations for the
 * observed-red controls never touch the real tree.
 */
const FRAGMENT = `### Before you write a system, ask what already exists

You have \`engine_search_capabilities\` in your tool list. Call it before writing any entity
system. When the framework blocks you, write plain Three.js; run \`npx threenative doctor\`
first. Keep \`playtests/survives.playtest.json\` green. \`@threenative/physics/navigation\`
carries WASM. Budget real time for the look.
`;

const REFERENCE = "# Finding assets\n\nThe full tool loop lives here.\n";

const cleanup: string[] = [];

async function buildFixtureRoot(options?: {
  agentsBody?: string;
  claudeBody?: string;
  references?: Record<string, string>;
}): Promise<string> {
  const root = await makeTempDir("threenative-instruction-budget-");
  cleanup.push(root);
  const packageRoot = path.join(root, "packages", "create-threenative");
  const templateDirectory = path.join(packageRoot, "templates", "alpha");
  await mkdir(templateDirectory, { recursive: true });
  const body =
    options?.agentsBody ??
    `# AGENTS.md — __PROJECT_NAME__\n\n${FRAGMENT}\nSee \`agent-docs/finding-assets.md\` for the loop.\n`;
  await writeFile(path.join(templateDirectory, "AGENTS.md"), body);
  await writeFile(
    path.join(templateDirectory, "CLAUDE.md"),
    options?.claudeBody ??
      `<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->\n\n${body}`,
  );
  await mkdir(path.join(packageRoot, "agent-docs", "references"), { recursive: true });
  await writeFile(
    path.join(packageRoot, "agent-docs", "framework-blocks-you.md"),
    "unused-by-this-fixture",
  );
  for (const [name, content] of Object.entries(
    options?.references ?? { "finding-assets.md": REFERENCE },
  )) {
    await writeFile(path.join(packageRoot, "agent-docs", "references", name), content);
  }
  return root;
}

afterEach(async () => {
  while (cleanup.length > 0) {
    await rm(cleanup.pop() as string, { force: true, recursive: true });
  }
});

describe("instruction budgets", () => {
  it("should count rendered placeholder text rather than source markers", () => {
    const rendered = renderInstructionText(
      "<!-- shared: ctx-surface -->\none two\n<!-- /shared -->\n<!-- build note -->\nHello __PROJECT_NAME__ __PROJECT_NAME__",
    );
    expect(rendered).not.toContain("shared:");
    expect(rendered).toContain("my-game my-game");
    expect(countWords(rendered)).toBe(5);
  });

  it("should collect backticked and linked reference targets", () => {
    expect(
      referenceTargets("see `agent-docs/a.md` and [b](agent-docs/b.md) but not `docs/x.md`"),
    ).toEqual(["agent-docs/a.md", "agent-docs/b.md"]);
  });

  it("should accept a bounded template with intact references and mirror", async () => {
    const root = await buildFixtureRoot();
    const fragments = new Map([["framework-blocks-you", ""]]);
    // The fixture embeds its text directly, so expansion of the unused marker is a no-op.
    const report = await auditTemplate(
      path.join(root, "packages", "create-threenative", "templates", "alpha"),
      fragments,
      path.join(root, "packages", "create-threenative", "agent-docs", "references"),
      { defaultMaxWords: 1000, overrides: {} },
    );
    expect(report.violations).toEqual([]);
    expect(report.wordCount).toBeLessThanOrEqual(1000);
    expect(report.references).toEqual(["agent-docs/finding-assets.md"]);
  });

  it("should reject a template above its word budget", async () => {
    // The negative control from the PRD, kept executable: ~1,000 words added on top of a
    // fixture whose limit sits just under its content.
    const oversized = `${FRAGMENT} ${"filler ".repeat(1000)}`;
    const root = await buildFixtureRoot({ agentsBody: oversized });
    const fragments = new Map([["framework-blocks-you", ""]]);
    const report = await auditTemplate(
      path.join(root, "packages", "create-threenative", "templates", "alpha"),
      fragments,
      path.join(root, "packages", "create-threenative", "agent-docs", "references"),
      { defaultMaxWords: 500, overrides: {} },
    );
    expect(report.wordCount).toBeGreaterThan(500);
    expect(report.violations).toContainEqual({
      code: "WORD_BUDGET_EXCEEDED",
      message: expect.stringContaining("RED observed: template word budget exceeded"),
    });
  });

  it("should reject a missing generated reference", async () => {
    const root = await buildFixtureRoot({ references: {} });
    const fragments = new Map([["framework-blocks-you", ""]]);
    const report = await auditTemplate(
      path.join(root, "packages", "create-threenative", "templates", "alpha"),
      fragments,
      path.join(root, "packages", "create-threenative", "agent-docs", "references"),
    );
    expect(report.violations).toContainEqual({
      code: "MISSING_REFERENCE_TARGET",
      message: expect.stringContaining("RED observed: missing generated reference"),
    });
  });

  it("should reject an AGENTS.md whose CLAUDE.md mirror drifted", async () => {
    const root = await buildFixtureRoot({ claudeBody: "<!-- Generated mirror -->\n\nstale" });
    const fragments = new Map([["framework-blocks-you", ""]]);
    const report = await auditTemplate(
      path.join(root, "packages", "create-threenative", "templates", "alpha"),
      fragments,
      path.join(root, "packages", "create-threenative", "agent-docs", "references"),
    );
    expect(report.violations).toContainEqual({
      code: "MIRROR_DRIFT",
      message: expect.stringContaining("RED observed: agent docs out of sync"),
    });
  });

  it("should reject a template that dropped a mandatory inline section", async () => {
    const withoutCapabilitySearch = FRAGMENT.replace(
      /engine_search_capabilities/gu,
      "the search tool",
    );
    const root = await buildFixtureRoot({ agentsBody: withoutCapabilitySearch });
    const fragments = new Map([["framework-blocks-you", ""]]);
    const report = await auditTemplate(
      path.join(root, "packages", "create-threenative", "templates", "alpha"),
      fragments,
      path.join(root, "packages", "create-threenative", "agent-docs", "references"),
      { defaultMaxWords: 1000, overrides: {} },
    );
    expect(report.missingMandatory).toEqual(["first-use capability search"]);
    expect(report.violations.some(({ code }) => code === "MISSING_MANDATORY_SECTION")).toBe(true);
  });

  it("should keep every shipped template within its measured budget", async () => {
    const audits = await auditAllTemplates(process.cwd());
    expect(audits.map(({ template }) => template)).toHaveLength(8);
    for (const audit of audits) {
      expect(
        audit.violations,
        `${audit.template}: ${audit.violations.map(({ message }) => message).join("; ")}`,
      ).toEqual([]);
    }
  });

  it("should declare a mandatory probe for every load-bearing inline rule", () => {
    // Fail closed on a silently emptied probe list: the mandatory set is the contract.
    expect(MANDATORY_INLINE_PROBES.length).toBeGreaterThanOrEqual(5);
  });
});
