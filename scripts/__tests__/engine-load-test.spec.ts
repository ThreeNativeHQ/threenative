import { describe, expect, it } from "vitest";
import {
  createLcg,
  createPlacements,
  positionHash,
} from "../../examples/engine-load-test/src/workload.js";
import {
  type IRunReport,
  PERFORMANCE_BASELINES,
  PERFORMANCE_REGRESSION_TOLERANCE,
  checkEquivalence,
  checkPerformance,
  compare,
  knee,
  looksVsyncPinned,
  parseRunReport,
  summarize,
} from "../engine-load-test/report.js";
import { MINIMUM_BATTERY_PERCENT } from "../engine-load-test/run-android.js";
import { runCapturing } from "../engine-load-test/run-desktop.js";

const BEGIN_MARKER = "ENGINE_LOAD_TEST_JSON_BEGIN";
const END_MARKER = "ENGINE_LOAD_TEST_JSON_END";

function series(valueMs: number, length = 8): number[] {
  return Array.from({ length }, () => valueMs);
}

function rung(overrides: Partial<IRunReport["rungs"][number]> = {}): IRunReport["rungs"][number] {
  return {
    drawCalls: 4097,
    frameMs: series(10),
    mode: "L1",
    objectCount: 4096,
    positionHash: "aabbccdd",
    repeat: 0,
    triangles: 49_176,
    visibleObjects: 4096,
    ...overrides,
  };
}

function report(overrides: Partial<IRunReport> = {}): IRunReport {
  return {
    arm: "tn-web",
    build: { notes: "", type: "release" },
    device: { battery: null, label: "desktop-chrome-linux" },
    display: { height: 720, refreshHz: 60, vsync: false, width: 1280 },
    driver: { adapter: "test adapter", renderer: "test renderer" },
    engine: { name: "threenative", version: "workspace" },
    rungs: [rung()],
    ...overrides,
  };
}

// The ladder the knee tests read: three rungs under the 20 ms line, one over it.
function ladderReport(topP95: number, arm: IRunReport["arm"] = "tn-web"): IRunReport {
  return report({
    arm,
    engine: arm.startsWith("godot")
      ? { name: "godot", version: "4.7.1" }
      : { name: "threenative", version: "workspace" },
    rungs: [
      rung({
        drawCalls: 257,
        objectCount: 256,
        positionHash: "1111",
        triangles: 3074,
        visibleObjects: 256,
        frameMs: series(6),
      }),
      rung({
        drawCalls: 1025,
        objectCount: 1024,
        positionHash: "2222",
        triangles: 12_290,
        visibleObjects: 1024,
        frameMs: series(9),
      }),
      rung({
        drawCalls: 4097,
        objectCount: 4096,
        positionHash: "3333",
        triangles: 49_154,
        visibleObjects: 4096,
        frameMs: series(19),
      }),
      rung({
        drawCalls: 16_385,
        objectCount: 16_384,
        positionHash: "4444",
        triangles: 196_610,
        visibleObjects: 16_384,
        frameMs: series(topP95),
      }),
    ],
  });
}

