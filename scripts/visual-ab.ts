/**
 * A paired blind bundle: every template's frame before a change and after it, shuffled together —
 * and the measurement of how far apart two scores have to be before this instrument can tell them
 * apart at all.
 *
 * Round 10 scored the before frames with one critic and the after frames with another, and read
 * the difference as a result. It was not one. A template nobody touched moved a full point between
 * those two raters, so most of the round's deltas were rater variance wearing a result's clothes.
 *
 * Averaging more raters per condition does not fix that — it shrinks the error bar without removing
 * the bias, and it costs a rater per condition per round. Putting both conditions in **one** bundle
 * does fix it: each rater scores before and after, so whatever that rater's personal calibration is,
 * it lands on both sides and cancels in the difference. The comparison stops depending on two
 * strangers agreeing about what a 3 is.
 *
 * Pairing alone still does not say what a delta is worth. That number is measured **in the same
 * bundle that produced the scores**, from duplicate pairs: byte-identical frames carried twice under
 * different shuffled identifiers. A rater's two scores for one image are its self-consistency, and
 * the widest such disagreement in the run is the run's resolution — its minimum detectable effect.
 * Any delta at or under it is `INDETERMINATE`, and `INDETERMINATE` rows are excluded from every
 * aggregate rather than quietly averaged in.
 *
 * Fails closed on anything that would quietly weaken either half: a missing frame, a template
 * present on one side only, an empty set, a bundle with no duplicate pair, fewer verdicts than
 * raters were asked for, or a verdict that does not parse. None of those fall back to reporting
 * scores without a resolution — an instrument that cannot measure its own resolution reporting
 * numbers anyway is the v1 harness defect this repository exists downstream of.
 *
 * **A model score is not the human blind session** `docs/product/VISUAL-BASELINE.md` requires. This
 * sharpens a model instrument and claims nothing else.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ImageScoringArtifact,
  createImageBlindBundle,
  hashPromptFile,
} from "./score-blind.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PROMPT = path.join(REPO_ROOT, "docs/product/VISUAL-BASELINE.md");

/** The floor `docs/product/VISUAL-BASELINE.md` states, reused here and never redefined. */
export const VISUAL_FLOOR = 4;
/** How many duplicate pairs a bundle carries unless a caller says otherwise. */
export const DEFAULT_DUPLICATE_PAIRS = 2;

export type AbClassification = "WIN" | "LOSS" | "INDETERMINATE";

export interface VisualAbResult {
  readonly bundle: string;
  /** Arm identifiers of the injected copies, each paired with the arm it duplicates. */
  readonly duplicates: readonly { readonly copy: string; readonly of: string }[];
  readonly pairs: readonly string[];
  readonly reveal: string;
}

export interface VisualAbClassifiedRow {
  readonly after: number;
  readonly before: number;
  readonly classification: AbClassification;
  readonly delta: number;
  readonly template: string;
}

export interface VisualAbDuplicateSpread {
  readonly copy: string;
  readonly of: string;
  readonly rater: string;
  readonly spread: number;
}

export interface VisualAbScore {
  readonly aggregate: {
    readonly atFloor: number;
    readonly counted: number;
    readonly excluded: number;
    readonly meanAfter: number | null;
  };
  readonly duplicateSpreads: readonly VisualAbDuplicateSpread[];
  readonly mde: number;
  readonly raters: readonly string[];
  readonly rows: readonly VisualAbClassifiedRow[];
}

/**
 * Every failure here carries the exit code the PRD's table promises, because the codes are the
 * contract: `1` is a measured regression and `2` is "this run never reached a verdict". Collapsing
 * the second into the first would report a missing rater as a visual loss.
 */
export class VisualAbError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 2) {
    super(message);
    this.name = "VisualAbError";
    this.exitCode = exitCode;
  }
}

function frameNames(directory: string): string[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith(".png"))
    .map((file) => file.slice(0, -4))
    .sort();
}

