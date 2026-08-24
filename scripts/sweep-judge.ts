import fs from "node:fs";
import path from "node:path";
import { assertFrameShowsSomething } from "./capture-guard.js";
import { hasArmIdentifier } from "./score-blind.js";
import { isRecord } from "./utils.js";

export interface PolishScore {
  readonly behavior: number;
  readonly visuals: number;
  readonly effects: number;
  readonly particles: number;
  readonly audio: number | "na";
  readonly ux: number;
}

export interface JudgeSample {
  readonly biggestGap: string;
  readonly evidence: string;
  readonly label: string;
  readonly playability: number;
  readonly screenshotWorthy: "no" | "yes";
  readonly visuals: number;
  /** Optional v2 rubric. If supplied, every blind sample must supply it. */
  readonly polish?: PolishScore;
  readonly polishAverage?: number;
}

export interface JudgeInput {
  readonly comparisonVerdict: {
    readonly betterSample: string;
    readonly confidence: "high" | "low" | "medium";
    readonly rationale: string;
  };
  readonly samples: readonly JudgeSample[];
}

export interface JudgeResult extends JudgeInput {
  readonly verdict: "ready";
}

interface ImageManifest {
  readonly promptSha256: string;
  readonly samples: readonly { image: string; label: string }[];
  readonly verdict: "ready";
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`TN_JUDGE_INVALID_JSON: ${file}: ${String(error)}`);
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function score(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

function parsePolish(value: unknown): PolishScore | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("TN_JUDGE_INVALID: polish must be an object.");
  if (
    !score(value.behavior) ||
    !score(value.visuals) ||
    !score(value.effects) ||
    !score(value.particles) ||
    !(score(value.audio) || value.audio === "na") ||
    !score(value.ux)
  ) {
    throw new Error(
      "TN_JUDGE_INVALID: polish needs 1-5 behavior, visuals, effects, particles, and UX scores plus audio 1-5 or na.",
    );
  }
  return {
    behavior: value.behavior,
    visuals: value.visuals,
    effects: value.effects,
    particles: value.particles,
    audio: value.audio,
    ux: value.ux,
  };
}

function polishAverage(polish: PolishScore): number {
  const values = [
    polish.behavior,
    polish.visuals,
    polish.effects,
    polish.particles,
    polish.audio === "na" ? undefined : polish.audio,
    polish.ux,
  ].filter((value): value is number => value !== undefined);
  return Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2));
}

function parseJudgeInput(value: unknown): JudgeInput {
  if (!isRecord(value) || !Array.isArray(value.samples) || !isRecord(value.comparisonVerdict)) {
    throw new Error("TN_JUDGE_INVALID: expected samples and comparisonVerdict.");
  }
  const samples = value.samples.map((sample) => {
    if (
      !isRecord(sample) ||
      !nonEmptyString(sample.label) ||
      !score(sample.playability) ||
      !score(sample.visuals) ||
      (sample.screenshotWorthy !== "yes" && sample.screenshotWorthy !== "no") ||
      !nonEmptyString(sample.evidence) ||
      !nonEmptyString(sample.biggestGap)
    ) {
      throw new Error("TN_JUDGE_INVALID: every sample needs bounded scores and evidence.");
    }
    const screenshotWorthy = sample.screenshotWorthy as "no" | "yes";
    const polish = parsePolish(sample.polish);
    return {
      biggestGap: sample.biggestGap,
      evidence: sample.evidence,
      label: sample.label,
      playability: sample.playability,
      screenshotWorthy,
      visuals: sample.visuals,
      ...(polish === undefined ? {} : { polish, polishAverage: polishAverage(polish) }),
    };
  });
  const polishPresence = samples.map((sample) => sample.polish !== undefined);
  if (polishPresence.some(Boolean) && polishPresence.some((present) => !present))
    throw new Error("TN_JUDGE_INVALID: either every blind sample has polish scores or none do.");
  const comparison = value.comparisonVerdict;
  if (
    !nonEmptyString(comparison.betterSample) ||
    !["low", "medium", "high"].includes(comparison.confidence as string) ||
    !nonEmptyString(comparison.rationale)
  ) {
    throw new Error("TN_JUDGE_INVALID: comparison verdict is incomplete.");
  }
  return {
    comparisonVerdict: {
      betterSample: comparison.betterSample,
      confidence: comparison.confidence as JudgeInput["comparisonVerdict"]["confidence"],
      rationale: comparison.rationale,
    },
    samples,
  };
}

