// PRD-449 Phase 2: the v2 run/attempt contract. The three states that get confused are the whole
// point of these tests — a field that is absent is a record that lied about what it measured, `null`
// is a metric the platform never exposed, and `0` is a sample somebody actually observed.

import { describe, expect, it } from "vitest";
import {
  type IV2RunRecord,
  PRIMARY_METRIC,
  parseV2RunRecord,
  readResultRecord,
} from "../engine-load-test/report-v2.js";
import { type IRunReport, parseRunReport } from "../engine-load-test/report.js";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    arm: {
      backend: "vulkan",
      build: { hash: HASH, type: "release" },
      engine: "threenative",
      flags: { shadows: "off" },
      id: "tn-native",
      version: "0.1.0",
    },
    block: 1,
    campaignHash: HASH,
    campaignId: "campaign-2026-09-25",
    checksums: { "raw/attempt-0001-frame-ms.json": HASH, "raw/cubes-conformance.json": OTHER_HASH },
    comparability: "matched-task",
    comparabilityReason: null,
    derivationVersion: "derive-1",
    durationMs: { measure: 48_000, startup: 812.5, warmup: 4000 },
    experiment: {
      fixtureRevision: "cubes-r1",
      load: "10000",
      optimizationClass: "default",
      protocol: "deterministic-throughput",
      renderingProfile: "common-1080p",
      variant: "rotating",
      workload: "bevy-many-cubes",
    },
    fixture: {
      conformance: "pass",
      evidence: "raw/cubes-conformance.json",
      hash: HASH,
    },
    machine: {
      gpu: "RTX 4070",
      id: "bench-desktop-01",
      lane: "physical-hardware",
      os: "linux-6.11",
      preflight: { passed: true, reason: null },
    },
    metrics: [
      { name: "completed-work-mean-ms", reason: null, unit: "ms", value: 8.25 },
      { name: "gpu-ms", reason: null, unit: "ms", value: 7.5 },
    ],
    order: 0,
    outcome: { reason: null, runStatus: "valid" },
    planHash: HASH,
    runId: "attempt-0001",
    schemaVersion: 2,
    session: 1,
    sourceHash: HASH,
    timing: {
      definition: "completed-work-mean: wall time for N complete rendered frames, drained once",
      measuredFrames: 6000,
      rawSeries: "raw/attempt-0001-frame-ms.json",
      rawSeriesReason: null,
      warmupFrames: 600,
    },
    ...overrides,
  };
}

function legacy(): IRunReport {
  return {
    arm: "tn-web",
    build: { notes: "", type: "release" },
    device: { battery: null, label: "desktop-chrome-linux" },
    display: { height: 720, refreshHz: 60, vsync: false, width: 1280 },
    driver: { adapter: "test adapter", renderer: "test renderer" },
    engine: { name: "threenative", version: "workspace" },
    rungs: [
      {
        drawCalls: 4097,
        frameMs: [10, 10, 10, 10],
        mode: "L1",
        objectCount: 4096,
        positionHash: "aabbccdd",
        repeat: 0,
        triangles: 49_176,
        visibleObjects: 4096,
      },
    ],
  };
}

