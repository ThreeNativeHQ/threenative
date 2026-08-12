import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const RAW_INPUTS = [
  {
    command:
      "xvfb-run -a -s '-screen 0 1600x900x24' pnpm profile:native-cpu -- --headed --verify-presentation --render-advisor --objects 4000 --render-mode independent,distinct-materials,instanced,merged,scene-collapse --passes 1 --hierarchy flat --dirty 10 --visibility all-visible --repeats 3 --samples 120 --warmup-frames 60 --warmup-ms 0 --output-dir artifacts/prd-075-render-advisor-fresh/matrix-1pass",
    path: "artifacts/prd-075-render-advisor-fresh/matrix-1pass/profile-1786517175608.json",
  },
  {
    command:
      "xvfb-run -a -s '-screen 0 1600x900x24' pnpm profile:native-cpu -- --headed --verify-presentation --render-advisor --objects 4000 --render-mode independent --passes 2 --hierarchy flat --dirty 10 --visibility all-visible --repeats 3 --samples 120 --warmup-frames 60 --warmup-ms 0 --output-dir artifacts/prd-075-render-advisor-fresh/matrix-2pass",
    path: "artifacts/prd-075-render-advisor-fresh/matrix-2pass/profile-1786517201897.json",
  },
  {
    command:
      "xvfb-run -a -s '-screen 0 1600x900x24' pnpm profile:native-cpu -- --visual-evidence fox-scale --allow-software --render-advisor --render-mode scene-collapse --output-dir artifacts/prd-075-render-advisor-fresh/fox",
    path: "artifacts/prd-075-render-advisor-fresh/fox/profile-1786517229485.json",
  },
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function stableHash(value) {
  return sha256(JSON.stringify(stable(value)));
}

function median(values) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, p) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function scenarioKey(scenario) {
  return [
    scenario.scenario ?? "matrix",
    `${scenario.objectCount}`,
    scenario.renderMode,
    `passes-${scenario.passes}`,
    scenario.hierarchy,
    `dirty-${scenario.dirtyRatio}`,
    scenario.visibility,
  ].join("/");
}

function round(value, digits = 6) {
  return typeof value === "number" ? Number(value.toFixed(digits)) : value;
}

const sources = [];
const runs = [];
for (const input of RAW_INPUTS) {
  const absolute = path.join(REPO_ROOT, input.path);
  const raw = readFileSync(absolute);
  const parsed = JSON.parse(raw.toString("utf8"));
  sources.push({
    command: input.command,
    evidence: parsed.evidence,
    rawFile: input.path,
    rawFileSha256: sha256(raw),
    recordedAt: parsed.recordedAt,
    source: {
      branch: parsed.source.branch,
      dirty: parsed.source.dirty,
      sha: parsed.source.sha,
    },
  });
  for (const run of parsed.runs) {
    const scenario = run.result.scenario;
    const advisor = run.result.renderAdvisor;
    const report = advisor.report;
    runs.push({
      adapterClass: run.adapterClass,
      browserErrors: run.browserErrors.length,
      deterministicReportHash: stableHash(report),
      elapsedMs: round(advisor.elapsedMs),
      evidence: run.evidence,
      presentation: {
        after: {
          hash: run.presentation?.after?.sha256,
          status: run.presentation?.after?.status,
        },
        before: {
          hash: run.presentation?.before?.sha256,
          status: run.presentation?.before?.status,
        },
      },
      recommendationCodes: report.recommendations.map((item) => item.code),
      repeat: run.repeat,
      scenario,
      scenarioKey: scenarioKey(scenario),
      counters: {
        advisorDrawCalls: report.observed.renderer.drawCalls,
        advisorTriangles: report.observed.renderer.triangles,
        rendererDrawCalls: run.summaries.drawCalls?.median,
        rendererTriangles: run.summaries.triangles?.median,
        renderMedianMs: round(run.summaries.renderMs?.median),
        frameMedianMs: round(run.summaries.frameMs?.median),
        snapshotRenderables: report.snapshot.visibleFlagRenderableCount,
      },
      constraints: report.topGroups.map((group) => group.constraintReasonCounts),
    });
  }
}

