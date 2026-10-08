import { describe, expect, it } from "vitest";
import { bindingOverhead, parseCp1Arms } from "../engine-load-test/cp1.js";
import type { ICp1ArmResult } from "../engine-load-test/cp1.js";
import { crowdPresented, currentCrowdResult, parseCrowdArms } from "../engine-load-test/crowd.js";
import type { ICrowdArmResult } from "../engine-load-test/crowd.js";
import { assertEqualPresentedWork, parseWorkloads } from "../engine-load-test/workloads.js";

const series = (p50: number, p95 = p50 * 2) => ({ p50, p95 });
const arm = (name: ICp1ArmResult["arm"], hot: number): ICp1ArmResult => ({
  arm: name,
  driver: "cpp",
  objects: 4,
  triangles: 10,
  drawCalls: 3,
  hotPathMs: series(hot),
  frameMs: series(hot),
  crossingsPerFrame: null,
  gpuMs: null,
  presented: false,
});

describe("PRD-533 workload registry", () => {
  it("names a workload, a list, or all, and rejects anything else", () => {
    expect(parseWorkloads("heterogeneous")).toEqual(["heterogeneous"]);
    expect(parseWorkloads("heterogeneous,skinned-crowd")).toEqual([
      "heterogeneous",
      "skinned-crowd",
    ]);
    expect(() => parseWorkloads("tetris")).toThrow("TN_BENCH_BAD_WORKLOAD");
    expect(() => parseWorkloads("")).toThrow("TN_BENCH_BAD_WORKLOAD");
    expect(() => parseWorkloads("heterogeneous,heterogeneous")).toThrow("distinct");
    expect(() => parseWorkloads("all,heterogeneous")).toThrow("stands alone");
  });

  it("fails by name on a blocked workload, and `all` cannot pass on fewer than the plan lists", () => {
    expect(() => parseWorkloads("machinefall")).toThrow(
      /TN_BENCH_WORKLOAD_BLOCKED: machinefall: .*PRD-498/u,
    );
    // `all` walks every named workload in plan order: holdout (undefined) refuses before machinefall.
    expect(() => parseWorkloads("all")).toThrow("TN_BENCH_WORKLOAD_UNDEFINED");
    expect(() => parseWorkloads("holdout")).toThrow(/TN_BENCH_WORKLOAD_UNDEFINED: holdout/u);
  });
});

describe("equal presented work", () => {
  it("passes arms that present the same objects and triangles", () => {
    expect(() =>
      assertEqualPresentedWork("heterogeneous", [
        { arm: "current", presented: { objects: 256, triangles: 3075 } },
        { arm: "native", presented: { objects: 256, triangles: 3075 } },
      ]),
    ).not.toThrow();
  });

  it("refuses a different triangle count, a different object count and a missing figure", () => {
    expect(() =>
      assertEqualPresentedWork("heterogeneous", [
        { arm: "current", presented: { objects: 256, triangles: 3075 } },
        { arm: "native", presented: { objects: 256, triangles: 3074 } },
      ]),
    ).toThrow("TN_BENCH_WORKLOAD_MISMATCH: heterogeneous: native presents 3074 triangles");
    expect(() =>
      assertEqualPresentedWork("skinned-crowd", [
        { arm: "current", presented: { objects: 64, triangles: 9 } },
        { arm: "native", presented: { objects: 63, triangles: 9 } },
      ]),
    ).toThrow("native presents 63 objects");
    expect(() =>
      assertEqualPresentedWork("heterogeneous", [
        { arm: "current", presented: { objects: 256, triangles: 3075 } },
        { arm: "native", presented: { objects: undefined, triangles: 3075 } },
      ]),
    ).toThrow(
      "TN_BENCH_PRESENTED_UNREPORTED: heterogeneous: native did not report presented objects",
    );
    expect(() =>
      assertEqualPresentedWork("heterogeneous", [
        { arm: "current", presented: { objects: 1, triangles: Number.NaN } },
      ]),
    ).toThrow("TN_BENCH_PRESENTED_UNREPORTED");
    expect(() => assertEqualPresentedWork("heterogeneous", [])).toThrow("TN_BENCH_PRESENTED_EMPTY");
  });
});

describe("heterogeneous arms", () => {
  it("accepts native and native-aot beside current and the C++ driver", () => {
    expect(parseCp1Arms("current,native")).toEqual(["current", "native"]);
    expect(parseCp1Arms("native-cpp,native-aot")).toEqual(["native-cpp", "native-aot"]);
    expect(() => parseCp1Arms("native,native")).toThrow("distinct");
    expect(() => parseCp1Arms("wasm")).toThrow("TN_BENCH_BAD_ARM");
  });

  it("reports binding overhead only when both drivers ran, against the C++ control", () => {
    expect(bindingOverhead([arm("native-cpp", 1)])).toBeUndefined();
    const both = bindingOverhead([arm("native-cpp", 1), arm("native-aot", 1.5)]);
    expect(both?.hotPathP50Ms).toBeCloseTo(0.5);
    expect(both?.ratioP50).toBeCloseTo(1.5);
  });
});

describe("skinned crowd arms", () => {
  const row = {
    arm: "projected",
    drawCalls: 4,
    cpuP50: 3.5,
    frameP50: 10,
    frameP95: 12,
    splitP50: [1, 1, 1],
    presented: { objects: 64, sceneTriangles: 35328, renderedTriangles: 70659 },
  };
  const hardware = { vendor: "nvidia", architecture: "turing", device: "", description: "" };

  it("reads the page's projected row and refuses a software adapter or a missing row", () => {
    const result = currentCrowdResult({ adapter: hardware, summary: [row] });
    expect(result).toMatchObject({ objects: 64, sceneTriangles: 35328, triangles: 70659 });
    expect(() =>
      currentCrowdResult({
        adapter: { ...hardware, vendor: "google", device: "SwiftShader" },
        summary: [row],
      }),
    ).toThrow("TN_BENCH_SOFTWARE_ADAPTER");
    expect(() =>
      currentCrowdResult({ adapter: hardware, summary: [{ ...row, arm: "stock" }] }),
    ).toThrow("TN_BENCH_CROWD_ROW_MISSING");
  });

  it("compares rig triangles, and refuses a renderer that drew fewer than the scene holds", () => {
    const result = currentCrowdResult({ adapter: hardware, summary: [row] });
    expect(crowdPresented(result)).toEqual({ objects: 64, triangles: 35328 });
    const short: ICrowdArmResult = { ...result, triangles: 100 };
    expect(() => crowdPresented(short)).toThrow("TN_BENCH_PRESENTED_SHORT");
  });

  it("runs only the arms it has drivers for", () => {
    expect(parseCrowdArms(["current", "native"])).toEqual(["current", "native"]);
    expect(() => parseCrowdArms(["native-v8"])).toThrow("TN_BENCH_ARM_UNAVAILABLE");
  });
});