describe("the v2 result contract", () => {
  it("parses a valid record without inventing or dropping a field", () => {
    const parsed: IV2RunRecord = parseV2RunRecord(record());
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.arm.backend).toBe("vulkan");
    expect(parsed.experiment.optimizationClass).toBe("default");
    expect(parsed.timing.measuredFrames).toBe(6000);
    expect(parsed.metrics.map((metric) => metric.name)).toEqual([
      "completed-work-mean-ms",
      "gpu-ms",
    ]);
    expect(parsed.outcome).toEqual({ reason: null, runStatus: "valid" });
  });

  it("rejects completed-work time labelled with a different unit", () => {
    expect(() =>
      parseV2RunRecord(
        record({
          metrics: [{ name: PRIMARY_METRIC, reason: null, unit: "us", value: 8.25 }],
        }),
      ),
    ).toThrow(/milliseconds/u);
  });

  it("reads a v1 report through the same entry point without changing its meaning", () => {
    const legacyReport = legacy();
    const read = readResultRecord(legacyReport);
    expect(read.schemaVersion).toBe(1);
    if (read.schemaVersion !== 1) throw new Error("expected a legacy record");
    expect(read.report).toEqual(parseRunReport(legacyReport));
    expect(readResultRecord(record()).schemaVersion).toBe(2);
  });

  it("rejects a schema version it does not implement instead of guessing", () => {
    expect(() => parseV2RunRecord(record({ schemaVersion: 3 }))).toThrow(/schemaVersion/u);
    expect(() => readResultRecord(record({ schemaVersion: 3 }))).toThrow(/schemaVersion/u);
    expect(() => readResultRecord({ ...legacy(), schemaVersion: 2 })).toThrow();
  });

  it("treats an absent required field as a lie, not a default", () => {
    for (const key of [
      "arm",
      "block",
      "campaignHash",
      "campaignId",
      "checksums",
      "comparability",
      "derivationVersion",
      "durationMs",
      "experiment",
      "fixture",
      "machine",
      "metrics",
      "outcome",
      "planHash",
      "runId",
      "session",
      "sourceHash",
      "timing",
    ]) {
      const without = record();
      delete without[key];
      expect(() => parseV2RunRecord(without), `${key} absent`).toThrow(TN_BENCH_BAD_SHAPE);
    }
    const noPrimary = record({
      metrics: [{ name: "gpu-ms", reason: null, unit: "ms", value: 7.5 }],
    });
    expect(() => parseV2RunRecord(noPrimary)).toThrow(/completed-work-mean-ms/u);
  });

  it("keeps absent, null and zero apart", () => {
    // Absent metric name: the metric was not measured and did not say so.
    expect(() => parseV2RunRecord(record({ metrics: [{ unit: "ms", value: 1 }] }))).toThrow(
      TN_BENCH_BAD_SHAPE,
    );
    // null: unavailable, and it owes an observer a reason.
    const unavailable = record({
      metrics: [
        { name: "completed-work-mean-ms", reason: null, unit: "ms", value: 8.25 },
        {
          name: "presented-fps",
          reason: "no platform presentation counter",
          unit: "fps",
          value: null,
        },
      ],
    });
    const parsedUnavailable = parseV2RunRecord(unavailable);
    expect(parsedUnavailable.metrics[1]?.value).toBeNull();
    expect(parsedUnavailable.metrics[1]?.reason).toBe("no platform presentation counter");
    expect(() =>
      parseV2RunRecord(
        record({
          metrics: [
            { name: "completed-work-mean-ms", reason: null, unit: "ms", value: 8.25 },
            { name: "presented-fps", reason: null, unit: "fps", value: null },
          ],
        }),
      ),
    ).toThrow(/presented-fps.*reason/u);
    // A reason on a real sample is the missing-GPU-data trap wearing a zero's clothes.
    expect(() =>
      parseV2RunRecord(
        record({
          metrics: [
            { name: "completed-work-mean-ms", reason: null, unit: "ms", value: 8.25 },
            { name: "gpu-ms", reason: "timestamps unavailable", unit: "ms", value: 0 },
          ],
        }),
      ),
    ).toThrow(/gpu-ms/u);
    // Zero is a real observation and stays: a work counter somebody watched read zero, on an attempt
    // that measured what it claims and is honest about the attempt status.
    const zeroed = parseV2RunRecord(
      record({
        durationMs: { measure: 1200, startup: 0, warmup: 0 },
        metrics: [
          { name: "completed-work-mean-ms", reason: null, unit: "ms", value: 8.25 },
          { name: "upload-bytes", reason: null, unit: "bytes", value: 0 },
        ],
      }),
    );
    expect(zeroed.durationMs.startup).toBe(0);
    expect(zeroed.metrics[1]?.value).toBe(0);
  });

  it("refuses a valid run whose primary metric is unavailable, and a failure without a reason", () => {
    expect(() =>
      parseV2RunRecord(
        record({
          metrics: [
            {
              name: "completed-work-mean-ms",
              reason: "no final-completion observation",
              unit: "ms",
              value: null,
            },
          ],
        }),
      ),
    ).toThrow(/completed-work-mean-ms/u);
    expect(() =>
      parseV2RunRecord(record({ outcome: { reason: null, runStatus: "crashed" } })),
    ).toThrow(/reason/u);
    expect(
      parseV2RunRecord(record({ outcome: { reason: "segfault in submit", runStatus: "crashed" } }))
        .outcome.runStatus,
    ).toBe("crashed");
  });

  it("validates ids, hashes, enums, timings and artifact refs", () => {
    // Each case names the path its own validator must reject on, so a mutation cannot pass by
    // tripping an earlier check somewhere else in the record.
    const arm = record().arm as Record<string, unknown>;
    const experiment = record().experiment as Record<string, unknown>;
    const machine = record().machine as Record<string, unknown>;
    const timing = record().timing as Record<string, unknown>;
    const cases: readonly [string, string, Record<string, unknown>][] = [
      ["id", "v2RunRecord.campaignId", record({ campaignId: "campaign 1" })],
      ["hash", "v2RunRecord.planHash", record({ planHash: "abc" })],
      [
        "build hash",
        "v2RunRecord.arm.build.hash",
        record({ arm: { ...arm, build: { hash: "nope", type: "release" } } }),
      ],
      [
        "runStatus",
        "v2RunRecord.outcome.runStatus",
        record({ outcome: { reason: "x", runStatus: "mostly-fine" } }),
      ],
      [
        "comparability",
        "v2RunRecord.comparability",
        record({ comparability: "different", comparabilityReason: null }),
      ],
      [
        "comparability owes a reason",
        "v2RunRecord.comparability",
        record({ comparability: "qualified", comparabilityReason: null }),
      ],
      [
        "optimizationClass",
        "v2RunRecord.experiment.optimizationClass",
        record({ experiment: { ...experiment, optimizationClass: "max-speed" } }),
      ],
      [
        "protocol",
        "v2RunRecord.experiment.protocol",
        record({ experiment: { ...experiment, protocol: "as-fast-as-possible" } }),
      ],
      [
        "build type",
        "v2RunRecord.arm.build.type",
        record({ arm: { ...arm, build: { hash: HASH, type: "nightly" } } }),
      ],
      ["backend", "v2RunRecord.arm.backend", record({ arm: { ...arm, backend: "web gpu" } })],
      ["flags", "v2RunRecord.arm.flags", record({ arm: { ...arm, flags: { shadows: 1 } } })],
      ["lane", "v2RunRecord.machine.lane", record({ machine: { ...machine, lane: "cloud-gpu" } })],
      [
        "preflight",
        "v2RunRecord.machine.preflight",
        record({ machine: { ...machine, preflight: { passed: false, reason: null } } }),
      ],
      [
        "negative duration",
        "v2RunRecord.durationMs.measure",
        record({ durationMs: { measure: -1, startup: 1, warmup: 1 } }),
      ],
      [
        "NaN duration",
        "v2RunRecord.durationMs.measure",
        record({ durationMs: { measure: Number.NaN, startup: 1, warmup: 1 } }),
      ],
      [
        "fractional frames",
        "v2RunRecord.timing.measuredFrames",
        record({ timing: { ...timing, measuredFrames: 1.5 } }),
      ],
      [
        "negative metric",
        "v2RunRecord.metrics[0].value",
        record({ metrics: [{ name: PRIMARY_METRIC, reason: null, unit: "ms", value: -1 }] }),
      ],
      [
        "traversal",
        "v2RunRecord.timing.rawSeries",
        record({ timing: { ...timing, rawSeries: "../escape.json" } }),
      ],
      [
        "absolute",
        "v2RunRecord.timing.rawSeries",
        record({ timing: { ...timing, rawSeries: "/etc/passwd" } }),
      ],
      [
        "backslash",
        "v2RunRecord.timing.rawSeries",
        record({ timing: { ...timing, rawSeries: "raw\\frames.json" } }),
      ],
      [
        "evidence traversal",
        "v2RunRecord.fixture.evidence",
        record({ fixture: { conformance: "pass", evidence: "raw/../../etc/passwd", hash: HASH } }),
      ],
      [
        "evidence absent",
        "v2RunRecord.fixture.evidence",
        record({ fixture: { conformance: "pass", hash: HASH } }),
      ],
      ["block", "v2RunRecord.block", record({ block: 0 })],
      ["order", "v2RunRecord.order", record({ order: -1 })],
      ["session", "v2RunRecord.session", record({ session: 0 })],
      ["derivation", "v2RunRecord.derivationVersion", record({ derivationVersion: "derive 1" })],
      [
        "checksum value",
        "v2RunRecord.checksums",
        record({ checksums: { "raw/attempt-0001-frame-ms.json": "x" } }),
      ],
    ];
    for (const [label, path, value] of cases) {
      expect(() => parseV2RunRecord(value), `${label} -> ${path}`).toThrow(TN_BENCH_BAD_SHAPE);
      expect(() => parseV2RunRecord(value), `${label} -> ${path}`).toThrow(path);
    }
  });

  it("refuses a valid run that measured nothing, preflighed nothing or proved no fixture", () => {
    // The review's exact complaint: a `valid` run that never measured anything used to parse. Each
    // case removes one observation a valid run owes, and the path is the field that owes it.
    const timings = record().timing as Record<string, unknown>;
    const cases: readonly [string, Record<string, unknown>, string][] = [
      [
        "no measured frames",
        record({ timing: { ...timings, measuredFrames: 0 } }),
        "v2RunRecord.timing.measuredFrames",
      ],
      [
        "no measure duration",
        record({ durationMs: { measure: 0, startup: 812.5, warmup: 4000 } }),
        "v2RunRecord.durationMs.measure",
      ],
      [
        "no completed work",
        record({ metrics: [{ name: PRIMARY_METRIC, reason: null, unit: "ms", value: 0 }] }),
        "v2RunRecord.metrics",
      ],
      [
        "failed preflight",
        record({
          machine: {
            ...(record().machine as Record<string, unknown>),
            preflight: { passed: false, reason: "adapter reported no timeline support" },
          },
        }),
        "v2RunRecord.machine.preflight",
      ],
      [
        "conformance without evidence",
        record({ fixture: { conformance: "pass", evidence: null, hash: HASH } }),
        "v2RunRecord.fixture",
      ],
      [
        "no fixture conformance",
        record({ fixture: { conformance: "not-run", evidence: null, hash: HASH } }),
        "v2RunRecord.fixture",
      ],
      [
        "no raw timing series",
        record({ timing: { ...timings, rawSeries: null, rawSeriesReason: "not collected" } }),
        "v2RunRecord.timing.rawSeries",
      ],
    ];
    for (const [label, value, path] of cases) {
      expect(() => parseV2RunRecord(value), label).toThrow(TN_BENCH_BAD_SHAPE);
      expect(() => parseV2RunRecord(value), label).toThrow(path);
    }
  });

  it("lets an attempt that never ran say so instead of inventing a file, a sample or a checksum", () => {
    const notRun = record({
      checksums: {},
      comparability: "non-comparable",
      comparabilityReason: "lane not provisioned for this campaign",
      durationMs: { measure: 0, startup: 0, warmup: 0 },
      fixture: { conformance: "not-run", evidence: null, hash: HASH },
      machine: {
        ...(record().machine as Record<string, unknown>),
        preflight: { passed: false, reason: "lane is unprovisioned" },
      },
      metrics: [
        {
          name: PRIMARY_METRIC,
          reason: "the process was never started",
          unit: "ms",
          value: null,
        },
      ],
      outcome: { reason: "no device attached to the lane", runStatus: "not-run" },
      timing: {
        definition: "completed-work-mean: wall time for N complete rendered frames, drained once",
        measuredFrames: 0,
        rawSeries: null,
        rawSeriesReason: "no frames were measured",
        warmupFrames: 0,
      },
    });
    const parsed = parseV2RunRecord(notRun);
    expect(parsed.timing.rawSeries).toBeNull();
    expect(parsed.timing.rawSeriesReason).toBe("no frames were measured");
    expect(parsed.timing.measuredFrames).toBe(0);
    expect(parsed.checksums).toEqual({});
    // The same shape is legal as `unsupported`, and a crashed attempt may keep partial raw evidence.
    expect(
      parseV2RunRecord({
        ...notRun,
        outcome: { reason: "no WebGPU on this device", runStatus: "unsupported" },
      }).outcome.runStatus,
    ).toBe("unsupported");
    const partial = parseV2RunRecord(
      record({
        metrics: [
          { name: PRIMARY_METRIC, reason: null, unit: "ms", value: 4.2 },
          { name: "gpu-ms", reason: "device lost after 1200 frames", unit: "ms", value: null },
        ],
        outcome: { reason: "device lost mid-block", runStatus: "crashed" },
      }),
    );
    expect(partial.timing.rawSeries).toBe("raw/attempt-0001-frame-ms.json");
  });

  it("refuses a null raw series with no reason, a reason on a real one, and an uncovered ref", () => {
    const timings = record().timing as Record<string, unknown>;
    expect(() =>
      parseV2RunRecord(record({ timing: { ...timings, rawSeries: null, rawSeriesReason: null } })),
    ).toThrow(/rawSeriesReason/u);
    expect(() =>
      parseV2RunRecord(
        record({
          timing: { ...timings, rawSeries: "raw/attempt-0001-frame-ms.json", rawSeriesReason: "x" },
        }),
      ),
    ).toThrow(/rawSeriesReason/u);
    expect(() =>
      parseV2RunRecord(record({ timing: { ...timings, rawSeries: undefined } })),
    ).toThrow(/rawSeries/u);
    // A named series with no digest is a claim nothing can check.
    expect(() =>
      parseV2RunRecord(record({ checksums: { "raw/cubes-conformance.json": HASH } })),
    ).toThrow(/raw\/attempt-0001-frame-ms\.json/u);
    expect(() =>
      parseV2RunRecord(record({ checksums: { "raw/attempt-0001-frame-ms.json": HASH } })),
    ).toThrow(/raw\/cubes-conformance\.json/u);
    // Every checksum key is an artifact ref, not an arbitrary map key.
    expect(() =>
      parseV2RunRecord(
        record({
          checksums: { "../escape.json": HASH, "raw/attempt-0001-frame-ms.json": HASH },
        }),
      ),
    ).toThrow(/v2RunRecord\.checksums/u);
  });

  it("refuses duplicate metric names and a matched-task claim that carries a reason", () => {
    expect(() =>
      parseV2RunRecord(
        record({
          metrics: [
            { name: PRIMARY_METRIC, reason: null, unit: "ms", value: 8.25 },
            { name: PRIMARY_METRIC, reason: null, unit: "ms", value: 9.1 },
          ],
        }),
      ),
    ).toThrow(/duplicate/u);
    expect(() =>
      parseV2RunRecord(
        record({ comparability: "matched-task", comparabilityReason: "ran on a different GPU" }),
      ),
    ).toThrow(/comparabilityReason/u);
  });
});

const TN_BENCH_BAD_SHAPE = /TN_BENCH_BAD_SHAPE/u;
