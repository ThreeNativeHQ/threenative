import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function latestJson(dir) {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort();
  if (files.length === 0) throw new Error(`No json in ${dir}`);
  return path.join(dir, files.at(-1));
}

function loadLatest(dir) {
  const file = latestJson(dir);
  return { file, json: JSON.parse(readFileSync(file, "utf8")) };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function runMedians(report, metric) {
  return report.runs.map((run) => run.summaries[metric].median);
}

function runP95s(report, metric) {
  return report.runs.map((run) => run.summaries[metric].p95);
}

function pct(candidate, control) {
  return ((candidate - control) / control) * 100;
}

function compareReports(control, candidate) {
  const metrics = [
    "renderMs",
    "frameMs",
    "matrixWorldMs",
    "drawCalls",
    "triangles",
    "logicalObjects",
    "visibleCount",
  ];
  return Object.fromEntries(
    metrics.map((metric) => {
      const cMed = median(runMedians(control, metric));
      const iMed = median(runMedians(candidate, metric));
      const cP95 = median(runP95s(control, metric));
      const iP95 = median(runP95s(candidate, metric));
      return [
        metric,
        {
          controlMedian: cMed,
          candidateMedian: iMed,
          medianDeltaPct: pct(iMed, cMed),
          controlP95: cP95,
          candidateP95: iP95,
          p95DeltaPct: pct(iP95, cP95),
        },
      ];
    }),
  );
}

function keyOf(run) {
  const scenario = run.result.scenario;
  return [
    scenario.objectCount,
    scenario.renderMode,
    scenario.passes,
    scenario.hierarchy,
    scenario.dirtyRatio,
    scenario.visibility,
  ].join("|");
}

function aggregateMatrix(report) {
  const groups = new Map();
  for (const run of report.runs) {
    const key = keyOf(run);
    const arr = groups.get(key) ?? [];
    arr.push(run);
    groups.set(key, arr);
  }
  return [...groups.entries()]
    .map(([key, runs]) => {
      const first = runs[0].result.scenario;
      const metrics = [
        "renderMs",
        "frameMs",
        "matrixWorldMs",
        "drawCalls",
        "triangles",
        "logicalObjects",
        "visibleCount",
        "materialIdentities",
      ];
      const values = Object.fromEntries(
        metrics.map((metric) => [metric, median(runs.map((run) => run.summaries[metric].median))]),
      );
      const stageReports = runs.map((run) => run.result.rendererStages).filter(Boolean);
      const stageNames = [
        ...new Set(stageReports.flatMap((report) => Object.keys(report.stages))),
      ].sort();
      const stages = Object.fromEntries(
        stageNames.map((name) => {
          const perFrameMs = median(
            stageReports.map((report) => report.stages[name]?.inclusiveMsPerMeasuredFrame ?? 0),
          );
          const callsPerFrame = median(
            stageReports.map((report) => report.stages[name]?.callsPerMeasuredFrame ?? 0),
          );
          const outer = median(
            stageReports.map(
              (report) => report.stages["renderer.renderScene"]?.inclusiveMsPerMeasuredFrame ?? 0,
            ),
          );
          return [
            name,
            {
              callsPerFrame,
              outerRenderScenePct: outer ? (perFrameMs / outer) * 100 : 0,
              perFrameMs,
            },
          ];
        }),
      );
      return {
        adapterClass: runs[0].adapterClass,
        evidence: runs[0].evidence,
        key,
        missingStages: stageReports[0]?.missingStages ?? [],
        scenario: first,
        stages,
        values,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function parseArgs(argv) {
  const positional = [];
  let output;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") {
      output = argv[index + 1];
      index += 1;
    } else if (value === "--help") {
      console.log(
        "Usage: node scripts/analyze-prd-exp-002.mjs <ab-root> [matrix-root] [--output <file>]",
      );
      process.exit(0);
    } else {
      positional.push(value);
    }
  }
  return {
    abRoot: positional[0] ?? "artifacts/native-cpu-profile/prd-exp-002-ab",
    matrixRoot: positional[1],
    output,
  };
}

const args = parseArgs(process.argv.slice(2));
const control = loadLatest(path.join(args.abRoot, "control"));
const candidate = loadLatest(path.join(args.abRoot, "instrumented-safe2"));
const output = {
  ab: compareReports(control.json, candidate.json),
  candidateStageHeadline: candidate.json.runs.map((run) => ({
    adapterClass: run.adapterClass,
    evidence: run.evidence,
    measuredFrameCount: run.result.rendererStages?.measuredFrameCount,
    missingStages: run.result.rendererStages?.missingStages,
    presentation: run.presentation,
    repeat: run.repeat,
    stages: run.result.rendererStages?.stages,
  })),
  files: { candidate: candidate.file, control: control.file },
  matrix: args.matrixRoot ? aggregateMatrix(loadLatest(args.matrixRoot).json) : undefined,
};

const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (args.output) writeFileSync(args.output, serialized);
process.stdout.write(serialized);
