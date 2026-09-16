import { describe, expect, it } from "vitest";
import { EVIDENCE_REF, evidenceUrl, locCensus, shaderCensus, lodCensus, percentageOf, percentageReduction } from "../src/content/benchmarks.js";

describe("benchmark evidence", () => {
  it("distinguishes percent of control from percent reduction", () => {
    expect(percentageOf(locCensus.framework.total, locCensus.vanilla.total)).toBe("93.2%");
    expect(percentageOf(locCensus.framework.plumbing, locCensus.vanilla.plumbing)).toBe("53.6%");
    expect(percentageReduction(138, 74)).toBe("46.4%");
  });
  it("retains the intermediate treatment instead of attributing two changes to one", () => {
    expect(shaderCensus.map((row) => [row.original, row.tint, row.stable])).toEqual([
      [79, 71, 52], [84, 76, 56], [92, 86, 63],
    ]);
    expect(shaderCensus.map((row) => percentageReduction(row.original, row.stable))).toEqual([
      "34.2%", "33.3%", "31.5%",
    ]);
    expect(shaderCensus[2].stable / shaderCensus[2].original).toBeGreaterThan(2 / 3);
  });
  it("keeps web and native triangle observations separate", () => {
    expect(lodCensus.map((row) => [row.near, row.far])).toEqual([[8192, 369], [8192, 368]]);
    expect(lodCensus.map((row) => percentageReduction(row.near, row.far))).toEqual(["95.5%", "95.5%"]);
  });
  it("pins evidence to the inspected snapshot, not a mutable branch", () => {
    expect(EVIDENCE_REF).toMatch(/^[0-9a-f]{40}$/u);
    expect(evidenceUrl("docs/benchmark/LOC.md")).toBe(
      `https://github.com/ThreeNativeHQ/threenative/blob/${EVIDENCE_REF}/docs/benchmark/LOC.md`,
    );
  });
  it("refuses missing or non-finite observations instead of displaying misleading percentages", () => {
    for (const baseline of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => percentageOf(1, baseline)).toThrow();
    }
    for (const measured of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => percentageOf(measured, 10)).toThrow();
    }
    expect(percentageReduction(100, 110)).toBe("-10.0%");
  });
});
