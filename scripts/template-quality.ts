import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * The tier vocabulary every template's `src/render/quality.ts` ships. Three names, not two: a
 * desktop that is dropping frames needs somewhere to go that is not the phone look.
 */
export const QUALITY_TIERS = ["low", "medium", "high"] as const;

export type QualityTier = (typeof QUALITY_TIERS)[number];

/** Boolean options in `IWorldEnvironmentOptions` that turn a render stage on. */
const STAGE_OPTIONS = [
  "bloomEnabled",
  "denoiseEnabled",
  "godraysEnabled",
  "gtaoEnabled",
  "sharpenEnabled",
  "ssgiEnabled",
  "ssrEnabled",
] as const;

/**
 * A cost comment names a measurement or admits there is none.
 *
 * `~4.6 ms` is a reading; `unmeasured` is an honest gap. Anything else beside an enabled stage is
 * a stage whose price nobody wrote down, which is the thing this gate exists to prevent — the
 * file's whole value is that "make it cheaper" can be answered without opening `packages/`.
 */
const COST_COMMENT = /\bms\b|\bunmeasured\b/u;

/** Every template directory on disk. Throws rather than reporting a green zero. */
export async function templateNames(templatesDir: string): Promise<string[]> {
  const entries = await readdir(templatesDir, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0) {
    throw new Error(`TEMPLATE_QUALITY_NO_TEMPLATES: no template directories under ${templatesDir}`);
  }
  return names;
}

/**
 * Anonymous preset literals — the incumbent this switch replaces. Two of these per template was
 * the state before `quality.ts`: a look with no name, no tier and no recorded cost.
 */
export function presetLiteralsIn(source: string): string[] {
  return [...source.matchAll(/const\s+(\w*[Pp]reset)\s*[:=]/gu)].map((match) => match[1] ?? "");
}

/** The stages a preset object turns on. */
export function enabledStages(preset: Record<string, unknown>): string[] {
  return STAGE_OPTIONS.filter((option) => preset[option] === true);
}

/**
 * Stage options enabled in `quality.ts` with no cost comment above them.
 *
 * Deliberately a source scan and not a check on the imported object: the requirement is that the
 * number is *written next to the switch*, where an agent editing the tier will read it. An
 * imported preset cannot carry a comment.
 */
export function costCommentGaps(source: string): string[] {
  const lines = source.split("\n");
  const gaps: string[] = [];
  for (const [index, line] of lines.entries()) {
    const match = /^\s*(\w+Enabled):\s*true,/u.exec(line);
    if (match === null) continue;
    const option = match[1] ?? "";
    let cursor = index - 1;
    let documented = false;
    while (cursor >= 0 && lines[cursor]?.trim().startsWith("//") === true) {
      if (COST_COMMENT.test(lines[cursor] ?? "")) documented = true;
      cursor -= 1;
    }
    if (!documented) gaps.push(`${option} (line ${index + 1})`);
  }
  return gaps;
}

export interface ITemplateQualityFinding {
  readonly template: string;
  readonly problem: string;
}