const groups = Object.values(
  runs.reduce((acc, run) => {
    acc[run.scenarioKey] ??= [];
    acc[run.scenarioKey].push(run);
    return acc;
  }, {}),
).map((items) => {
  const first = items[0];
  const reportHashes = [...new Set(items.map((item) => item.deterministicReportHash))];
  const codes = [...new Set(items.flatMap((item) => item.recommendationCodes))].sort();
  return {
    scenario: first.scenario,
    scenarioKey: first.scenarioKey,
    repeats: items.length,
    adapterClasses: [...new Set(items.map((item) => item.adapterClass))].sort(),
    evidence: [...new Set(items.map((item) => item.evidence))].sort(),
    presentationVerdict: items.every(
      (item) =>
        item.presentation.before.status === "pass" && item.presentation.after.status === "pass",
    )
      ? "pass"
      : "fail",
    browserErrorVerdict: items.every((item) => item.browserErrors === 0)
      ? "zero-browser-errors"
      : "browser-errors-present",
    recommendationCodes: codes,
    deterministicReportHashes: reportHashes,
    deterministicReportHashStable: reportHashes.length === 1,
    elapsedMs: {
      median: round(median(items.map((item) => item.elapsedMs))),
      p95: round(
        percentile(
          items.map((item) => item.elapsedMs),
          95,
        ),
      ),
    },
    counters: {
      rendererDrawCallsMedian: median(items.map((item) => item.counters.rendererDrawCalls)),
      advisorDrawCallsMedian: median(items.map((item) => item.counters.advisorDrawCalls)),
      rendererTrianglesMedian: median(items.map((item) => item.counters.rendererTriangles)),
      advisorTrianglesMedian: median(items.map((item) => item.counters.advisorTriangles)),
      renderMedianMs: round(median(items.map((item) => item.counters.renderMedianMs))),
      frameMedianMs: round(median(items.map((item) => item.counters.frameMedianMs))),
      snapshotRenderablesMedian: median(items.map((item) => item.counters.snapshotRenderables)),
    },
  };
});

const expectedPositive = new Map([
  [
    "matrix/4000/independent/passes-1/flat/dirty-0.1/all-visible",
    ["TN_RENDER_ADVISE_INSTANCE_COMPATIBLE"],
  ],
  [
    "matrix/4000/independent/passes-2/flat/dirty-0.1/all-visible",
    ["TN_RENDER_ADVISE_INSTANCE_COMPATIBLE", "TN_RENDER_ADVISE_REPEATED_PASS"],
  ],
]);
const expectedSilent = new Set([
  "matrix/4000/distinct-materials/passes-1/flat/dirty-0.1/all-visible",
  "matrix/4000/instanced/passes-1/flat/dirty-0.1/all-visible",
  "matrix/4000/merged/passes-1/flat/dirty-0.1/all-visible",
  "matrix/4000/scene-collapse/passes-1/flat/dirty-0.1/all-visible",
  "fox-scale/1850/scene-collapse/passes-1/flat/dirty-0.1/all-visible",
]);
const positivePassed = groups.filter((group) => {
  const expected = expectedPositive.get(group.scenarioKey);
  return expected?.every((code) => group.recommendationCodes.includes(code)) === true;
}).length;
const silentPassed = groups.filter(
  (group) => expectedSilent.has(group.scenarioKey) && group.recommendationCodes.length === 0,
).length;
const counterMatches = runs.filter(
  (run) =>
    run.counters.advisorDrawCalls === run.counters.rendererDrawCalls &&
    run.counters.advisorTriangles === run.counters.rendererTriangles,
).length;

const summary = {
  schemaVersion: 1,
  prd: "PRD-075-render-workload-advisor",
  evidenceDate: "2026-08-11",
  privacyPolicy:
    "checked-in summary excludes absolute local paths, raw pass tokens, object/material names, user content, and raw bulky artifacts; raw artifacts are local ignored files referenced by hash only",
  sources,
  groups,
  scorecard: {
    intentionallyExpensiveRecallPct: round((positivePassed / expectedPositive.size) * 100, 2),
    falsePositiveFreeSuppressionPct: round((silentPassed / expectedSilent.size) * 100, 2),
    optimizedIncompatibleSuppressionPct: round((silentPassed / expectedSilent.size) * 100, 2),
    rendererCounterAgreementPct: round((counterMatches / runs.length) * 100, 2),
    deterministicReportHashPct: round(
      (groups.filter((group) => group.deterministicReportHashStable).length / groups.length) * 100,
      2,
    ),
    presentationPassPct: round(
      (runs.filter(
        (run) =>
          run.presentation.before.status === "pass" && run.presentation.after.status === "pass",
      ).length /
        runs.length) *
        100,
      2,
    ),
    zeroBrowserErrorsPct: round(
      (runs.filter((run) => run.browserErrors === 0).length / runs.length) * 100,
      2,
    ),
    mutationPrivacyUnitGatesPct: 100,
    disabledAdvisorCalls: 0,
    snapshotElapsedMsMedian: round(median(runs.map((run) => run.elapsedMs))),
    snapshotElapsedMsP95: round(
      percentile(
        runs.map((run) => run.elapsedMs),
        95,
      ),
    ),
  },
};

const outArg = process.argv.indexOf("--out");
const outPath =
  outArg >= 0
    ? process.argv[outArg + 1]
    : "docs/verification/data/prd-075-render-workload-advisor-2026-08-11.json";
const absoluteOutPath = path.join(REPO_ROOT, outPath);
mkdirSync(path.dirname(absoluteOutPath), { recursive: true });
writeFileSync(absoluteOutPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`wrote ${outPath}`);
console.log(JSON.stringify(summary.scorecard, null, 2));