export function buildVisualAbBundle(
  beforeDirectory: string,
  afterDirectory: string,
  outputRoot: string,
  promptFile = BASELINE_PROMPT,
  duplicatePairs = DEFAULT_DUPLICATE_PAIRS,
): VisualAbResult {
  const before = frameNames(beforeDirectory);
  const after = frameNames(afterDirectory);
  if (before.length === 0) throw new Error(`TN_VISUAL_AB_EMPTY: no frames in ${beforeDirectory}.`);

  // Both sides must carry exactly the same templates. A template on one side only would be scored
  // as an unpaired sample and silently drag the aggregate, which is the failure this file exists to
  // prevent rather than a smaller version of it.
  const onlyBefore = before.filter((name) => !after.includes(name));
  const onlyAfter = after.filter((name) => !before.includes(name));
  if (onlyBefore.length > 0 || onlyAfter.length > 0)
    throw new Error(
      `TN_VISUAL_AB_UNPAIRED: before-only [${onlyBefore.join(", ")}], after-only [${onlyAfter.join(", ")}].`,
    );
  if (duplicatePairs > before.length)
    throw new Error(
      `TN_VISUAL_AB_DUPLICATES: asked for ${duplicatePairs} duplicate pairs from ${before.length} templates.`,
    );

  const artifacts: ImageScoringArtifact[] = before.flatMap((name) => [
    {
      arm: `${name}::before`,
      content: readFileSync(path.join(beforeDirectory, `${name}.png`)),
      id: `${name}-before`,
    },
    {
      arm: `${name}::after`,
      content: readFileSync(path.join(afterDirectory, `${name}.png`)),
      id: `${name}-after`,
    },
  ]);

  // The duplicates are byte-identical copies of frames already in the bundle, carried under their
  // own arm identifiers. The shuffle scatters them, so a rater has no way to notice it is scoring
  // the same image twice — which is the only reason the spread between those two scores means
  // anything.
  const duplicates = before.slice(0, duplicatePairs).map((name) => ({
    copy: `${name}::before::duplicate`,
    of: `${name}::before`,
  }));
  for (const { copy, of } of duplicates) {
    const source = artifacts.find((artifact) => artifact.arm === of);
    if (source === undefined) throw new Error(`TN_VISUAL_AB_DUPLICATES: no frame for ${of}.`);
    artifacts.push({ arm: copy, content: source.content, id: copy.replace(/::/gu, "-") });
  }

  const bundle = path.join(outputRoot, "blind");
  const reveal = path.join(outputRoot, "reveal.json");
  createImageBlindBundle(
    hashPromptFile(promptFile),
    artifacts,
    bundle,
    reveal,
    "threenative-visual-ab-v1",
    artifacts.map(({ arm }) => arm),
  );
  return { bundle, duplicates, pairs: before, reveal };
}

interface RevealEntry {
  readonly arm: string;
  readonly id: string;
  readonly label: string;
}

