import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { assertCaptureNotBlank } from "../packages/playtest/dist/capture.js";
import {
  WEBGPU_BROWSER_ARGS,
  runStandalonePlaytest,
} from "../packages/playtest/dist/runner/index.js";
import { requireTemporalRenderEvidence } from "./temporal-aa-evidence.js";
import { type ILinearFrame, linearFrame, measureSequence } from "./temporal-aa-quality.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "artifacts/temporal-aa/motion");
const scenario = JSON.parse(
  await readFile(
    path.join(root, "examples/abyss-framework/playtests/temporal-motion.playtest.json"),
    "utf8",
  ),
);
const frames: Record<string, ILinearFrame[]> = {};
const provenance = [];
let poses: unknown[] | undefined;
for (const variant of [
  "supersampled",
  "reference",
  "temporal",
  "zero-velocity",
  "unchecked-history",
]) {
  const artifactDirectory = path.join(output, variant);
  await mkdir(artifactDirectory, { recursive: true });
  const scale = variant === "supersampled" ? 4 : 1;
  const scenarioPath = path.join(artifactDirectory, "scenario.json");
  await writeFile(
    scenarioPath,
    JSON.stringify({ ...scenario, viewport: { width: 640 * scale, height: 360 * scale } }, null, 2),
  );
  const report = await runStandalonePlaytest({
    allowSoftwareAdapter: true,
    artifactDirectory,
    browserArgs: [...WEBGPU_BROWSER_ARGS],
    headless: false,
    port: 0,
    projectPath: path.join(root, "examples/abyss-framework"),
    scenarioPath,
    server: {
      command:
        "pnpm exec vite build --config temporal.vite.config.ts && pnpm exec vite preview --config temporal.vite.config.ts --host 127.0.0.1 --port $PORT --strictPort",
      timeoutMs: 60_000,
    },
    timeoutMs: 120_000,
    trace: false,
    url: `http://127.0.0.1:5173/temporal.html?measure&variant=${variant}`,
  }).catch(async (error: unknown) => {
    await writeFile(
      path.join(artifactDirectory, "failure.json"),
      JSON.stringify(
        { variant, error: error instanceof Error ? error.stack : String(error) },
        null,
        2,
      ),
    );
    throw error;
  });
  await writeFile(path.join(artifactDirectory, "report.json"), JSON.stringify(report, null, 2));
  requireTemporalRenderEvidence(report, variant);
  const series = report.observations?.resourceSeries;
  assert.ok(series);
  assert.equal(series.length, 16, `${variant}: every captured frame needs an observation`);
  const currentPoses = [];
  const hashes = [];
  const currentFrames: ILinearFrame[] = [];
  frames[variant] = currentFrames;
  for (let index = 0; index < 16; index++) {
    const frame = index + 21;
    const sample: { label: string; tick: number; snapshots: Record<string, unknown> } | undefined =
      series[index];
    assert.ok(sample);
    const observed = sample.snapshots.temporal as {
      frame: number;
      pose: unknown;
      occluderVisible: boolean;
      aa: {
        frame: number;
        inputWidth: number;
        inputHeight: number;
        outputWidth: number;
        outputHeight: number;
        resetReason: string | null;
      } | null;
    };
    assert.equal(sample.label, `frame-${frame}`);
    assert.equal(sample.tick, frame);
    assert.equal(observed.frame, frame);
    assert.equal(observed.occluderVisible, frame <= 28);
    currentPoses.push(observed.pose);
    if (variant !== "supersampled" && variant !== "reference") {
      assert.ok(observed.aa);
      assert.equal(observed.aa.frame, frame, `${variant}: actual resolves must match simulation`);
      assert.deepEqual(
        [
          observed.aa.inputWidth,
          observed.aa.inputHeight,
          observed.aa.outputWidth,
          observed.aa.outputHeight,
        ],
        [640, 360, 640, 360],
      );
      assert.equal(
        observed.aa.resetReason,
        null,
        "Disocclusion must not be hidden by a global reset",
      );
    } else assert.equal(observed.aa, null);
    const filename = `frame-${frame}.png`;
    const bytes = await readFile(path.join(artifactDirectory, filename));
    const stats = assertCaptureNotBlank(bytes, `${variant}/${filename}`);
    assert.deepEqual([stats.width, stats.height], [640 * scale, 360 * scale]);
    currentFrames.push(linearFrame(PNG.sync.read(bytes), 640, 360));
    hashes.push({ frame, filename, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  if (poses)
    assert.deepEqual(currentPoses, poses, `${variant}: exact same camera/object poses required`);
  else poses = currentPoses;
  provenance.push({ variant, capture: report.capture, hashes });
}
const reference = frames.supersampled;
assert.ok(reference);
const results = Object.fromEntries(
  Object.entries(frames)
    .filter(([name]) => name !== "supersampled")
    .map(([name, frames]) => [name, measureSequence(reference, frames, 8)]),
);
const temporal = results.temporal;
const baseline = results.reference;
const unchecked = results["unchecked-history"]?.reveal[1];
const zeroVelocity = results["zero-velocity"];
assert.ok(temporal && baseline && unchecked && zeroVelocity);
assert.ok(
  temporal.movingEdgeError !== null && zeroVelocity.movingEdgeError !== null,
  "Moving-object edges must be measurable",
);
// Pinned before the first runtime measurement. These are a narrow-fixture experimental bar,
// not a claim of general image quality, native qualification or saved GPU time.
const checks = {
  edgeImprovement: temporal.edgeError < baseline.edgeError * 0.95,
  stabilityImprovement: temporal.residualInstability < baseline.residualInstability * 0.95,
  revealRecovery: temporal.reveal.slice(1).every((frame) => frame.staleFraction <= 0.01),
  uncheckedHistoryDetected: unchecked.staleFraction > 0.1,
  zeroVelocityDetected: zeroVelocity.movingEdgeError > temporal.movingEdgeError * 1.02,
};
const summary = {
  qualification:
    "Matched full-resolution AA measurement only. Software WebGPU; no native, reconstruction or GPU performance claim. Rejection fraction remains unmeasured.",
  method: {
    width: 640,
    height: 360,
    referenceRasterScale: 4,
    colourSpace: "linear RGB decoded from opaque sRGB screenshots",
    frames: [21, 36],
    revealFrame: 29,
    edgeGradientThreshold: 0.08,
    ghostInteriorInset: 2,
    staleColourWeightThreshold: 0.1,
    minimumRelativeImprovement: 0.05,
    maximumStaleFractionAfterOneFrame: 0.01,
    zeroVelocityMinimumRelativeDegradation: 0.02,
    movingEdgeRegion: "reference RGB saturation above 0.25 excluding the red reveal marker",
  },
  negativeControl:
    "unchecked-history renders a 95% unchecked history blend; it bypasses both depth rejection and neighbourhood clipping and does not isolate their individual effects",
  pass: Object.values(checks).every(Boolean),
  checks,
  results,
  provenance,
};
await writeFile(path.join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ checks, results }, null, 2));
assert.ok(
  summary.pass,
  `Temporal motion quality remains unqualified: ${JSON.stringify(checks)}; actual frames and full measurements retained at ${output}`,
);
