import path from "node:path";
import { describe, expect, it } from "vitest";
import { CapabilityRecallError, measureRecall, runRecall } from "../capability-recall.js";

const manifestFile = path.resolve("packages/create-threenative/capabilities.json");

describe("capability recall gate", () => {
  it("holds the measured recall and precision floors", () => {
    const report = runRecall();

    expect(report.regressions).toEqual([]);
    expect(report.metrics.recallAtK).toBeGreaterThan(0.5);
    expect(report.metrics.rejectHits).toBeLessThanOrEqual(16);
    expect(report.metrics.rowCount).toBe(58);
    expect(report.metrics.zeroResultRate).toBeLessThanOrEqual(0.10344827586206896);
  });

  it("fails closed for an empty corpus", () => {
    expect(() => measureRecall([], manifestFile)).toThrow(CapabilityRecallError);
  });
});
