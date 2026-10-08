import { describe, expect, it } from "vitest";
import type { IStarterMeter } from "../../packages/runtime-native/scripts/starter-meter.js";
import { bindingOverhead, parseCp1Arms } from "../engine-load-test/cp1.js";
import type { ICp1ArmResult } from "../engine-load-test/cp1.js";
import { crowdPresented, currentCrowdResult, parseCrowdArms } from "../engine-load-test/crowd.js";
import type { ICrowdArmResult } from "../engine-load-test/crowd.js";
import {
  assertHoldoutValid,
  currentHoldoutResult,
  holdoutPresented,
  limit,
  nativeHoldoutResult,
  parseHoldoutArms,
} from "../engine-load-test/holdout.js";
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
    expect(() => parseWorkloads("all")).toThrow("TN_BENCH_WORKLOAD_BLOCKED");
    expect(parseWorkloads("holdout")).toEqual(["holdout"]);
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

describe("GPU-heavy holdout arms", () => {
  const meter: IStarterMeter = {
    frames: 60,
    warmup: 15,
    size: [1920, 1080] as [number, number],
    submitMs: series(1.1),
    frameMs: series(4),
    gpuMs: series(3),
    gpuSamples: 8,
    gpuSample: [3],
    throughputMs: 5,
    gpuPasses: 12,
    draws: 40,
    triangles: 17_000,
    sceneMeshes: 19,
    sceneTriangles: 15_398,
    adapter: { vendor: "nvidia", architecture: "turing", device: "", description: "" },
  };
  const report = {
    arm: "native-render-driver",
    size: [1920, 1080] as [number, number],
    sceneMeshes: 19,
    sceneTriangles: 15_398,
    draws: 21,
    triangles: 17_447,
    submitMs: series(1.1),
    frameMs: series(3.9),
    gpuMs: series(2.8),
  };

  it("presents the same meshes, triangles and resolution under both arms", () => {
    const current = currentHoldoutResult(meter);
    const native = nativeHoldoutResult(report);
    expect(() =>
      assertEqualPresentedWork("holdout", [
        { arm: "current", presented: holdoutPresented(current) },
        { arm: "native", presented: holdoutPresented(native) },
      ]),
    ).not.toThrow();
    expect(() => assertHoldoutValid([current, native])).not.toThrow();
  });

  it("refuses an arm that drew another scene or another size", () => {
    const current = currentHoldoutResult(meter);
    const fewer = nativeHoldoutResult({ ...report, sceneTriangles: 15_000 });
    expect(() =>
      assertEqualPresentedWork("holdout", [
        { arm: "current", presented: holdoutPresented(current) },
        { arm: "native", presented: holdoutPresented(fewer) },
      ]),
    ).toThrow("TN_BENCH_WORKLOAD_MISMATCH");
    expect(() => holdoutPresented(nativeHoldoutResult({ ...report, size: [1280, 720] }))).toThrow(
      /TN_BENCH_WORKLOAD_MISMATCH.*1280x720/su,
    );
    expect(() => holdoutPresented(nativeHoldoutResult({ ...report, triangles: 100 }))).toThrow(
      "TN_BENCH_PRESENTED_SHORT",
    );
  });

  it("is a holdout while the native arm is GPU-bound, whatever the legacy arm is bound by", () => {
    const native = nativeHoldoutResult(report);
    // The legacy arm is CPU-bound here (submit 6 ms against 2 ms of GPU): reported, not refused.
    const cpuBoundLegacy = currentHoldoutResult({
      ...meter,
      submitMs: series(6),
      frameMs: series(8),
      gpuMs: series(2),
    });
    expect(limit(cpuBoundLegacy)).toBe("CPU");
    expect(limit(native)).toBe("GPU");
    expect(() => assertHoldoutValid([cpuBoundLegacy, native])).not.toThrow();
    const cpuBoundNative = nativeHoldoutResult({ ...report, gpuMs: series(1.2) });
    expect(() => assertHoldoutValid([currentHoldoutResult(meter), cpuBoundNative])).toThrow(
      /TN_BENCH_HOLDOUT_NOT_GPU_BOUND.*native/su,
    );
    expect(() => assertHoldoutValid([currentHoldoutResult(meter)])).toThrow(
      "TN_BENCH_HOLDOUT_NO_NATIVE",
    );
  });

  it("refuses an unvalidated browser meter", () => {
    const native = nativeHoldoutResult(report);
    const run = (patch: Partial<typeof meter>) =>
      assertHoldoutValid([currentHoldoutResult({ ...meter, ...patch }), native]);
    expect(() => run({ gpuMs: null })).toThrow("TN_BENCH_HOLDOUT_GPU_UNMEASURED");
    expect(() => run({ gpuPasses: 1 })).toThrow("TN_BENCH_HOLDOUT_METER_PARTIAL");
    expect(() => run({ gpuMs: series(9) })).toThrow("TN_BENCH_HOLDOUT_METER_INCONSISTENT");
  });

  it("refuses a software adapter and an unknown arm", () => {
    expect(() =>
      currentHoldoutResult({ ...meter, adapter: { ...meter.adapter, device: "SwiftShader" } }),
    ).toThrow("TN_BENCH_SOFTWARE_ADAPTER");
    expect(() => nativeHoldoutResult({ ...report, arm: "native-cpp" })).toThrow(
      "TN_BENCH_ARM_MISMATCH",
    );
    expect(parseHoldoutArms(["current", "native"])).toEqual(["current", "native"]);
    expect(() => parseHoldoutArms(["native-cpp"])).toThrow("TN_BENCH_ARM_UNAVAILABLE");
  });
});
