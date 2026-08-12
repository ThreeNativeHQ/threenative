import { describe, expect, it } from "vitest";
import {
  createFoxScaleWorkloadConfig,
  createWorkload,
  evaluateKernelDecision,
  summarizeSamples,
  validateWorkloadConfig,
} from "../native-cpu-profile/workload.js";

const baseConfig = {
  dirtyRatio: 0.1 as const,
  hierarchy: "deep" as const,
  objectCount: 100,
  seed: 90210,
  visibility: "mostly-culled" as const,
};

describe("native CPU workload", () => {
  it("generates byte-equivalent seeded topology, transforms, and dirty sets", () => {
    const first = createWorkload(baseConfig);
    const second = createWorkload({ ...baseConfig });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(createWorkload({ ...baseConfig, seed: 90211 })).not.toEqual(first);
  });

  it("supports flat and bounded deep parent topology", () => {
    const flat = createWorkload({ ...baseConfig, hierarchy: "flat" });
    const deep = createWorkload(baseConfig);
    const otherSeed = createWorkload({ ...baseConfig, seed: 90211 });

    expect(flat.objects.every((object) => object.parentId === null)).toBe(true);
    expect(deep.objects[0]?.parentId).toBeNull();
    expect(deep.objects.some((object) => object.parentId !== null)).toBe(true);
    expect(
      deep.objects.every((object) => object.parentId === null || object.parentId < object.id),
    ).toBe(true);
    expect(deep.objects.map((object) => object.parentId)).not.toEqual(
      otherSeed.objects.map((object) => object.parentId),
    );
  });

  it("selects exact deterministic 0%, 10%, and 100% dirty sets", () => {
    expect(createWorkload({ ...baseConfig, dirtyRatio: 0 }).dirtyIds).toHaveLength(0);
    expect(createWorkload({ ...baseConfig, dirtyRatio: 0.1 }).dirtyIds).toHaveLength(10);
    expect(createWorkload({ ...baseConfig, dirtyRatio: 1 }).dirtyIds).toHaveLength(100);
    expect(createWorkload({ ...baseConfig, dirtyRatio: 0.1 }).dirtyIds).toEqual(
      createWorkload({ ...baseConfig, dirtyRatio: 0.1 }).dirtyIds,
    );
    expect(createWorkload({ ...baseConfig, dirtyRatio: 0.1 }).dirtyIds).not.toEqual(
      createWorkload({ ...baseConfig, dirtyRatio: 0.1, seed: 90211 }).dirtyIds,
    );
  });

  it("places all-visible objects near the origin and mostly-culled objects far away", () => {
    const visible = createWorkload({ ...baseConfig, visibility: "all-visible" });
    const culled = createWorkload({ ...baseConfig, visibility: "mostly-culled" });

    expect(visible.objects.every((object) => Math.abs(object.transform.position[0]) < 500)).toBe(
      true,
    );
    expect(
      culled.objects.filter((object) => Math.abs(object.transform.position[0]) > 1_000),
    ).toHaveLength(90);
    expect(visible.objects[42]?.transform).toEqual(
      createWorkload({ ...baseConfig, visibility: "all-visible" }).objects[42]?.transform,
    );
  });

  it("rejects malformed workload configuration", () => {
    expect(() => validateWorkloadConfig({ ...baseConfig, objectCount: 0 })).toThrow(/objectCount/);
    expect(() => validateWorkloadConfig({ ...baseConfig, dirtyRatio: 0.01 })).toThrow(/dirtyRatio/);
    expect(() => validateWorkloadConfig({ ...baseConfig, seed: -1 })).toThrow(/seed/);
    expect(() => validateWorkloadConfig({ ...baseConfig, visibility: "alternating" })).toThrow(
      /visibility/,
    );
    expect(() => validateWorkloadConfig({ ...baseConfig, renderMode: "magic" })).toThrow(/renderMode/);
    expect(() => validateWorkloadConfig({ ...baseConfig, passes: 3 })).toThrow(/passes/);
  });

  it("defines a deterministic named fox-scale preset without replacing generic rows", () => {
    const preset = createFoxScaleWorkloadConfig();
    const first = createWorkload(preset);
    const second = createWorkload(createFoxScaleWorkloadConfig());

    expect(preset.scenario).toBe("fox-scale");
    expect(preset.objectCount).toBeGreaterThanOrEqual(1_500);
    expect(preset.renderMode).toBe("independent");
    expect(preset.passes).toBe(1);
    expect(preset.visibility).toBe("all-visible");
    expect(preset.dirtyRatio).toBe(0.1);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("native CPU statistics", () => {
  it("reports nearest-rank percentiles, mean, and population standard deviation", () => {
    expect(summarizeSamples([1, 2, 3, 4, 10])).toEqual({
      count: 5,
      mean: 4,
      median: 3,
      p95: 10,
      p99: 10,
      stddev: Math.sqrt(10),
    });
  });

  it("rejects empty, non-finite, and negative samples", () => {
    expect(() => summarizeSamples([])).toThrow(/samples/);
    expect(() => summarizeSamples([1, Number.NaN])).toThrow(/samples/);
    expect(() => summarizeSamples([-1])).toThrow(/samples/);
  });

  it("requires a gain of 10% that also exceeds run-to-run noise and synchronization", () => {
    expect(evaluateKernelDecision([10, 10.1, 9.9], [8, 8.1, 7.9], 0.5).actionable).toBe(true);
    expect(evaluateKernelDecision([10, 11, 9], [8.8, 8.9, 8.7], 0.5).actionable).toBe(false);
    expect(evaluateKernelDecision([10, 10.1, 9.9], [9, 9.1, 8.9], 0.5).actionable).toBe(false);
  });
});
