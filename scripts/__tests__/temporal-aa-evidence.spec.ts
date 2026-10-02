import { describe, expect, it } from "vitest";
import type { IPlaytestReport } from "../../packages/playtest/src/report.js";
import { requireTemporalRenderEvidence } from "../temporal-aa-evidence.js";

function report(): Pick<IPlaytestReport, "capture" | "diagnostics"> & { pass: boolean } {
  return {
    capture: {
      adapter: { architecture: "swiftshader", vendor: "google" },
      browserArgs: [],
      captureMethod: "page.screenshot",
      rendererKind: "webgpu",
      target: "web",
      viewport: { width: 1280, height: 720 },
    },
    diagnostics: [],
    pass: true,
  };
}
describe("temporal render evidence", () => {
  it("accepts honest software correctness evidence with adapter provenance", () => {
    expect(() => requireTemporalRenderEvidence(report(), "temporal")).not.toThrow();
  });
  it("rejects software device loss even when the runner reports pass", () => {
    const result = report();
    result.diagnostics.push({
      code: "TN_PLAYTEST_SOFTWARE_DEVICE_LOST",
      message: "This lane is not render evidence",
      severity: "warning",
    });
    expect(() => requireTemporalRenderEvidence(result, "temporal")).toThrow(/device loss/);
  });
  it("rejects unrelated error diagnostics, absent adapter identity and failed reports", () => {
    const error = report();
    error.diagnostics.push({
      code: "TN_PLAYTEST_CONSOLE_ERROR",
      severity: "error",
      message: "Shader failed",
    });
    expect(() => requireTemporalRenderEvidence(error, "temporal")).toThrow(/error diagnostics/);
    const absent = report();
    if (absent.capture) absent.capture.adapter = {};
    expect(() => requireTemporalRenderEvidence(absent, "temporal")).toThrow(/adapter/);
    const failed = report();
    failed.pass = false;
    expect(() => requireTemporalRenderEvidence(failed, "temporal")).toThrow();
  });
});
