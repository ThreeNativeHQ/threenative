import { describe, expect, it } from "vitest";
import type { IV2RunRecord } from "../engine-load-test/report-v2.js";
import {
  analysePairedBlocks,
  calibrateEpsilon,
  pairCompletedWork,
} from "../engine-load-test/stats.js";

function runs(ratios: readonly number[], session = (index: number) => 1 + (index % 2)) {
  return ratios.flatMap((ratio, index) =>
    (["tn", "competitor"] as const).map(
      (id, order) =>
        ({
          arm: { id },
          block: index + 1,
          campaignHash: "campaign",
          campaignId: "campaign-1",
          comparability: "matched-task",
          experiment: { workload: "cubes", load: "10000", optimizationClass: "default" },
          fixture: { hash: "fixture" },
          machine: { id: "desktop", gpu: "gpu", lane: "physical-hardware" },
          metrics: [
            { name: "completed-work-mean-ms", unit: "ms", value: id === "tn" ? 10 : 10 * ratio },
          ],
          order,
          outcome: { runStatus: "valid" },
          planHash: "plan",
          runId: `${id}-${index}`,
          session: session(index),
        }) as unknown as IV2RunRecord,
    ),
  );
}

function planned(records: readonly IV2RunRecord[]) {
  return records
    .filter((record) => record.arm.id === "tn")
    .map(({ session, block }) => ({ session, block }));
}

function pair(records: readonly IV2RunRecord[], expected = planned(records)) {
  return pairCompletedWork(records, "tn", "competitor", expected);
}

describe("paired cross-engine statistics", () => {
  it("uses whole paired blocks for a reproducible known-ratio interval", () => {
    const blocks = pair(runs(Array(8).fill(2)));
    const result = analysePairedBlocks(blocks, { epsilon: 0.03, seed: 449 });
    expect(result.ratio).toBeCloseTo(2);
    expect(result.timeReductionPercent).toBeCloseTo(50);
    expect(result.ci95?.[0]).toBeCloseTo(2);
    expect(result.ci95?.[1]).toBeCloseTo(2);
    expect(result.verdict).toBe("faster");
    expect(result.sessions).toHaveLength(2);
    expect(analysePairedBlocks(blocks, { epsilon: 0.03, seed: 449 })).toEqual(result);
    const uncalibrated = analysePairedBlocks(blocks, { epsilon: null, seed: 449 });
    expect(uncalibrated.ci95).not.toBeNull();
    expect(uncalibrated.verdict).toBe("insufficient");
    const slower = analysePairedBlocks(pair(runs(Array(8).fill(0.5))), {
      epsilon: 0.03,
      seed: 449,
    });
    expect(slower.verdict).toBe("slower");
  });

  it("calibrates the noise band and finds practical equivalence", () => {
    expect(
      calibrateEpsilon(
        Array(6)
          .fill([10, 10])
          .concat([[10, 10.8]]),
      ),
    ).toBeCloseTo(0.08);
    const result = analysePairedBlocks(pair(runs(Array(8).fill(1))), {
      epsilon: 0.03,
      seed: 1,
    });
    expect(result.verdict).toBe("equivalent");
    expect(() => calibrateEpsilon(Array(6).fill([10, 10]))).toThrow(/seven/u);
  });

  it("keeps high variance inconclusive and short or drifting campaigns insufficient", () => {
    const varied = analysePairedBlocks(pair(runs([0.5, 2, 2, 0.5, 0.5, 2, 2, 0.5])), {
      epsilon: 0.03,
      seed: 8,
    });
    expect(varied.verdict).toBe("inconclusive");
    expect(varied.ci95?.[0]).toBeLessThan(1 / 1.03);
    expect(varied.ci95?.[1]).toBeGreaterThan(1.03);

    const short = analysePairedBlocks(pair(runs([2, 2, 2])), {
      epsilon: 0.03,
      seed: 8,
    });
    expect(short.verdict).toBe("insufficient");
    expect(short.ci95).toBeNull();

    const drift = analysePairedBlocks(
      pair(runs([2, 2, 2, 2, 1, 1, 1, 1], (index) => (index < 4 ? 1 : 2))),
      { epsilon: 0.03, seed: 8 },
    );
    expect(drift.sessionDrift).toBe(true);
    expect(drift.verdict).toBe("insufficient");
  });

  it("rejects missing, duplicate, reused and mismatched paired runs", () => {
    const base = runs(Array(7).fill(2));
    expect(() => pair(base.slice(1), planned(base))).toThrow(/missing/u);
    expect(() =>
      pair(
        base.filter((record) => record.block !== 3),
        planned(base),
      ),
    ).toThrow(/missing/u);
    expect(() => pair([...base, base[0] as IV2RunRecord], planned(base))).toThrow(
      /duplicate|reused/u,
    );
    const changed = {
      ...(base[1] as IV2RunRecord),
      runId: "changed",
      fixture: { hash: "other", conformance: "pass" as const, evidence: null },
    };
    expect(() => pair([base[0] as IV2RunRecord, changed, ...base.slice(2)], planned(base))).toThrow(
      /fixture/u,
    );
    const reused = { ...(base[1] as IV2RunRecord), runId: (base[0] as IV2RunRecord).runId };
    expect(() => pair([base[0] as IV2RunRecord, reused, ...base.slice(2)], planned(base))).toThrow(
      /reused/u,
    );
  });

  it("refuses a completed-work metric in the wrong unit", () => {
    const base = runs(Array(7).fill(2));
    const metric = base[1]?.metrics[0];
    if (metric === undefined) throw new Error("missing test metric");
    metric.unit = "us";
    expect(() => pair(base)).toThrow(/milliseconds/u);
  });
});
