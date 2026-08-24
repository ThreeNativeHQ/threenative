import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { expandSharedRegions, mirrorContent, readSharedFragments } from "./sync-agent-docs.js";

/**
 * P2-2: cold agents pay every word in a generated `AGENTS.md` before they can ask the
 * capability manifest anything, so the payload is bounded by measurement rather than taste.
 *
 * The contract, in one place:
 *
 * - One default maximum applies to every shipped template; an override exists only where the
 *   measured content justifies it (recorded in docs/verification/instruction-budgets-*.md).
 * - Words are counted over RENDERED text: shared-marker comments stripped, HTML comments
 *   stripped, placeholders substituted — exactly what a generated project's agent reads.
 * - Long recipes live in `agent-docs/references/*.md`, shipped into each generated project as
 *   `agent-docs/*.md` and referenced by the literal relative path (backticked or linked).
 * - Every reference target must exist in the bundle, and every `CLAUDE.md` mirror must equal
 *   the generated expansion of its `AGENTS.md`.
 */

export interface IBudgetConfig {
  readonly defaultMaxWords: number;
  readonly overrides: Readonly<Record<string, number>>;
}

export const INSTRUCTION_BUDGETS: IBudgetConfig = {
  // Measured across all seven shipped templates after the P2-2 reduction; see
  // docs/verification/instruction-budgets-2026-08-21.md for the before/after table and
  // per-template breakdowns.
  //
  // The four genre kits fit the default once their duplicated recipes moved to the reference
  // bundle. The three overrides are not slack: each names the mandatory inline content that
  // keeps its template above the default after two reduction passes.
  //
  // Every number carries a uniform +60 re-measured on 2026-08-22 (PRD-187): the generated
  // superseded-constructs region became mandatory inline content in all seven templates, and
  // survives the triplication cut that paid for most of it (the same override rule had been
  // stated in the ctx-surface prose, the generated trailer, and the engine-capabilities
  // fragment). See docs/verification/instruction-budgets-2026-08-22.md.
  // `minimal` and `starter` each carry a further re-measured increment from PRD-209
  // (2026-08-23): +53 and +65 rendered words for the portable-HUD convention. Both templates
  // had under 25 words of headroom, so stating the convention at all needed the override the
  // contract above allows. The measured content justifying it: a shipped Android build
  // rendered its world with no HUD whatsoever, because `starter`'s portability list called a
  // native HUD optional and no template said where a portable one comes from. The spike that
  // priced the alternatives — one geometry source rendering byte-identical text on web, Linux
  // desktop native, the Android emulator and a physical Pixel 8 — is
  // docs/verification/prd-209-2026-08-23.md; the before/after table is
  // docs/verification/instruction-budgets-2026-08-23.md.
  // A second uniform bump, +22, re-measured on 2026-08-23 (PRD-214): the frame budget ships on
  // by default and prints `TN_FRAME_BUDGET` on every platform, so the performance-default
  // fragment now has to name the marker, its five phases and the `frameBudget: false` override
  // — a convention missing from the templates' AGENTS.md does not exist. Measured worst case was
  // platformer at 2981 against 2960. See docs/verification/prd-214-2026-08-23.md.
  defaultMaxWords: 2682,
  overrides: {
    // Touch-controls mapping, the stated desktop-has-no-HUD gap, and checkpoint level structure.
    platformer: 2982,
    // The no-React geometry HUD contract and its native-portability rules have no genre-kit peer.
    minimal: 3435,
    // React state bridge, native-proof game contract, the four-difference portability list, and
    // the React-HUD-is-invisible-natively rule that list has to carry.
    starter: 3797,
  },
};

/** Sections every generated instruction file must carry inline, wherever its budget lands. */
export const MANDATORY_INLINE_PROBES: ReadonlyArray<{
  readonly label: string;
  readonly pattern: RegExp;
}> = [
  { label: "first-use capability search", pattern: /engine_search_capabilities/u },
  {
    label: "fallback to plain Three.js",
    pattern: /When the framework blocks you, write plain Three\.js/u,
  },
  { label: "doctor-first diagnosis", pattern: /npx threenative doctor/u },
  { label: "durable playtest proof", pattern: /playtests\/survives\.playtest\.json/u },
  { label: "navigation subpath constraint", pattern: /@threenative\/physics\/navigation/u },
  { label: "look budget rule", pattern: /Budget real time for the look/u },
];

export type BudgetViolationCode =
  | "WORD_BUDGET_EXCEEDED"
  | "MISSING_MANDATORY_SECTION"
  | "MISSING_REFERENCE_TARGET"
  | "MIRROR_DRIFT";

export interface IBudgetViolation {
  readonly code: BudgetViolationCode;
  readonly message: string;
}

export interface IInstructionAudit {
  readonly limit: number;
  readonly mirrorPath: string;
  readonly missingMandatory: readonly string[];
  /** Reference hrefs found in the rendered instructions, resolved against the bundle. */
  readonly references: readonly string[];
  readonly template: string;
  readonly violations: readonly IBudgetViolation[];
  readonly wordCount: number;
}