function validateManifest(bundle: string): ImageManifest {
  const manifestPath = path.join(bundle, "bundle.json");
  const value = readJson(manifestPath);
  if (
    !isRecord(value) ||
    value.verdict !== "ready" ||
    !nonEmptyString(value.promptSha256) ||
    !Array.isArray(value.samples) ||
    value.samples.length === 0
  ) {
    throw new Error("TN_JUDGE_INVALID_BUNDLE: bundle.json is missing a ready sample set.");
  }
  if (hasArmIdentifier(JSON.stringify(value))) {
    throw new Error("TN_JUDGE_VOID: arm identifier found in bundle.json.");
  }
  const samples = value.samples.map((sample) => {
    if (!isRecord(sample) || !nonEmptyString(sample.label) || !nonEmptyString(sample.image)) {
      throw new Error("TN_JUDGE_INVALID_BUNDLE: sample entry is malformed.");
    }
    const relative = path.relative(bundle, path.resolve(bundle, sample.image));
    if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`TN_JUDGE_VOID: sample escapes bundle: ${sample.image}`);
    }
    const imagePath = path.resolve(bundle, sample.image);
    if (!fs.existsSync(imagePath))
      throw new Error(`TN_JUDGE_INVALID_BUNDLE: missing ${sample.image}.`);
    if (hasArmIdentifier(sample.image)) {
      throw new Error(`TN_JUDGE_VOID: arm identifier found in filename ${sample.image}.`);
    }
    assertFrameShowsSomething(fs.readFileSync(imagePath), sample.label);
    return { image: sample.image, label: sample.label };
  });
  if (new Set(samples.map(({ label }) => label)).size !== samples.length) {
    throw new Error("TN_JUDGE_INVALID_BUNDLE: duplicate sample label.");
  }
  return { promptSha256: value.promptSha256, samples, verdict: "ready" };
}

export function runJudge(
  bundleDirectory: string,
  inputPath: string,
  outputPath = path.join(bundleDirectory, "judge.json"),
): JudgeResult {
  const bundle = path.resolve(bundleDirectory);
  const manifest = validateManifest(bundle);
  const rawInput = fs.readFileSync(inputPath, "utf8");
  if (hasArmIdentifier(rawInput))
    throw new Error("TN_JUDGE_VOID: critic input contains an arm identifier.");
  const input = parseJudgeInput(JSON.parse(rawInput) as unknown);
  const labels = new Set(manifest.samples.map(({ label }) => label));
  if (
    input.samples.length !== manifest.samples.length ||
    input.samples.some((sample) => !labels.has(sample.label)) ||
    new Set(input.samples.map((sample) => sample.label)).size !== input.samples.length
  ) {
    throw new Error("TN_JUDGE_INVALID: critic samples do not match the blind bundle.");
  }
  if (
    input.comparisonVerdict.betterSample !== "tie" &&
    !labels.has(input.comparisonVerdict.betterSample)
  ) {
    throw new Error("TN_JUDGE_INVALID: comparison verdict names an unknown sample.");
  }
  const result: JudgeResult = { ...input, verdict: "ready" };
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function argumentValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function main(): void {
  const bundle = process.argv[2];
  const input = argumentValue(process.argv.slice(3), "--input");
  if (bundle === undefined || input === undefined) {
    throw new Error("Usage: pnpm sweep:judge <bundle> --input <critic.json> [--out <judge.json>].");
  }
  const output = argumentValue(process.argv.slice(3), "--out");
  process.stdout.write(
    `${JSON.stringify(runJudge(bundle, input, output === undefined ? path.join(bundle, "judge.json") : output), null, 2)}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