function readJson(file: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new VisualAbError(`TN_VISUAL_AB_VERDICT_UNREADABLE: cannot read ${file}.`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    // Never silently drop to the raters that did parse. A run that quietly scores with two of the
    // three it was asked for reports a number nobody requested.
    throw new VisualAbError(
      `TN_VISUAL_AB_VERDICT_UNPARSEABLE: ${file} is not JSON (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
}

/** One rater's scores, keyed by the shuffled label it saw. */
function readVerdict(file: string): Map<string, number> {
  const parsed = readJson(file);
  const samples = (parsed as { samples?: unknown }).samples;
  if (!Array.isArray(samples) || samples.length === 0)
    throw new VisualAbError(`TN_VISUAL_AB_VERDICT_MALFORMED: ${file} has no samples array.`);
  const scores = new Map<string, number>();
  for (const sample of samples) {
    const label = (sample as { label?: unknown }).label;
    const visuals = (sample as { visuals?: unknown }).visuals;
    if (typeof label !== "string" || label.length === 0)
      throw new VisualAbError(
        `TN_VISUAL_AB_VERDICT_MALFORMED: ${file} has a sample with no label.`,
      );
    if (typeof visuals !== "number" || !Number.isInteger(visuals) || visuals < 1 || visuals > 5)
      throw new VisualAbError(
        `TN_VISUAL_AB_VERDICT_MALFORMED: ${file} scores ${label} as ${String(visuals)}; expected an integer 1-5.`,
      );
    if (scores.has(label))
      throw new VisualAbError(`TN_VISUAL_AB_VERDICT_MALFORMED: ${file} scores ${label} twice.`);
    scores.set(label, visuals);
  }
  return scores;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function parseArm(arm: string): { condition: string; duplicate: boolean; template: string } {
  const [template = "", condition = "", suffix] = arm.split("::");
  return { condition, duplicate: suffix === "duplicate", template };
}

export function scoreVisualAb(
  revealFile: string,
  verdictFiles: readonly string[],
  requestedRaters: number,
): VisualAbScore {
  if (verdictFiles.length !== requestedRaters)
    throw new VisualAbError(
      `TN_VISUAL_AB_RATER_SHORTFALL: ${requestedRaters} rater(s) requested, ${verdictFiles.length} verdict file(s) supplied.`,
    );
  const reveal = readJson(revealFile) as RevealEntry[];
  if (!Array.isArray(reveal) || reveal.length === 0)
    throw new VisualAbError(`TN_VISUAL_AB_EMPTY: ${revealFile} maps no samples.`);

  const byArm = new Map(reveal.map((entry) => [entry.arm, entry.label]));
  const duplicates = reveal
    .map((entry) => parseArm(entry.arm))
    .filter((parsed) => parsed.duplicate)
    .map((parsed) => ({
      copy: `${parsed.template}::${parsed.condition}::duplicate`,
      of: `${parsed.template}::${parsed.condition}`,
    }));
  if (duplicates.length === 0)
    throw new VisualAbError(
      "TN_VISUAL_AB_NO_DUPLICATE_PAIR: the bundle carries no duplicate pair, so its resolution cannot be measured and no score may be reported.",
    );

  const verdicts = verdictFiles.map((file) => ({ file, scores: readVerdict(file) }));
  for (const { file, scores } of verdicts) {
    for (const entry of reveal)
      if (!scores.has(entry.label))
        throw new VisualAbError(
          `TN_VISUAL_AB_VERDICT_INCOMPLETE: ${file} has no score for ${entry.label}.`,
        );
  }

  // The resolution, measured in this bundle by this run's own raters. `max` rather than a mean:
  // the widest self-disagreement observed is what the instrument could not tell apart, and taking
  // an average of it would report a resolution finer than something actually failed at.
  const duplicateSpreads: VisualAbDuplicateSpread[] = [];
  for (const { copy, of } of duplicates) {
    const copyLabel = byArm.get(copy);
    const ofLabel = byArm.get(of);
    if (copyLabel === undefined || ofLabel === undefined)
      throw new VisualAbError(`TN_VISUAL_AB_NO_DUPLICATE_PAIR: ${copy} has no partner in ${of}.`);
    for (const { file, scores } of verdicts)
      duplicateSpreads.push({
        copy,
        of,
        rater: path.basename(file),
        spread: Math.abs((scores.get(copyLabel) as number) - (scores.get(ofLabel) as number)),
      });
  }
  const mde = Math.max(...duplicateSpreads.map(({ spread }) => spread));

  const templates = [
    ...new Set(
      reveal
        .map((entry) => parseArm(entry.arm))
        .filter((parsed) => !parsed.duplicate)
        .map((parsed) => parsed.template),
    ),
  ].sort();

  const rows: VisualAbClassifiedRow[] = templates.map((template) => {
    const scoreFor = (condition: string): number => {
      const label = byArm.get(`${template}::${condition}`);
      if (label === undefined)
        throw new VisualAbError(`TN_VISUAL_AB_UNPAIRED: ${template} has no ${condition} frame.`);
      return median(verdicts.map(({ scores }) => scores.get(label) as number));
    };
    const before = scoreFor("before");
    const after = scoreFor("after");
    const delta = after - before;
    const classification: AbClassification =
      Math.abs(delta) <= mde ? "INDETERMINATE" : delta > 0 ? "WIN" : "LOSS";
    return { after, before, classification, delta, template };
  });

  // Excluded rows are excluded, not down-weighted. A number the instrument could not resolve has no
  // business inside a mean that will be quoted as this round's result.
  const counted = rows.filter((row) => row.classification !== "INDETERMINATE");
  return {
    aggregate: {
      atFloor: counted.filter((row) => row.after >= VISUAL_FLOOR).length,
      counted: counted.length,
      excluded: rows.length - counted.length,
      meanAfter:
        counted.length === 0
          ? null
          : counted.reduce((total, row) => total + row.after, 0) / counted.length,
    },
    duplicateSpreads,
    mde,
    raters: verdictFiles.map((file) => path.basename(file)),
    rows,
  };
}

export function renderVisualAbMarkdown(score: VisualAbScore): string {
  const lines = [
    `**Minimum detectable effect: ${score.mde}** — measured from ${score.duplicateSpreads.length} duplicate-pair observation(s) across ${score.raters.length} rater(s) in this bundle.`,
    "",
    "| Template | Before | After | Δ | Verdict |",
    "| --- | --- | --- | --- | --- |",
    ...score.rows.map(
      (row) =>
        `| ${row.template} | ${row.before} | ${row.after} | ${row.delta > 0 ? "+" : ""}${row.delta} | ${row.classification} |`,
    ),
    "",
    score.aggregate.counted === 0
      ? `**No aggregate.** All ${score.rows.length} row(s) are INDETERMINATE at this resolution; there is nothing left to average.`
      : `**Aggregate over the ${score.aggregate.counted} resolvable row(s)** — mean after ${(score.aggregate.meanAfter as number).toFixed(2)}, ${score.aggregate.atFloor} at the ${VISUAL_FLOOR}/5 floor. ${score.aggregate.excluded} row(s) excluded as INDETERMINATE.`,
    "",
    "Duplicate-pair spreads:",
    "",
    "| Rater | Pair | Spread |",
    "| --- | --- | --- |",
    ...score.duplicateSpreads.map(
      (spread) => `| ${spread.rater} | ${spread.of} | ${spread.spread} |`,
    ),
    "",
    "A model instrument, not the human blind session `docs/product/VISUAL-BASELINE.md` requires.",
  ];
  return lines.join("\n");
}

function argumentValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function argumentValues(args: readonly string[], name: string): string[] {
  return args.flatMap((arg, index) => (arg === name ? [args[index + 1] ?? ""] : []));
}

export function runCli(args: readonly string[]): number {
  const before = argumentValue(args, "--before");
  const after = argumentValue(args, "--after");
  const out = argumentValue(args, "--out");
  if (before === undefined || after === undefined || out === undefined) {
    process.stderr.write(
      "Usage: pnpm visuals:ab --before <dir> --after <dir> --out <dir> [--duplicates n] [--raters n --verdict <file> ...]\n",
    );
    return 2;
  }
  const duplicates = Number(argumentValue(args, "--duplicates") ?? DEFAULT_DUPLICATE_PAIRS);
  const raters = Number(argumentValue(args, "--raters") ?? 3);
  const verdicts = argumentValues(args, "--verdict").filter((file) => file.length > 0);

  const built = buildVisualAbBundle(before, after, out, BASELINE_PROMPT, duplicates);
  if (verdicts.length === 0) {
    // Building is not scoring. Exit 2 is exactly right here: the bundle is ready and the run has
    // not reached a verdict, which is the state this code must never print scores from.
    //
    // And it prints counts rather than the mapping. Naming the duplicated arms here tells anyone
    // reading the same terminal which template is carried twice, which is most of what the
    // duplicate pair exists to hide. The mapping lives in `reveal.json`, outside the bundle,
    // where a rater has no reason to look.
    process.stdout.write(
      `${JSON.stringify(
        {
          bundle: built.bundle,
          duplicatePairs: built.duplicates.length,
          reveal: built.reveal,
          templates: built.pairs.length,
        },
        null,
        2,
      )}\n`,
    );
    process.stderr.write(
      `TN_VISUAL_AB_NO_VERDICT: bundle written to ${built.bundle}. ${raters} rater(s) requested; score it and re-run with --verdict.\n`,
    );
    return 2;
  }

  const score = scoreVisualAb(built.reveal, verdicts, raters);
  const markdown = renderVisualAbMarkdown(score);
  process.stdout.write(`${markdown}\n`);
  const reportFile = path.join(out, "score.json");
  writeFileSync(reportFile, `${JSON.stringify(score, null, 2)}\n`);
  process.stderr.write(`wrote ${reportFile}\n`);
  return score.rows.some((row) => row.classification === "LOSS") ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof VisualAbError ? error.exitCode : 2;
  }
}
