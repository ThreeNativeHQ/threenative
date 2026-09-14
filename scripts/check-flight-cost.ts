import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createFlightCostFixture, FLIGHT_COST_WORKLOAD } from "../packages/core/__tests__/fixtures/flight-cost.js";
import { evaluateStepCost, measureStepCost } from "./lib/step-cost.js";

function main(argv: readonly string[]): number {
  let maxMeanMs: number | undefined;
  let maxP95Ms: number | undefined;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const raw = argv[index + 1];
    const value = Number(raw);
    if ((flag !== "--max-mean-ms" && flag !== "--max-p95-ms") || raw === undefined
      || raw.trim() === "" || !Number.isFinite(value) || value <= 0) {
      throw new Error("Usage: tsx scripts/check-flight-cost.ts [--max-mean-ms <positive ms>] [--max-p95-ms <positive ms>]");
    }
    if (flag === "--max-mean-ms") {
      if (maxMeanMs !== undefined) throw new Error("Duplicate --max-mean-ms");
      maxMeanMs = value;
    } else {
      if (maxP95Ms !== undefined) throw new Error("Duplicate --max-p95-ms");
      maxP95Ms = value;
    }
  }
  const sourceFiles = ["../packages/core/src/flight.ts", "../packages/core/src/random.ts",
    "../packages/core/__tests__/fixtures/flight-cost.ts", "./lib/step-cost.ts", "./check-flight-cost.ts"];
  const sources = Object.fromEntries(sourceFiles.map((file) => [file,
    createHash("sha256").update(readFileSync(new URL(file, import.meta.url))).digest("hex"),
  ]));
  const result = measureStepCost(FLIGHT_COST_WORKLOAD, () => createFlightCostFixture(FLIGHT_COST_WORKLOAD));
  const finalStateSha256 = createHash("sha256").update(JSON.stringify(result.finalState)).digest("hex");
  const verdict = maxMeanMs === undefined && maxP95Ms === undefined
    ? undefined : evaluateStepCost(result.samplesMs, { maxMeanMs, maxP95Ms });
  const { finalState: _finalState, ...measurement } = result;
  console.log(JSON.stringify({
    fixture: "repeated-flight-step-v1",
    measurement: { ...measurement, finalStateSha256 },
    mode: verdict === undefined ? "measurement-only" : "budget-check",
    runtime: { arch: process.arch, node: process.version, platform: process.platform },
    scope: "CPU elapsed time for one population step; not render time, FPS, or proof of a GC cause",
    sources,
    ...(verdict === undefined ? {} : { budget: { maxMeanMs, maxP95Ms }, pass: verdict.pass }),
  }, null, 2));
  return verdict?.pass === false ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
