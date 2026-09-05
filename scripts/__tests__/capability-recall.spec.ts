import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CapabilityRecallError,
  type ICapabilityRecallBudget,
  measureRecall,
  resolveCorpusSources,
  runRecall,
  validateBudget,
} from "../capability-recall.js";

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

  it("fails closed when a corpus source pointer no longer resolves", () => {
    expect(() =>
      resolveCorpusSources([
        {
          expect: ["GroundSnap"],
          id: "fixture.stale-source",
          query: "keep a character's feet on the floor",
          reject: [],
          scope: "mechanic",
          source: "template:starter#Heading removed by a later edit",
        },
      ]),
    ).toThrow(/fixture\.stale-source: source .* no longer resolves/u);
  });

  it("rejects budget floors outside their measured domains", () => {
    const valid: ICapabilityRecallBudget = {
      recallAtK: 0.5,
      recalledRows: ["row"],
      rejectHits: 0,
      rowCount: 1,
      rowIds: ["row"],
      version: 1,
      zeroResultRate: 0.5,
    };

    expect(() => validateBudget({ ...valid, recallAtK: -1 })).toThrow(/recallAtK/u);
    expect(() => validateBudget({ ...valid, zeroResultRate: 2 })).toThrow(/zeroResultRate/u);
    expect(() => validateBudget({ ...valid, rejectHits: 2 })).toThrow(/rejectHits/u);
    expect(() => validateBudget({ ...valid, rowCount: 0 })).toThrow(/rowCount/u);
    expect(() => validateBudget({ ...valid, rowIds: ["different"] })).toThrow(/recalledRows/u);
    expect(() => validateBudget({ ...valid, recalledRows: ["different"] })).toThrow(
      /recalledRows/u,
    );
  });
});
