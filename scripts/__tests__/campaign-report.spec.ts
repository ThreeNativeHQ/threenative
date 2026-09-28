import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_DERIVATION_VERSION,
  CAMPAIGN_SCHEMA_VERSION,
  type ICampaignRunRecord,
  parseCampaignRun,
} from "../engine-load-test/campaign-report.js";
import { parseRunReport } from "../engine-load-test/report.js";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

function record(overrides: Partial<ICampaignRunRecord> = {}): Record<string, unknown> {
  return {
    arm: {
      arm: "tn-native",
      backend: "vulkan",
      build: "release",
      buildSha256: DIGEST_A,
      engineVersion: "0.9.0",
      flags: { shadows: false, msaa: "off" },
    },
    block: 3,
    campaignId: "prd-449-2026-09-27-a",
    checksums: {
      "runs/prd-449-2026-09-27-a/block-3/tn-native.json": DIGEST_B,
      "runs/a/block-3/tn-native.frames.json": DIGEST_B,
    },
    conformance: { evidencePath: "conformance/tn-native.json", reason: null, status: "passed" },
    derivationVersion: CAMPAIGN_DERIVATION_VERSION,
    durations: {
      measured: { unit: "ms", value: 30_000 },
      startup: { reason: "not a startup profile", unit: "ms", value: null },
      warmup: { unit: "ms", value: 10_000 },
    },
    experiment: {
      executionProtocol: "deterministic-throughput",
      fixtureRevision: "cubes@2",
      load: "100k",
      optimizationClass: "default",
      renderingProfile: "common-1920x1080",
      variant: "all-rotating",
      workload: "bevy-many-cubes",
    },
    fixtureSha256: DIGEST_A,
    machine: {
      cpu: "AMD Ryzen 9 7950X",
      gpu: "Radeon RX 7900 XTX",
      operatingSystem: "Linux 6.11",
      preflight: { competingGpuWork: false, powerMode: "performance" },
    },
    metrics: {
      completedWorkMeanMsPerFrame: { unit: "ms/frame", value: 8.4 },
      frameP99Ms: { reason: "no per-frame intervals recorded", unit: "ms", value: null },
    },
    order: 2,
    planSha256: DIGEST_A,
    rawSeries: [
      { metric: "frameMs", path: "runs/a/block-3/tn-native.frames.json", sampleCount: 6000 },
    ],
    reason: null,
    runId: "prd-449-2026-09-27-a-b03-o02",
    schemaVersion: CAMPAIGN_SCHEMA_VERSION,
    session: "session-2",
    sourceSha256: DIGEST_B,
    status: "valid",
    timingDefinition: "completed-work mean over 6000 rendered frames, drained once at the boundary",
    ...overrides,
  };
}

function withRecord(overrides: Record<string, unknown>): unknown {
  return { ...(record() as object), ...overrides };
}