export interface ITemplateQualityReport {
  readonly templates: readonly string[];
  readonly findings: readonly ITemplateQualityFinding[];
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

/** The switch itself: three named tiers, each with the cost of what it turns on beside it. */
function qualityProblems(source: string | undefined): string[] {
  if (source === undefined) return ["no src/render/quality.ts"];
  const problems = QUALITY_TIERS.filter(
    (tier) => !new RegExp(`^const ${tier}:`, "mu").test(source),
  ).map((tier) => `quality.ts declares no \`${tier}\` tier`);
  for (const gap of costCommentGaps(source)) {
    problems.push(`quality.ts enables ${gap} with no measured cost beside it`);
  }
  return problems;
}

/** The switch is *reached*, the incumbent literals are gone, and the tier is reported. */
function postprocessingProblems(source: string | undefined): string[] {
  if (source === undefined) return ["no src/render/postprocessing.ts"];
  const problems: string[] = [];
  if (!source.includes('from "./quality.js"')) {
    problems.push("postprocessing.ts does not read quality.ts");
  }
  for (const literal of presetLiteralsIn(source)) {
    problems.push(`postprocessing.ts still holds the \`${literal}\` literal the tiers replace`);
  }
  if (!source.includes("TN_QUALITY_TIER")) {
    problems.push("postprocessing.ts does not report TN_QUALITY_TIER");
  }
  return problems;
}

/**
 * Surface-data texture nodes must be requested lazily, or the frame goes black.
 *
 * `PassNode` adds every named colour texture requested through `getTextureNode()` to its
 * framebuffer, so asking for `normal`, `metalness` or `roughness` at the top of `apply()` gives a
 * pass an attachment no fragment shader writes. WebGPU refuses that pipeline — *"Color target has
 * no corresponding fragment stage output"* — and the frame renders black **while the chain reports
 * every stage as applied**.
 *
 * This is a gate rather than a fix because the fix already existed. It was found, understood and
 * written down in `sailing`'s `worldEnvironment.ts` on 2026-08-31, and the other seven templates
 * carried the defect anyway until 2026-09-01, shipping a black mobile look on every phone. A
 * comment in one template is not a convention.
 */
const LAZY_SURFACE_NODES = ["normal", "metalness", "roughness"] as const;

export function eagerSurfaceNodes(source: string): string[] {
  const eager: string[] = [];
  for (const name of LAZY_SURFACE_NODES) {
    const needle = `getTextureNode("${name}")`;
    let at = source.indexOf(needle);
    while (at !== -1) {
      // Walk back to the start of the statement this call sits in. An `=>` inside that span means
      // the call is an arrow body — deferred, which is the fix. Line-based matching cannot do
      // this: the accessors wrap, so `=>` routinely lands on the previous line.
      const statement = source.lastIndexOf(";", at);
      const block = source.lastIndexOf("{", at);
      const from = Math.max(statement, block) + 1;
      const preceding = source.slice(from, at);
      const commented = /(^|\n)\s*(\/\/|\*)[^\n]*$/u.test(source.slice(from, at + needle.length));
      if (!preceding.includes("=>") && !commented) {
        eager.push(`${name} (line ${source.slice(0, at).split("\n").length})`);
      }
      at = source.indexOf(needle, at + needle.length);
    }
  }
  return eager.sort();
}

/** A convention missing from the template's `AGENTS.md` does not exist. */
function docProblems(source: string | undefined): string[] {
  if (source === undefined) return ["no AGENTS.md"];
  const problems: string[] = [];
  const named = QUALITY_TIERS.every((tier) => source.includes(`\`${tier}\``));
  if (!source.includes("quality.ts") || !named) {
    problems.push("AGENTS.md does not name quality.ts and its three tiers");
  }
  if (!source.includes('tier: "low"')) problems.push("AGENTS.md does not show the tier override");
  return problems;
}

/**
 * Checks that every template ships the switch, reads it, records what each enabled stage costs,
 * and documents the tiers where an authoring agent will look.
 */
export async function checkTemplateQuality(root: string): Promise<ITemplateQualityReport> {
  const templatesDir = path.join(root, "packages", "create-threenative", "templates");
  const templates = await templateNames(templatesDir);
  const findings: ITemplateQualityFinding[] = [];
  for (const template of templates) {
    const render = path.join(templatesDir, template, "src", "render");
    const world = await readOptional(path.join(render, "worldEnvironment.ts"));
    const problems = [
      ...qualityProblems(await readOptional(path.join(render, "quality.ts"))),
      ...postprocessingProblems(await readOptional(path.join(render, "postprocessing.ts"))),
      ...docProblems(await readOptional(path.join(templatesDir, template, "AGENTS.md"))),
      ...(world === undefined
        ? ["no src/render/worldEnvironment.ts"]
        : eagerSurfaceNodes(world).map(
            (entry) =>
              `worldEnvironment.ts requests ${entry} eagerly — that attaches a colour target no fragment shader writes, and the frame renders black while the chain reports success`,
          )),
    ];
    for (const problem of problems) findings.push({ problem, template });
  }
  return { findings, templates };
}

export function formatTemplateQualityReport(report: ITemplateQualityReport): string {
  if (report.findings.length === 0) {
    return `template quality: ${report.templates.length} templates ship src/render/quality.ts, read it, and document it`;
  }
  const lines = [`TEMPLATE_QUALITY_INCOMPLETE: ${report.findings.length} problems`];
  for (const finding of report.findings) lines.push(`- ${finding.template}: ${finding.problem}`);
  return lines.join("\n");
}