/** Marker comments and ordinary comments never reach a generated project's reader. */
const COMMENT_PATTERN = /<!--[\s\S]*?-->/gu;
const PLACEHOLDERS: ReadonlyArray<readonly [string, string]> = [
  ["__PROJECT_NAME__", "my-game"],
  ["__PROJECT_ID__", "mygame"],
];
const REFERENCE_DIRECTORY = path.join("agent-docs", "references");
/** Backticked paths and Markdown links share one prefix so both readers resolve identically. */
const REFERENCE_TOKEN_PATTERN =
  /`agent-docs\/([a-z0-9][a-z0-9./-]*\.md)`|\[[^\]]*\]\(agent-docs\/([^)#]+\.md)\)/gu;

/** The text a generated project's agent actually reads from a template instruction file. */
export function renderInstructionText(source: string): string {
  let rendered = source;
  for (const [placeholder, value] of PLACEHOLDERS) {
    rendered = rendered.replaceAll(placeholder, value);
  }
  return rendered.replace(COMMENT_PATTERN, "").trim();
}

export function countWords(text: string): number {
  return text.split(/\s+/u).filter((word) => word.length > 0).length;
}

/** Reference targets named by rendered instructions, normalised to `agent-docs/<file>` form. */
export function referenceTargets(rendered: string): readonly string[] {
  const targets = new Set<string>();
  for (const match of rendered.matchAll(REFERENCE_TOKEN_PATTERN)) {
    targets.add(`agent-docs/${match[1] ?? match[2]}`);
  }
  return [...targets].sort();
}

function limitFor(template: string, config: IBudgetConfig): number {
  return config.overrides[template] ?? config.defaultMaxWords;
}

/**
 * Audits one template directory containing `AGENTS.md` (+ generated `CLAUDE.md`) against its
 * budget, the mandatory inline sections, and the reference bundle.
 */
export async function auditTemplate(
  templateDirectory: string,
  fragments: ReadonlyMap<string, string>,
  bundleDirectory: string,
  config: IBudgetConfig = INSTRUCTION_BUDGETS,
): Promise<IInstructionAudit> {
  const template = path.basename(templateDirectory);
  const agentsPath = path.join(templateDirectory, "AGENTS.md");
  const claudePath = path.join(templateDirectory, "CLAUDE.md");
  const source = await readFile(agentsPath, "utf8");
  const rendered = renderInstructionText(source);
  const wordCount = countWords(rendered);
  const violations: IBudgetViolation[] = [];

  const limit = limitFor(template, config);
  if (wordCount > limit) {
    violations.push({
      code: "WORD_BUDGET_EXCEEDED",
      message: `RED observed: template word budget exceeded: '${template}' renders ${wordCount} words, limit ${limit}`,
    });
  }

  const missingMandatory = MANDATORY_INLINE_PROBES.filter(
    ({ pattern }) => !pattern.test(rendered),
  ).map(({ label }) => label);
  for (const label of missingMandatory) {
    violations.push({
      code: "MISSING_MANDATORY_SECTION",
      message: `missing mandatory inline section '${label}' in '${template}'`,
    });
  }

  const references: string[] = [];
  for (const target of referenceTargets(rendered)) {
    const file = target.slice("agent-docs/".length);
    references.push(target);
    if (!existsSync(path.join(bundleDirectory, file))) {
      violations.push({
        code: "MISSING_REFERENCE_TARGET",
        message: `RED observed: missing generated reference: '${target}' linked from '${template}/AGENTS.md' is not in the shipped bundle`,
      });
    }
  }

  const expectedMirror = mirrorContent(
    expandSharedRegions(source, fragments, `${template}/AGENTS.md`),
  );
  const actualMirror = existsSync(claudePath) ? await readFile(claudePath, "utf8") : undefined;
  if (actualMirror !== expectedMirror) {
    violations.push({
      code: "MIRROR_DRIFT",
      message: `RED observed: agent docs out of sync: '${path.basename(claudePath)}' does not mirror '${path.relative(path.dirname(templateDirectory), agentsPath)}'; run pnpm sync:agents`,
    });
  }

  return {
    limit,
    mirrorPath: claudePath,
    missingMandatory,
    references,
    template,
    violations,
    wordCount,
  };
}

/** Discovers every shipped template under `<repoRoot>/packages/create-threenative/templates`. */
export async function auditAllTemplates(
  repoRoot: string,
  config: IBudgetConfig = INSTRUCTION_BUDGETS,
): Promise<readonly IInstructionAudit[]> {
  const createRoot = path.join(repoRoot, "packages", "create-threenative");
  const templatesDirectory = path.join(createRoot, "templates");
  const bundleDirectory = path.join(createRoot, REFERENCE_DIRECTORY);
  const fragments = await readSharedFragments(repoRoot);
  const entries = (await readdir(templatesDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (entries.length === 0) {
    throw new Error(`INSTRUCTION_BUDGET_TEMPLATES_MISSING: ${templatesDirectory}`);
  }
  return Promise.all(
    entries.map((entry) =>
      auditTemplate(path.join(templatesDirectory, entry), fragments, bundleDirectory, config),
    ),
  );
}

async function main(): Promise<void> {
  const repoRoot = process.argv[2] ?? process.cwd();
  const audits = await auditAllTemplates(repoRoot);
  let failed = false;
  for (const audit of audits) {
    const status = audit.violations.length === 0 ? "OK" : "FAIL";
    console.log(
      `${audit.template.padEnd(12)} ${String(audit.wordCount).padStart(5)}/${audit.limit} words  ${status}`,
    );
    for (const violation of audit.violations) {
      failed = true;
      console.log(`  ${violation.code}: ${violation.message}`);
    }
  }
  if (failed) {
    console.error("RED observed: instruction payload budget failed");
    process.exitCode = 1;
    return;
  }
  console.log(`instruction budgets met across ${audits.length} templates`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
