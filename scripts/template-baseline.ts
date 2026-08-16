/**
 * Capture every template's first frame and bundle them for a blind score.
 *
 * `pnpm visuals` already scaffolds each template, boots it, and captures a headed WebGPU frame —
 * and then throws the frames away unless a human score file is already sitting on disk. Nothing
 * ever reads them. That is how four templates shipped a sky gradient which never reached the
 * screen: `typecheck`, `lint` and every playtest pass on a flat sky, and the one gate that looks
 * at a frame only checks it is not blank.
 *
 * This produces the missing number: one shuffled bundle of every template's frame, scored blind by
 * a critic that is never told which template it is looking at. The floor is the one
 * `docs/product/VISUAL-BASELINE.md` already states, 4 of 5.
 *
 * **A model score is not the human blind session.** The floor in that document is a human's to
 * certify; this drives the improvement loop and nothing more. Recorded as an instrument score
 * everywhere it appears.
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ImageScoringArtifact,
  createImageBlindBundle,
  hashPromptFile,
} from "./score-blind.js";
import {
  type IVisualCaptureOptions,
  TEMPLATE_NAMES,
  captureAllTemplates,
  packageLocalFramework,
} from "./visual-gate.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VISUAL_ROOT = path.join(REPO_ROOT, "docs/verification/visuals");
const BASELINE_PROMPT = path.join(REPO_ROOT, "docs/product/VISUAL-BASELINE.md");

export interface TemplateBaselineResult {
  readonly bundle: string;
  readonly captures: readonly { readonly template: string; readonly stats: unknown }[];
  readonly reveal: string;
}

export async function runTemplateBaseline(
  outputRoot = path.join(VISUAL_ROOT, "baseline"),
  options: IVisualCaptureOptions = {},
): Promise<TemplateBaselineResult> {
  const visualRoot = options.visualRoot ?? VISUAL_ROOT;
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "threenative-baseline-"));
  try {
    // A caller supplying its own capture is testing the bundling, not the GPU, and must not pay
    // for seven scaffolds and installs to do it.
    const packages =
      options.captureTemplate === undefined ? await packageLocalFramework(temporaryRoot) : {};
    const captures = await captureAllTemplates(temporaryRoot, packages, options);
    // Fail closed. A bundle missing a template is a baseline that silently covers less than it
    // claims, and the reader has no way to tell which template went missing.
    if (captures.length !== TEMPLATE_NAMES.length)
      throw new Error(
        `TN_BASELINE_INCOMPLETE: captured ${captures.length} of ${TEMPLATE_NAMES.length} templates.`,
      );

    const artifacts: ImageScoringArtifact[] = captures.map(({ template }) => ({
      arm: template,
      content: readCapture(template, visualRoot),
      id: `${template}-frame`,
    }));
    const bundle = path.join(outputRoot, "blind");
    const reveal = path.join(outputRoot, "reveal.json");
    createImageBlindBundle(
      hashPromptFile(BASELINE_PROMPT),
      artifacts,
      bundle,
      reveal,
      "threenative-template-baseline-v1",
      [...TEMPLATE_NAMES],
    );
    return {
      bundle,
      captures: captures.map(({ stats, template }) => ({ stats, template })),
      reveal,
    };
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

function readCapture(template: string, visualRoot: string): Buffer {
  // captureAllTemplates persists each frame through persistTemplateCapture, so the canonical copy
  // is already on disk; reading it back keeps one writer rather than two.
  return readFileSync(path.join(visualRoot, `${template}.png`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTemplateBaseline()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
