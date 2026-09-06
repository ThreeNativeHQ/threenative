import { describe, expect, it } from "vitest";

const {
  countEvaluatedAssertions,
  parseNetworkingCpuSamples,
  parseNetworkingMetrics,
  summarizeCombinedNetworkingCpu,
  summarizeNetworkingMetrics,
  validateNetworkingProofConfig,
} = await import(
  // @ts-expect-error The executable JavaScript module is the row's runtime boundary; its behavior is tested here.
  "../run-networking-proof.mjs"
);

const hashes = {
  clientBundleHash: "a".repeat(64),
  nativeBinaryHash: null,
  serverBinaryHash: "b".repeat(64),
};

function config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    buildHashes: hashes,
    certificates: {
      certPath: "/tmp/networking-cert.pem",
      keyPath: "/tmp/networking-key.pem",
    },
    endpoint: "https://localhost:4433/game",
    laneId: "browser-local",
    partner: {
      args: ["--scenario", "partner.playtest.json"],
      assetDir: "/tmp/networking-partner",
      origin: "https://localhost:5174",
      playerId: "bravo",
    },
    profile: "local",
    server: {
      args: ["--listen", "127.0.0.1:4433"],
      command: "tn-network-server",
    },
    subject: {
      args: ["--scenario", "subject.playtest.json"],
      assetDir: "/tmp/networking-subject",
      origin: "https://localhost:5173",
      playerId: "alpha",
    },
    ...overrides,
  };
}