describe("campaign run v2 contract", () => {
  it("should read a full record and keep every identity it was given", () => {
    const parsed = parseCampaignRun(record());

    expect(parsed.status).toBe("valid");
    expect(parsed.runId).toBe("prd-449-2026-09-27-a-b03-o02");
    expect(parsed.experiment.workload).toBe("bevy-many-cubes");
    expect(parsed.experiment.optimizationClass).toBe("default");
    expect(parsed.arm.flags).toEqual({ shadows: false, msaa: "off" });
    expect(parsed.block).toBe(3);
    expect(parsed.session).toBe("session-2");
    expect(parsed.order).toBe(2);
    expect(parsed.conformance.status).toBe("passed");
    expect(parsed.machine.preflight.competingGpuWork).toBe(false);
    expect(parsed.rawSeries[0]?.path).toBe("runs/a/block-3/tn-native.frames.json");
    expect(parsed.checksums["runs/prd-449-2026-09-27-a/block-3/tn-native.json"]).toBe(DIGEST_B);
  });

  it("should read a run that never produced a sample", () => {
    // A crash, a timeout, an unimplemented adapter and a skipped arm are all reportable facts. The
    // record that says so is the point: without it the only way to describe them would be to invent
    // a measurement, which is what §7.4 forbids.
    for (const status of ["crashed", "timed-out", "unsupported", "not-run"] as const) {
      const parsed = parseCampaignRun(
        withRecord({
          conformance: { evidencePath: null, reason: "the arm never started", status: "not-run" },
          durations: {
            measured: { reason: "no phase ran", unit: "ms", value: null },
            startup: { reason: "no phase ran", unit: "ms", value: null },
            warmup: { reason: "no phase ran", unit: "ms", value: null },
          },
          metrics: {
            completedWorkMeanMsPerFrame: {
              reason: "no frame completed",
              unit: "ms/frame",
              value: null,
            },
          },
          rawSeries: [],
          reason: `${status} before the first frame`,
          status,
        }),
      );

      expect(parsed.status, status).toBe(status);
      expect(parsed.rawSeries, status).toEqual([]);
      expect(parsed.metrics.completedWorkMeanMsPerFrame?.value, status).toBeNull();
      expect(parsed.metrics.completedWorkMeanMsPerFrame?.reason, status).toBe("no frame completed");
      expect(parsed.durations.measured.value, status).toBeNull();
    }
  });

  it("should refuse a valid run with nothing measured behind it", () => {
    const nullPrimary = {
      completedWorkMeanMsPerFrame: { reason: "dropped", unit: "ms/frame", value: null },
    };
    const noMeasuredDuration = {
      measured: { reason: "never entered the measured phase", unit: "ms", value: null },
      startup: { reason: "never entered the measured phase", unit: "ms", value: null },
      warmup: { reason: "never entered the measured phase", unit: "ms", value: null },
    };

    for (const [label, overrides] of [
      ["null primary metric", { metrics: nullPrimary }],
      [
        "failed conformance",
        { conformance: { evidencePath: null, reason: "hash mismatch", status: "failed" } },
      ],
      [
        "conformance never run",
        { conformance: { evidencePath: null, reason: "no build to test", status: "not-run" } },
      ],
      ["null measured duration", { durations: noMeasuredDuration }],
      [
        "zero primary metric",
        {
          metrics: { completedWorkMeanMsPerFrame: { unit: "ms/frame", value: 0 } },
        },
      ],
      [
        "zero measured duration",
        {
          durations: {
            measured: { unit: "ms", value: 0 },
            startup: { reason: "n/a", unit: "ms", value: null },
            warmup: { unit: "ms", value: 0 },
          },
        },
      ],
      // Empty samples plus a null primary is a legal non-valid record, so only `valid` refuses it.
      ["no raw series", { metrics: nullPrimary, rawSeries: [] }],
    ] as const) {
      expect(() => parseCampaignRun(withRecord(overrides)), label).toThrow(/TN_BENCH_BAD_SHAPE/u);
    }
    expect(() => parseCampaignRun(withRecord({ metrics: nullPrimary }))).toThrow(
      /run.metrics.completedWorkMeanMsPerFrame is null on a valid run/u,
    );
    expect(() => parseCampaignRun(withRecord({ durations: noMeasuredDuration }))).toThrow(
      /run.durations.measured is null on a valid run/u,
    );
    expect(() =>
      parseCampaignRun(
        withRecord({ metrics: { completedWorkMeanMsPerFrame: { unit: "ms/frame", value: 0 } } }),
      ),
    ).toThrow(/run.metrics.completedWorkMeanMsPerFrame must be greater than zero on a valid run/u);
    expect(() =>
      parseCampaignRun(
        withRecord({
          durations: {
            measured: { unit: "ms", value: 0 },
            startup: { reason: "n/a", unit: "ms", value: null },
            warmup: { unit: "ms", value: 0 },
          },
        }),
      ),
    ).toThrow(/run.durations.measured must be greater than zero on a valid run/u);
    expect(() =>
      parseCampaignRun(
        withRecord({
          conformance: { evidencePath: null, reason: "hash mismatch", status: "failed" },
        }),
      ),
    ).toThrow(/run.conformance must be passed on a valid run/u);
    expect(() => parseCampaignRun(withRecord({ metrics: nullPrimary, rawSeries: [] }))).toThrow(
      /run.rawSeries is empty on a valid run/u,
    );
  });

  it("should refuse a number with no samples and a reason on a value that was measured", () => {
    expect(() => parseCampaignRun(withRecord({ rawSeries: [] }))).toThrow(
      /run.rawSeries is empty, so run.metrics.completedWorkMeanMsPerFrame must be null with a reason/u,
    );
    expect(() =>
      parseCampaignRun(
        withRecord({
          metrics: {
            completedWorkMeanMsPerFrame: {
              reason: "slower than the incumbent, but measured",
              unit: "ms/frame",
              value: 8.4,
            },
          },
        }),
      ),
    ).toThrow(/run.metrics.completedWorkMeanMsPerFrame.reason is for a null measurement only/u);
  });

  it("should require a checksum for every raw series it references", () => {
    expect(() =>
      parseCampaignRun(withRecord({ checksums: { "runs/other.json": DIGEST_B } })),
    ).toThrow(/run.checksums has no entry for runs\/a\/block-3\/tn-native.frames.json/u);
  });

  it("should keep absent, null and zero as three different facts", () => {
    // A measured zero is a value, so it is read as one here. A `valid` run is the one place a zero
    // primary is refused: no completed frame took no time, so zero there is a missing observation
    // wearing a number's clothes.
    const parsed = parseCampaignRun(
      record({
        metrics: {
          completedWorkMeanMsPerFrame: { unit: "ms/frame", value: 0 },
          frameP99Ms: { reason: "dropped samples", unit: "ms", value: null },
        },
        reason: "VRAM ceiling reached before the block finished",
        status: "resource-limited",
      } as Partial<ICampaignRunRecord>),
    );

    // A measured zero is a value; an unobservable metric is null plus its reason; a metric nobody
    // recorded is absent from the map entirely.
    expect(parsed.metrics.completedWorkMeanMsPerFrame?.value).toBe(0);
    expect(parsed.metrics.frameP99Ms?.value).toBeNull();
    expect(parsed.metrics.frameP99Ms?.reason).toBe("dropped samples");
    expect("gpuMs" in parsed.metrics).toBe(false);
    expect(parsed.durations.startup.value).toBeNull();
    expect(parsed.durations.measured.value).toBe(30_000);
  });

  it("should reject a null measurement that gives no reason and a negative value", () => {
    expect(() =>
      parseCampaignRun(
        withRecord({
          metrics: {
            completedWorkMeanMsPerFrame: { reason: "", unit: "ms/frame", value: null },
          },
        }),
      ),
    ).toThrow(/TN_BENCH_BAD_SHAPE/u);
    expect(() =>
      parseCampaignRun(
        withRecord({
          metrics: { completedWorkMeanMsPerFrame: { unit: "ms/frame", value: -1 } },
        }),
      ),
    ).toThrow(/must not be negative/u);
    expect(() =>
      parseCampaignRun(
        withRecord({
          durations: {
            measured: { unit: "ms", value: Number.NaN },
            startup: { unit: "ms", value: null, reason: "none" },
            warmup: { unit: "ms", value: 0 },
          },
        }),
      ),
    ).toThrow(/run.durations.measured.value must be a finite number/u);
  });

  it("should require the primary metric to be accounted for", () => {
    expect(() =>
      parseCampaignRun(withRecord({ metrics: { frameP99Ms: { unit: "ms", value: 4 } } })),
    ).toThrow(/run.metrics.completedWorkMeanMsPerFrame is absent/u);
  });

  it("should reject an unknown status and an unexplained outcome", () => {
    expect(() => parseCampaignRun(withRecord({ status: "inconclusive" }))).toThrow(
      /TN_BENCH_BAD_SHAPE: run.status inconclusive is not one of/u,
    );
    expect(() => parseCampaignRun(withRecord({ status: "timed-out", reason: null }))).toThrow(
      /run.reason must say why the run is timed-out/u,
    );
    expect(() => parseCampaignRun(withRecord({ reason: "suspicious" }))).toThrow(
      /run.reason is set on a valid run/u,
    );
    expect(
      parseCampaignRun(withRecord({ status: "resource-limited", reason: "VRAM ceiling reached" }))
        .reason,
    ).toBe("VRAM ceiling reached");
  });

  it("should reject a missing or malformed identity", () => {
    for (const key of [
      "campaignId",
      "runId",
      "session",
      "planSha256",
      "sourceSha256",
      "fixtureSha256",
    ]) {
      const incomplete = record();
      // The point of each case is the absent key.
      delete incomplete[key];
      expect(() => parseCampaignRun(incomplete), key).toThrow(/TN_BENCH_/u);
    }
    expect(() => parseCampaignRun(withRecord({ planSha256: "not-a-digest" }))).toThrow(
      /run.planSha256 must be a sha-256 hex digest/u,
    );
    expect(() => parseCampaignRun(withRecord({ schemaVersion: 1 }))).toThrow(
      /run.schemaVersion 1 is not 2/u,
    );
    expect(() => parseCampaignRun(withRecord({ derivationVersion: 0 }))).toThrow(
      /run.derivationVersion 0 is not 1/u,
    );
    expect(() =>
      parseCampaignRun(
        withRecord({
          experiment: { ...(record().experiment as object), optimizationClass: "batched" },
        }),
      ),
    ).toThrow(/optimizationClass batched is not one of/u);
    expect(() =>
      parseCampaignRun(withRecord({ arm: { ...(record().arm as object), build: "" } })),
    ).toThrow(/run.arm.build must be a non-empty string/u);
  });

  it("should reject an artifact reference that leaves the campaign root", () => {
    for (const unsafe of [
      "../../etc/passwd",
      "/etc/passwd",
      "https://host/frames.json",
      "runs\\a.json",
      "runs//a.json",
    ]) {
      expect(
        () =>
          parseCampaignRun(
            withRecord({ rawSeries: [{ metric: "frameMs", path: unsafe, sampleCount: 4 }] }),
          ),
        unsafe,
      ).toThrow(/TN_BENCH_UNSAFE_ARTIFACT_REF/u);
    }
    expect(() => parseCampaignRun(withRecord({ runId: "../run-1" }))).toThrow(
      /TN_BENCH_UNSAFE_ARTIFACT_REF/u,
    );
    expect(() => parseCampaignRun(withRecord({ rawSeries: "none" }))).toThrow(
      /run.rawSeries must be an array/u,
    );
    expect(() =>
      parseCampaignRun(
        withRecord({
          rawSeries: [{ metric: "frameMs", path: "runs/a.json", sampleCount: 0 }],
        }),
      ),
    ).toThrow(/sampleCount must be a whole count from 1 up/u);
  });

  it("should reject a conformance pass with no evidence and a failure with no reason", () => {
    expect(() =>
      parseCampaignRun(
        withRecord({ conformance: { evidencePath: null, reason: null, status: "passed" } }),
      ),
    ).toThrow(/run.conformance.evidencePath is absent for a pass/u);
    expect(() =>
      parseCampaignRun(
        withRecord({ conformance: { evidencePath: null, reason: null, status: "failed" } }),
      ),
    ).toThrow(/run.conformance.reason must say why it is failed/u);
    expect(() =>
      parseCampaignRun(
        withRecord({ conformance: { evidencePath: "c.json", reason: null, status: "not-run" } }),
      ),
    ).toThrow(/must say why it is not-run/u);
  });

  it("should leave the legacy report meaning alone", () => {
    // The v2 reader is not a second reader for v1 records: a legacy report has no schema version and
    // is refused here, while the legacy parser still reads it exactly as before.
    const legacy = {
      arm: "tn-web",
      build: { notes: "", type: "release" },
      device: { battery: null, label: "desktop-chrome-linux" },
      display: { height: 720, refreshHz: 60, vsync: false, width: 1280 },
      driver: { adapter: "test adapter", renderer: "test renderer" },
      engine: { name: "threenative", version: "workspace" },
      rungs: [
        {
          drawCalls: 4097,
          frameMs: [10, 10, 10, 10, 10, 10, 10, 10],
          mode: "L1",
          objectCount: 4096,
          positionHash: "aabbccdd",
          repeat: 0,
          triangles: 49_176,
          visibleObjects: 4096,
        },
      ],
    };

    expect(() => parseCampaignRun(legacy)).toThrow(/run must be an object|TN_BENCH_BAD_SHAPE/u);
    expect(parseRunReport(legacy).rungs[0]?.frameMs).toHaveLength(8);
  });
});
