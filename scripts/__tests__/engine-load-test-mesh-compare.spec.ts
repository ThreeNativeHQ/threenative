import { describe, expect, it } from "vitest";
import { compareMeshRuns } from "../engine-load-test/mesh-compare.js";

const ADAPTER = { architecture: "turing", description: null, device: null, vendor: "nvidia" };

function run(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    adapter: ADAPTER,
    arm: "plain-three-web",
    capture: "artifacts/engine-load-test/mesh-plain-three-web.png",
    count: 1000,
    fixtureHash: "2ba9838e",
    frameP50Ms: 2.93,
    frameP95Ms: 6.05,
    frameP99Ms: 12.17,
    meanMs: 6.86,
    profile: "smoke",
    stats: { drawCalls: 1001, triangles: 12001 },
    threeRevision: "185",
    variant: "rotating",
    ...overrides,
  };
}

describe("PRD-449 independent-mesh smoke comparison", () => {
  const PATHS = {
    baseline: "artifacts/mesh-plain-three-web.json",
    candidate: "artifacts/mesh-tn-web.json",
  };

  it("pairs two runs of the same fixture and reports the baseline-over-candidate mean ratio", () => {
    const summary = compareMeshRuns(
      run(),
      run({ arm: "tn-web", meanMs: 3.43, stats: { drawCalls: 2, triangles: 12001 } }),
      PATHS,
    );
    expect(summary.meanRatioBaselineOverCandidate).toBeCloseTo(2, 2);
    expect(summary.blocks).toBe(1);
    expect(summary.arms.candidate.arm).toBe("tn-web");
    expect(summary.arms.baseline.result).toBe(PATHS.baseline);
    // A retained number that can be read past its lane's limits is how a smoke run becomes a claim.
    expect(summary.qualifications).toHaveLength(2);
    expect(summary.qualifications.join(" ")).toMatch(/no faster\/slower verdict is supported/);
  });

  it("refuses runs that did not measure the same task", () => {
    const other = (overrides: Record<string, unknown>) => run({ arm: "tn-web", ...overrides });
    expect(() => compareMeshRuns(run(), other({ fixtureHash: "deadbeef" }), PATHS)).toThrow(
      /TN_BENCH_MESH_FIXTURE_MISMATCH/,
    );
    expect(() => compareMeshRuns(run(), other({ count: 5000 }), PATHS)).toThrow(
      /TN_BENCH_MESH_NOT_COMPARABLE/,
    );
    expect(() => compareMeshRuns(run(), other({ variant: "static" }), PATHS)).toThrow(
      /TN_BENCH_MESH_NOT_COMPARABLE/,
    );
  });

  it("refuses runs whose three bytes, GPU or arm do not match", () => {
    expect(() =>
      compareMeshRuns(run(), run({ arm: "tn-web", threeRevision: "184" }), PATHS),
    ).toThrow(/TN_BENCH_MESH_THREE_MISMATCH/);
    expect(() =>
      compareMeshRuns(
        run(),
        run({ arm: "tn-web", adapter: { ...ADAPTER, architecture: "swiftshader" } }),
        PATHS,
      ),
    ).toThrow(/TN_BENCH_MESH_ADAPTER_MISMATCH/);
    expect(() => compareMeshRuns(run(), run(), PATHS)).toThrow(/TN_BENCH_MESH_SAME_ARM/);
  });

  it("treats an unmeasured or absent mean as a failure rather than an infinitely fast arm", () => {
    expect(() => compareMeshRuns(run(), run({ arm: "tn-web", meanMs: 0 }), PATHS)).toThrow(
      /TN_BENCH_MESH_MISSING_MEASUREMENT/,
    );
    expect(() => compareMeshRuns(run(), run({ arm: "tn-web", meanMs: undefined }), PATHS)).toThrow(
      /TN_BENCH_MESH_MISSING_MEASUREMENT/,
    );
    expect(() => compareMeshRuns(run(), null, PATHS)).toThrow(/TN_BENCH_MESH_MISSING_MEASUREMENT/);
  });
});