describe("networking proof contract", () => {
  it("parses frame-keyed native transport samples", () => {
    const log =
      'TN_HOST_GAP:{"frames":2,"samples":[{"frame":11,"webtransportMs":0.25},{"frame":12,"webtransportMs":0.5}]}';
    expect(parseNetworkingCpuSamples(log, "subject")).toEqual([
      { frame: 11, webtransportMs: 0.25 },
      { frame: 12, webtransportMs: 0.5 },
    ]);
  });

  it("rejects missing or duplicated frame samples", () => {
    expect(() =>
      parseNetworkingCpuSamples(
        'TN_HOST_GAP:{"frames":2,"samples":[{"frame":11,"webtransportMs":0.25}]}',
        "subject",
      ),
    ).toThrow(/sample count/u);
    expect(() =>
      parseNetworkingCpuSamples(
        'TN_HOST_GAP:{"frames":2,"samples":[{"frame":11,"webtransportMs":0.25},{"frame":11,"webtransportMs":0.5}]}',
        "subject",
      ),
    ).toThrow(/duplicate frame/u);
  });

  it("rejects a missing server", () => {
    const value = config();
    value.server = undefined;
    expect(() => validateNetworkingProofConfig(value)).toThrow(/server/u);
  });

  it("rejects a missing partner client", () => {
    const value = config();
    value.partner = undefined;
    expect(() => validateNetworkingProofConfig(value)).toThrow(/partner/u);
  });

  it("rejects mismatched or duplicate client identities", () => {
    expect(() =>
      validateNetworkingProofConfig(
        config({
          partner: {
            args: ["--scenario", "partner.playtest.json"],
            assetDir: "/tmp/networking-partner",
            playerId: "alpha",
          },
        }),
      ),
    ).toThrow(/distinct/u);
  });

  it("rejects a run that evaluated zero assertions", () => {
    expect(() =>
      countEvaluatedAssertions([{ assertionResults: [] }, { assertionResults: [] }]),
    ).toThrow(/zero assertions/u);
  });

  it("parses real clock, age, action, and JS CPU samples", () => {
    const log =
      'TN_NETWORK_METRICS:{"schemaVersion":2,"appliedStateAgeMs":[10,20,30],"actionAckLatencyMs":[4,8,12],"collectionDurationMs":60000,"clockProbes":[{"rttMs":4,"offsetMs":2,"uncertaintyMs":2}],"jsNetworkingCpuMs":[0.1,0.2,0.3],"unmatchedActionAckCount":0,"warmupMs":10000}';
    expect(parseNetworkingMetrics(log, "subject")).toEqual({
      schemaVersion: 2,
      appliedStateAgeMs: [10, 20, 30],
      actionAckLatencyMs: [4, 8, 12],
      collectionDurationMs: 60000,
      jsNetworkingCpuMs: [0.1, 0.2, 0.3],
      clockProbes: [{ rttMs: 4, offsetMs: 2, uncertaintyMs: 2 }],
      unmatchedActionAckCount: 0,
      warmupMs: 10000,
    });
  });

  it("summarizes samples with nearest-rank percentiles and rejects missing clocks", () => {
    const summary = summarizeNetworkingMetrics(
      {
        schemaVersion: 2,
        appliedStateAgeMs: Array.from({ length: 100 }, () => 10),
        actionAckLatencyMs: Array.from({ length: 100 }, () => 4),
        collectionDurationMs: 60000,
        jsNetworkingCpuMs: Array.from({ length: 100 }, () => 0.1),
        clockProbes: [{ rttMs: 4, offsetMs: 2, uncertaintyMs: 2 }],
        unmatchedActionAckCount: 0,
        warmupMs: 10000,
      },
      "clean-lan",
    );
    expect(summary.appliedStateAgeMs.p95Ms).toBe(10);
    expect(summary.actionAckLatencyMs.p99Ms).toBe(4);
    expect(summary.jsNetworkingCpuMs.p95Ms).toBe(0.1);
    expect(summary.clock.maxUncertaintyMs).toBe(2);
    expect(() =>
      summarizeNetworkingMetrics(
        {
          schemaVersion: 2,
          appliedStateAgeMs: [],
          actionAckLatencyMs: [1],
          jsNetworkingCpuMs: [0.1],
          clockProbes: [],
          collectionDurationMs: 60000,
          unmatchedActionAckCount: 0,
          warmupMs: 10000,
        },
        "clean-lan",
      ),
    ).toThrow(/missing applied-state or clock samples/u);
  });

  it("rejects injected 500ms snapshot age and 5ms polling CPU", () => {
    const base = {
      schemaVersion: 2,
      appliedStateAgeMs: Array.from({ length: 100 }, () => 500),
      actionAckLatencyMs: Array.from({ length: 100 }, () => 10),
      collectionDurationMs: 60000,
      jsNetworkingCpuMs: [0.5],
      clockProbes: [{ rttMs: 4, offsetMs: 2, uncertaintyMs: 2 }],
      unmatchedActionAckCount: 0,
      warmupMs: 10000,
    };
    expect(() => summarizeNetworkingMetrics(base, "clean-lan")).toThrow(/age p95/u);
    expect(() =>
      summarizeNetworkingMetrics(
        {
          ...base,
          appliedStateAgeMs: Array.from({ length: 100 }, () => 10),
          jsNetworkingCpuMs: [5],
        },
        "clean-lan",
      ),
    ).toThrow(/CPU p95/u);
    expect(() =>
      summarizeNetworkingMetrics(
        { ...base, appliedStateAgeMs: Array.from({ length: 100 }, () => 400) },
        "impaired",
      ),
    ).toThrow(/age p95/u);
  });

  it("rejects incomplete workload windows and unmatched acknowledgements", () => {
    const base = {
      schemaVersion: 2,
      appliedStateAgeMs: Array.from({ length: 100 }, () => 10),
      actionAckLatencyMs: Array.from({ length: 100 }, () => 10),
      collectionDurationMs: 60000,
      jsNetworkingCpuMs: Array.from({ length: 100 }, () => 0.1),
      clockProbes: [{ rttMs: 4, offsetMs: 2, uncertaintyMs: 2 }],
      unmatchedActionAckCount: 0,
      warmupMs: 10000,
    };
    expect(() =>
      summarizeNetworkingMetrics({ ...base, actionAckLatencyMs: [10] }, "local"),
    ).toThrow(/at least 100 action/u);
    expect(() => summarizeNetworkingMetrics({ ...base, warmupMs: 9999 }, "clean-lan")).toThrow(
      /warmup/u,
    );
    expect(() =>
      summarizeNetworkingMetrics({ ...base, collectionDurationMs: 59999 }, "clean-lan"),
    ).toThrow(/collection/u);
    expect(() =>
      summarizeNetworkingMetrics({ ...base, unmatchedActionAckCount: 1 }, "clean-lan"),
    ).toThrow(/unmatched/u);
  });

  it("uses paired CPU samples when aligned and a conservative native maximum otherwise", () => {
    expect(
      summarizeCombinedNetworkingCpu(
        [0.2, 0.8],
        [
          { frame: 1, webtransportMs: 0.2 },
          { frame: 2, webtransportMs: 0.8 },
        ],
        "subject",
      ).p95Ms,
    ).toBe(1.6);
    expect(
      summarizeCombinedNetworkingCpu([0.2, 0.8], [{ frame: 1, webtransportMs: 0.8 }], "subject")
        .p95Ms,
    ).toBe(1.6);
    const delayedNative = parseNetworkingCpuSamples(
      'TN_HOST_GAP:{"frames":1,"samples":[{"frame":1,"webtransportMs":5}]}',
      "subject",
    );
    expect(summarizeCombinedNetworkingCpu([0.1], delayedNative, "subject").p95Ms).toBe(5.1);
    expect(summarizeCombinedNetworkingCpu([0.1], delayedNative, "subject").p95Ms).toBeGreaterThan(
      1,
    );
  });
});
