import assert from "node:assert/strict";
import type { IPlaytestReport } from "../packages/playtest/src/report.js";

/** Software is allowed for correctness, but a lost device is never rendered evidence. */
export function requireTemporalRenderEvidence(
  report: Pick<IPlaytestReport, "capture" | "diagnostics"> & { pass: boolean },
  variant: string,
): void {
  assert.ok(
    report.capture && Object.values(report.capture.adapter).some((value) => value.length > 0),
    `${variant}: adapter provenance required`,
  );
  assert.equal(report.capture.rendererKind, "webgpu", `${variant}: expected WebGPU`);
  assert.ok(
    !report.diagnostics.some(({ code }) => code === "TN_PLAYTEST_SOFTWARE_DEVICE_LOST"),
    `${variant}: device loss disqualifies render evidence`,
  );
  assert.ok(
    !report.diagnostics.some(({ severity }) => severity === "error"),
    `${variant}: error diagnostics: ${JSON.stringify(report.diagnostics)}`,
  );
  assert.equal(report.pass, true, `${variant}: ${JSON.stringify(report.diagnostics)}`);
}
