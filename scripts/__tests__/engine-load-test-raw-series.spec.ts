import { describe, expect, it } from "vitest";
import { validateRawTimingSeries } from "../engine-load-test/raw-series.js";
import type { IV2RunRecord } from "../engine-load-test/report-v2.js";

const series = {
  schemaVersion: 1,
  unit: "ms",
  boundaries: [
    { frameId: 0, monotonicMs: 100 },
    { frameId: 1, monotonicMs: 110 },
    { frameId: 2, monotonicMs: 130 },
    { frameId: 3, monotonicMs: 160 },
  ],
  finalCompletionMs: 170,
};
const record = {
  metrics: [
    { name: "completed-work-mean-ms", unit: "ms", value: 70 / 3 },
    { name: "frame-p95-ms", unit: "ms", value: 30 },
  ],
  durationMs: { measure: 70 },
  outcome: { runStatus: "valid" },
  runId: "run-1",
  timing: { measuredFrames: 3 },
} as unknown as IV2RunRecord;

describe("raw timing series validation", () => {
  it("includes the final drain in completed-work mean, but not frame percentiles", () => {
    expect(validateRawTimingSeries(record, series)).toMatchObject({
      frameCount: 3,
      intervalP50Ms: 20,
      intervalP95Ms: 30,
      intervalMaxMs: 30,
      finalDrainMs: 10,
      histogram: [0, 0, 1, 2, 0, 0],
      hitchCount: 0,
    });
    expect(() =>
      validateRawTimingSeries(
        { ...record, metrics: [{ name: "completed-work-mean-ms", unit: "ms", value: 20 }] },
        series,
      ),
    ).toThrow(/completed-work mean mismatch/u);
    expect(() => validateRawTimingSeries(record, { ...series, finalCompletionMs: 190 })).toThrow(
      /completed-work mean mismatch/u,
    );
  });

  it("counts pacing hitches above twice the run median", () => {
    const spiky = {
      ...series,
      boundaries: [100, 110, 120, 200].map((monotonicMs, frameId) => ({
        frameId,
        monotonicMs,
      })),
      finalCompletionMs: 210,
    };
    const spikyRecord = {
      ...record,
      durationMs: { measure: 110 },
      metrics: [{ name: "completed-work-mean-ms", unit: "ms", value: 110 / 3 }],
    } as IV2RunRecord;
    expect(validateRawTimingSeries(spikyRecord, spiky)).toMatchObject({
      histogram: [0, 0, 2, 0, 0, 1],
      hitchCount: 1,
      intervalP50Ms: 10,
      intervalMaxMs: 80,
    });
  });

  it("rejects changed units, dropped boundaries and reused frame IDs", () => {
    expect(() => validateRawTimingSeries(record, { ...series, unit: "us" })).toThrow(/unit ms/u);
    expect(() =>
      validateRawTimingSeries(record, { ...series, boundaries: series.boundaries.slice(1) }),
    ).toThrow(/boundary count/u);
    expect(() =>
      validateRawTimingSeries(record, {
        ...series,
        boundaries: series.boundaries.map((boundary, index) =>
          index === 1 ? { ...boundary, frameId: 0 } : boundary,
        ),
      }),
    ).toThrow(/frame ID mismatch/u);
  });

  it("refuses a numeric GPU metric without matching per-frame GPU observations", () => {
    const withGpu = {
      ...record,
      metrics: [...record.metrics, { name: "gpu-ms", unit: "ms", value: 5 }],
    };
    expect(() => validateRawTimingSeries(withGpu, series)).toThrow(/lacks per-frame GPU samples/u);
    const gpuSamples = [0, 1, 2].map((frameId) => ({ frameId, passId: "frame", elapsedMs: 5 }));
    expect(() => validateRawTimingSeries(withGpu, { ...series, gpuSamples })).not.toThrow();
    expect(() =>
      validateRawTimingSeries(withGpu, {
        ...series,
        gpuSamples: gpuSamples.map((sample, index) =>
          index === 1 ? { ...sample, frameId: 0 } : sample,
        ),
      }),
    ).toThrow(/GPU frame ID mismatch/u);
  });

  it("counts sparse GPU observations and rejects malformed samples even when gpu-ms is null", () => {
    const missingGpu = {
      ...record,
      metrics: [
        ...record.metrics,
        { name: "gpu-ms", reason: "timestamp dropout", unit: "ms", value: null },
      ],
    } as IV2RunRecord;
    const sample = { frameId: 2, passId: "frame", elapsedMs: 5 };
    const oneSample = [sample];
    expect(validateRawTimingSeries(missingGpu, { ...series, gpuSamples: oneSample })).toMatchObject(
      {
        gpuSampleCount: 1,
        gpuMissingFrames: 2,
      },
    );
    expect(() =>
      validateRawTimingSeries(missingGpu, {
        ...series,
        gpuSamples: [{ frameId: 3, passId: "frame", elapsedMs: 5 }],
      }),
    ).toThrow(/GPU frame ID/u);
    expect(() =>
      validateRawTimingSeries(missingGpu, {
        ...series,
        gpuSamples: [sample, sample],
      }),
    ).toThrow(/GPU frame ID/u);
  });

  it("rejects a GPU observation when a failed attempt has zero measured frames", () => {
    const emptyRecord = {
      ...record,
      outcome: { runStatus: "crashed" },
      timing: { measuredFrames: 0 },
    } as IV2RunRecord;
    expect(() =>
      validateRawTimingSeries(emptyRecord, {
        schemaVersion: 1,
        unit: "ms",
        boundaries: [{ frameId: 0, monotonicMs: 100 }],
        finalCompletionMs: 100,
        gpuSamples: [{ frameId: 0, passId: "frame", elapsedMs: 1 }],
      }),
    ).toThrow(/GPU frame ID/u);
    expect(() =>
      validateRawTimingSeries(
        {
          ...emptyRecord,
          metrics: [...record.metrics, { name: "gpu-ms", unit: "ms", value: 0 }],
        } as IV2RunRecord,
        {
          schemaVersion: 1,
          unit: "ms",
          boundaries: [{ frameId: 0, monotonicMs: 100 }],
          finalCompletionMs: 100,
          gpuSamples: [],
        },
      ),
    ).toThrow(/numeric gpu-ms lacks/u);
  });
});
