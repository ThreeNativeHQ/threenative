/**
 * A paired blind bundle: every template's frame before a change and after it, shuffled together.
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
 * Fails closed on anything that would quietly weaken the pairing: a missing frame, a template
 * present on one side only, or an empty set.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ImageScoringArtifact,
  createImageBlindBundle,
  hashPromptFile,
} from "./score-blind.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PROMPT = path.join(REPO_ROOT, "docs/product/VISUAL-BASELINE.md");

export interface VisualAbResult {
  readonly bundle: string;
  readonly pairs: readonly string[];
  readonly reveal: string;
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
  return { bundle, pairs: before, reveal };
}

function argumentValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = process.argv.slice(2);
    const before = argumentValue(args, "--before");
    const after = argumentValue(args, "--after");
    const out = argumentValue(args, "--out");
    if (before === undefined || after === undefined || out === undefined)
      throw new Error("Usage: tsx scripts/visual-ab.ts --before <dir> --after <dir> --out <dir>");
    process.stdout.write(`${JSON.stringify(buildVisualAbBundle(before, after, out), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