describe("engine load test workload", () => {
  it("should produce the LCG sequence PRD-117 §3.3 specifies", () => {
    const random = createLcg();
    const first = random();
    expect(first).toBeCloseTo(((1337 * 1664525 + 1013904223) % 4294967296) / 4294967296, 12);
    expect(createLcg()()).toBe(first);
  });

  it("should place cubes identically on every call so both arms hash the same scene", () => {
    expect(positionHash(createPlacements(1024))).toBe(positionHash(createPlacements(1024)));
    expect(positionHash(createPlacements(1024))).not.toBe(positionHash(createPlacements(256)));
    expect(positionHash(createPlacements(1024))).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("engine load test scorer", () => {
  it("should reject a rung with an empty frame series", () => {
    expect(() => parseRunReport(report({ rungs: [rung({ frameMs: [] })] }))).toThrow(
      /TN_BENCH_EMPTY_SERIES/,
    );
  });

  it("should reject a report missing its driver line", () => {
    const missing = report() as unknown as Record<string, unknown>;
    // biome-ignore lint/performance/noDelete: the point of the test is an absent key.
    delete missing.driver;
    expect(() => parseRunReport(missing)).toThrow(/TN_BENCH_MISSING_DRIVER/);
    expect(() => parseRunReport(report({ driver: { adapter: "", renderer: "gl" } }))).toThrow(
      /TN_BENCH_MISSING_DRIVER/,
    );
  });

  it("should reject a report with no rungs at all", () => {
    expect(() => parseRunReport(report({ rungs: [] }))).toThrow(/TN_BENCH_NO_RUNGS/);
  });

  it("should require a condition block on Android reports", () => {
    expect(() => parseRunReport(report({ arm: "tn-android" }))).toThrow(
      /TN_BENCH_BAD_SHAPE|TN_BENCH_MISSING_DEVICE_CONDITION/,
    );
    const parsed = parseRunReport(
      report({
        arm: "tn-android",
        deviceCondition: {
          batteryPercent: 80,
          charging: false,
          chargingSource: "NONE",
          provisional: [],
          screenOn: true,
          serial: "37251FDJH0037Z",
          thermalStatus: "NONE",
          thermalStatusCode: 0,
        },
        provisional: [],
      }),
    );
    expect(parsed.deviceCondition?.thermalStatus).toBe("NONE");
  });

  it("should compute the knee as the largest rung at or below 20 ms p95", () => {
    expect(knee(summarize(ladderReport(24)), "L1")).toBe(4096);
    // Shift the top of the fixture under the line and the knee climbs a rung; shift the rung
    // below it over the line and the knee drops one.
    expect(knee(summarize(ladderReport(19)), "L1")).toBe(16_384);
    const dropped = ladderReport(24);
    dropped.rungs[2] = rung({ ...dropped.rungs[2], frameMs: series(21) });
    expect(knee(summarize(dropped), "L1")).toBe(1024);
  });

  it("should report no knee when even the first rung crosses the line", () => {
    const slow = ladderReport(99);
    slow.rungs = slow.rungs.map((entry) => ({ ...entry, frameMs: series(40) }));
    expect(knee(summarize(slow), "L1")).toBeNull();
  });
});

describe("engine load test equivalence gate", () => {
  it("should refuse a comparison whose scenes hash differently, naming the field", () => {
    const left = ladderReport(24);
    const right = ladderReport(24, "godot-web");
    right.rungs[1] = rung({ ...right.rungs[1], positionHash: "deadbeef" });
    expect(checkEquivalence(left, right).map((failure) => failure.field)).toContain("positionHash");
    expect(() => compare(left, right)).toThrow(/TN_BENCH_NOT_EQUIVALENT.*positionHash/s);
  });

  it("should refuse a hash that diverges on only one repeat of a rung", () => {
    // The first cut of the gate keyed one rung per ladder step, so every repeat but the last was
    // invisible and a single diverged scene published as if it matched.
    const left = ladderReport(24);
    const right = ladderReport(24, "godot-web");
    const second = rung({ ...right.rungs[1], positionHash: "deadbeef", repeat: 1 });
    right.rungs = [...right.rungs.slice(0, 2), second, ...right.rungs.slice(2)];
    left.rungs = [
      ...left.rungs.slice(0, 2),
      rung({ ...left.rungs[1], repeat: 1 }),
      ...left.rungs.slice(2),
    ];
    const fields = checkEquivalence(left, right).map((failure) => failure.field);
    expect(fields.some((field) => field.startsWith("positionHash"))).toBe(true);
  });

  it("should refuse an arm whose frame interval is display-pinned rather than load-following", () => {
    // Godot's Android export ignored VSYNC_DISABLED and read ~19 ms at every rung of a 16x ladder.
    // The requested `display.vsync` said false, so the flatness has to be caught in the samples.
    const pinned = ladderReport(24, "godot-web");
    pinned.rungs = pinned.rungs.map((entry) => ({ ...entry, frameMs: series(19) }));
    const fields = checkEquivalence(ladderReport(24), pinned).map((failure) => failure.field);
    expect(fields.some((field) => field.includes("display-pinned"))).toBe(true);
    // Two arms that both follow the load are comparable and must not trip it.
    expect(
      checkEquivalence(ladderReport(24), ladderReport(30, "godot-web")).some((failure) =>
        failure.field.includes("display-pinned"),
      ),
    ).toBe(false);
  });

  it("should refuse a release arm compared against a debug arm", () => {
    const right = ladderReport(24, "godot-web");
    right.build = { notes: "", type: "debug" };
    expect(checkEquivalence(ladderReport(24), right).map((failure) => failure.field)).toContain(
      "build.type",
    );
  });

  it("should refuse two arms whose displays disagree", () => {
    const right = ladderReport(24, "godot-web");
    right.display = { ...right.display, refreshHz: 120 };
    expect(checkEquivalence(ladderReport(24), right).map((failure) => failure.field)).toContain(
      "display.refreshHz",
    );
  });

  it("should refuse an L1 rung that silently auto-batched on one arm", () => {
    const right = ladderReport(24, "godot-web");
    right.rungs[3] = rung({ ...right.rungs[3], drawCalls: 1 });
    const fields = checkEquivalence(ladderReport(24), right).map((failure) => failure.field);
    expect(fields.some((field) => field.startsWith("drawCalls"))).toBe(true);
  });

  it("should refuse two arms whose triangle counts are more than 5% apart", () => {
    const right = ladderReport(24, "godot-web");
    right.rungs[0] = rung({ ...right.rungs[0], triangles: 6000 });
    const fields = checkEquivalence(ladderReport(24), right).map((failure) => failure.field);
    expect(fields.some((field) => field.startsWith("triangles"))).toBe(true);
  });

  it("should publish a comparison when both arms agree on the scene", () => {
    const comparison = compare(ladderReport(24), ladderReport(30, "godot-web"));
    expect(comparison.leftKnee.L1).toBe(4096);
    expect(comparison.rightKnee.L1).toBe(4096);
    expect(checkEquivalence(ladderReport(24), ladderReport(30, "godot-web"))).toEqual([]);
  });

  it("should refuse a provisional comparison", () => {
    const left = ladderReport(24);
    left.provisional = ["battery"];
    expect(() => compare(left, ladderReport(30, "godot-web"))).toThrow(
      /TN_BENCH_PROVISIONAL_COMPARISON/,
    );
  });
});

describe("engine load test frozen-scene detection", () => {
  it("should refuse a device run below the battery floor unless it is asked for", async () => {
    // A phone under ~50% throttles, and the resulting number describes the battery. The escape hatch
    // exists because two arms at the same low charge still compare, but it has to be requested.
    const drained = { batteryPercent: 21, serial: "37251FDJH0037Z" };
    const charged = { batteryPercent: 74, serial: "37251FDJH0037Z" };
    const gate = (state: { batteryPercent: number }, allow: boolean): boolean =>
      state.batteryPercent >= MINIMUM_BATTERY_PERCENT || allow;
    expect(gate(drained, false)).toBe(false);
    expect(gate(drained, true)).toBe(true);
    expect(gate(charged, false)).toBe(true);
    expect(MINIMUM_BATTERY_PERCENT).toBe(50);
  });

  it("should read a frame interval that ignores load as the display, not the engine", () => {
    // Both a 120 Hz phone and a vsync-locked desktop host produce this shape, and it is the reason
    // an 8.2 ms mobile frame is reported as "fits inside one frame" rather than as a measured cost.
    const pinned = ladderReport(24, "godot-web");
    pinned.rungs = pinned.rungs.map((entry) => ({ ...entry, frameMs: series(8.3) }));
    expect(looksVsyncPinned(summarize(pinned), "L1")).toBe(true);
    expect(looksVsyncPinned(summarize(ladderReport(24)), "L1")).toBe(false);
  });
});

describe("engine load test desktop capture", () => {
  // The native desktop host prints its report, finishes its main loop, reaches `_exit` — and then
  // spins in userspace instead of terminating. A capture that waited for process exit therefore
  // hung forever with the finished report already sitting in its buffer, which read as "the
  // benchmark is slow" rather than "the benchmark is done". The report ends at the END marker, so
  // that is the completion signal; the process is killed after it.
  it("should return once the report marker lands, even if the host never exits", async () => {
    const report = { hello: "world" };
    const script = [
      `echo ${BEGIN_MARKER}`,
      `echo TNJSON:'${JSON.stringify(report)}'`,
      `echo ${END_MARKER}`,
      "sleep 300",
    ].join("; ");
    const started = Date.now();
    const parsed = await runCapturing("sh", ["-c", script], { cwd: process.cwd() });
    expect(parsed).toEqual(report);
    // The fixture sleeps for five minutes; anything near that means exit was waited on.
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 60_000);

  it("should still fail closed when a host exits without ever emitting a report", async () => {
    await expect(
      runCapturing("sh", ["-c", "echo nothing useful"], { cwd: process.cwd() }),
    ).rejects.toThrow(/TN_BENCH_NO_REPORT/);
  }, 30_000);
});

describe("the performance baseline gate", () => {
  // The realistic Android regression is not drift, it is the engine default reverting: 8.34 ms to
  // 101.24 ms on the same rung. Every case below is shaped around catching that cliff without
  // becoming a false-alarm generator on ordinary device noise.
  const BASELINES = {
    "tn-android": {
      evidence: "docs/verification/prd-130-phase-6-2026-08-16.md",
      rungs: { "L2@4096": 8.27, "L3@16384": 8.34 },
    },
  } as const;

  function androidReport(
    l2Ms: number,
    l3Ms: number,
    overrides: Partial<IRunReport> = {},
  ): IRunReport {
    return report({
      arm: "tn-android",
      display: { height: 720, refreshHz: 120, vsync: true, width: 1280 },
      rungs: [
        rung({ frameMs: series(l2Ms), mode: "L2", objectCount: 4096 }),
        rung({ frameMs: series(l3Ms), mode: "L3", objectCount: 16_384 }),
      ],
      ...overrides,
    });
  }

  it("passes a run that holds its recorded numbers", () => {
    const check = checkPerformance(androidReport(8.27, 8.34), BASELINES);
    expect(check?.regressions).toEqual([]);
    expect(check?.checked).toEqual(["L2@4096", "L3@16384"]);
    expect(check?.evidence).toBe("docs/verification/prd-130-phase-6-2026-08-16.md");
  });

  it("catches the engine reverting to QuickJS, which is what it exists for", () => {
    // The measured QuickJS numbers from the same device and bundle.
    const check = checkPerformance(androidReport(20.61, 101.24), BASELINES);
    expect(check?.regressions.map((row) => row.rung)).toEqual(["L2@4096", "L3@16384"]);
    const top = check?.regressions.find((row) => row.rung === "L3@16384");
    expect(top?.measuredMs).toBeCloseTo(101.24, 2);
    expect(top?.baselineMs).toBeCloseTo(8.34, 2);
  });

  it("tolerates device noise below the threshold and fails above it", () => {
    // Set so an ordinary noisy afternoon does not cry wolf: a tight bound produces a gate people
    // learn to ignore, which is worse than no gate.
    expect(PERFORMANCE_REGRESSION_TOLERANCE).toBe(0.25);
    const justUnder = 8.34 * 1.24;
    const justOver = 8.34 * 1.26;
    expect(checkPerformance(androidReport(8.27, justUnder), BASELINES)?.regressions).toEqual([]);
    expect(
      checkPerformance(androidReport(8.27, justOver), BASELINES)?.regressions.map(
        (row) => row.rung,
      ),
    ).toEqual(["L3@16384"]);
  });

  it("fails when the run stopped measuring a rung the baseline names", () => {
    // The quiet way a regression hides: drop the expensive rung and every remaining number looks
    // fine. Skipping it would be the v1 harness defect -- an assertion set that shrank to nothing
    // and reported pass.
    const missingTopRung = report({
      arm: "tn-android",
      rungs: [rung({ frameMs: series(8.27), mode: "L2", objectCount: 4096 })],
    });
    expect(() => checkPerformance(missingTopRung, BASELINES)).toThrow(
      /TN_BENCH_BASELINE_RUNG_MISSING.*L3@16384/su,
    );
  });

  it("refuses a provisional run rather than letting it clear the bar", () => {
    // PRD-127's override writes the condition into the report. A number taken outside its declared
    // conditions cannot satisfy a budget, for the same reason `compare` refuses one.
    const provisional = androidReport(8.27, 8.34, { provisional: ["charging"] });
    expect(() => checkPerformance(provisional, BASELINES)).toThrow(
      /TN_BENCH_PROVISIONAL_BASELINE.*charging/su,
    );
  });

  it("says nothing about an arm that has no recorded baseline", () => {
    // Silence, not a pass: an arm nobody has measured must not appear to have met a budget.
    expect(checkPerformance(report({ arm: "tn-web" }), BASELINES)).toBeUndefined();
  });

  it("refuses a negative tolerance instead of inverting the comparison", () => {
    expect(() => checkPerformance(androidReport(8.27, 8.34), BASELINES, -0.1)).toThrow(
      /TN_BENCH_BAD_TOLERANCE/u,
    );
  });

  it("ships a baseline for the Android arm, citing the run that produced it", () => {
    // A baseline with no evidence path is a number nobody can check the conditions of.
    const android = PERFORMANCE_BASELINES["tn-android"];
    expect(android).toBeDefined();
    expect(android?.evidence).toMatch(/^docs\/verification\/.+\.md$/u);
    expect(Object.keys(android?.rungs ?? {})).toContain("L3@16384");
    // The recorded figure is vsync-bound at 120 Hz, so it is a ceiling on V8's real cost. If this
    // ever drops materially below the frame interval, the arm stopped being display-bound and the
    // baseline should be re-derived rather than nudged.
    expect(android?.rungs["L3@16384"]).toBeLessThan(1000 / 120 + 0.5);
  });
});
