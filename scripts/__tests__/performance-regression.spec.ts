import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERFORMANCE_POLICY,
  type IPerformanceIdentity,
  type IPerformancePolicy,
  type IRegressionComparison,
  evaluatePairedComparison,
  parsePerformanceLaneManifest,
} from "../performance-regression/compare.js";

const POLICY: IPerformancePolicy = {
  ...DEFAULT_PERFORMANCE_POLICY,
  metrics: {
    frameP95Ms: { absoluteLimit: 1, relativeLimit: 0.1, unit: "ms" },
  },
  requiredMetrics: ["frameP95Ms"],
};

function identity(overrides: Partial<IPerformanceIdentity> = {}): IPerformanceIdentity {
  return {
    architecture: "x86_64",
    artifactHash: "candidate-artifact",
    browser: "none",
    device: "device-1",
    graphicsBackend: "vulkan",
    gpu: "gpu-1",
    instrumentationRevision: "instrumentation-1",
    jsRuntime: "v8",
    nativeBinaryHash: "native-binary-1",
    operatingSystem: "linux",
    presentMode: "immediate",
    resolution: "1280x720",
    sourceSha: "candidate-source",
    workloadHash: "workload-1",
    ...overrides,
  };
}

function run(
  value: number,
  overrides: {
    readonly reportHash?: string;
    readonly sourceSha?: string;
    readonly artifactHash?: string;
    readonly device?: string;
    readonly nativeBinaryHash?: string;
    readonly lane?: string;
    readonly metrics?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  return {
    identity: identity({
      artifactHash: overrides.artifactHash ?? "candidate-artifact",
      device: overrides.device ?? "device-1",
      nativeBinaryHash: overrides.nativeBinaryHash ?? "native-binary-1",
      sourceSha: overrides.sourceSha ?? "candidate-source",
    }),
    lane: overrides.lane ?? "native-linux",
    metrics: overrides.metrics ?? { frameP95Ms: { samples: [value], unit: "ms" } },
    reportHash: overrides.reportHash ?? `report-${value}`,
    workload: "platformer-production",
  };
}

function pair(
  baselineValue: number,
  candidateValue: number,
  index: number,
  overrides: {
    readonly baseline?: Record<string, unknown>;
    readonly candidate?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  return {
    baseline:
      overrides.baseline ??
      run(baselineValue, {
        artifactHash: "baseline-artifact",
        reportHash: `baseline-report-${index}`,
        sourceSha: "baseline-source",
      }),
    candidate:
      overrides.candidate ??
      run(candidateValue, {
        artifactHash: "candidate-artifact",
        reportHash: `candidate-report-${index}`,
        sourceSha: "candidate-source",
      }),
    order: index % 2 === 0 ? "baseline-first" : "candidate-first",
  };
}

function comparison(
  candidateValue = 10.5,
  overrides: Record<string, unknown> = {},
): IRegressionComparison {
  return evaluatePairedComparison(
    {
      lane: "native-linux",
      pairs: [0, 1, 2].map((index) => pair(10, candidateValue, index)),
      requiredMetrics: ["frameP95Ms"],
      workload: "platformer-production",
      ...overrides,
    },
    POLICY,
  );
}

describe("performance regression lane manifest", () => {
  it("declares every platform row with a producer, metric set, evidence class, and baseline state", () => {
    const manifest = parsePerformanceLaneManifest(
      JSON.parse(
        readFileSync(path.join(process.cwd(), "scripts/performance-regression/lanes.json"), "utf8"),
      ),
    );
    expect(manifest.policyRevision).toBe("prd-358-v1");
    expect([...new Set(manifest.lanes.map((lane) => lane.platform))]).toEqual([
      "browser-webgpu",
      "native-linux",
      "native-windows",
      "native-macos",
      "native-android",
      "native-ios",
    ]);
    for (const lane of manifest.lanes) {
      expect(lane.producer).not.toBe("");
      expect(lane.requiredMetrics.length).toBeGreaterThan(0);
      expect(lane.evidenceClass).not.toBe("");
      expect(lane.baseline.status).toBe("unavailable");
      expect(lane.baseline.reason).not.toBe("");
    }
  });

  it("rejects a manifest that drops a required platform row", () => {
    const raw = JSON.parse(
      readFileSync(path.join(process.cwd(), "scripts/performance-regression/lanes.json"), "utf8"),
    ) as { lanes: unknown[] };
    expect(() => parsePerformanceLaneManifest({ ...raw, lanes: raw.lanes.slice(0, -1) })).toThrow(
      /missing required platform lanes.*native-ios/u,
    );
  });

  it("does not allow policy promotion or required lanes before measured calibration", () => {
    const raw = JSON.parse(
      readFileSync(path.join(process.cwd(), "scripts/performance-regression/lanes.json"), "utf8"),
    ) as { lanes: Array<Record<string, unknown>>; promotionPolicy: Record<string, unknown> };
    expect(() =>
      parsePerformanceLaneManifest({
        ...raw,
        promotionPolicy: { ...raw.promotionPolicy, accuracyRuns: 19 },
      }),
    ).toThrow(/accuracyRuns must remain 20/u);
    expect(() =>
      parsePerformanceLaneManifest({
        ...raw,
        lanes: raw.lanes.map((lane, index) => (index === 0 ? { ...lane, required: true } : lane)),
      }),
    ).toThrow(/accepted calibration evidence/u);
    expect(() =>
      parsePerformanceLaneManifest({
        ...raw,
        lanes: raw.lanes.map((lane, index) => (index === 0 ? { ...lane, required: true } : lane)),
        promotionPolicy: { ...raw.promotionPolicy, calibrationStatus: "accepted" },
      }),
    ).toThrow(/accepted baselines/u);
  });
});

describe("paired performance regression policy", () => {
  it("passes equality and requires both the absolute and relative threshold", () => {
    expect(comparison(11).verdict).toBe("PASS");
    expect(comparison(10.5).verdict).toBe("PASS");
    expect(comparison(11.2).verdict).toBe("FAIL");
    expect(comparison(11.2).exitCode).toBe(1);
  });

  it("fails a deliberate +50 ms real-loop equivalent with the regression exit code", () => {
    const result = comparison(60);
    expect(result.verdict).toBe("FAIL");
    expect(result.exitCode).toBe(1);
    expect(result.metrics[0]?.pairBreaches).toBe(3);
  });

  it("keeps startup and memory thresholds independent and equality-safe", () => {
    const policy: IPerformancePolicy = {
      ...DEFAULT_PERFORMANCE_POLICY,
      requiredMetrics: ["startupP95Ms", "memoryHighWaterMiB"],
    };
    const metricRun = (
      metric: string,
      unit: string,
      samples: readonly number[],
      options: {
        readonly reportHash: string;
        readonly sourceSha: string;
        readonly artifactHash: string;
      },
    ): Record<string, unknown> =>
      run(10, {
        ...options,
        metrics: { [metric]: { samples, unit } },
      });
    const makeMetricPair = (
      index: number,
      startupCandidate: number,
      memoryCandidate: number,
    ): Record<string, unknown> => ({
      baseline: {
        ...metricRun("startupP95Ms", "ms", [1000, 1000, 1000, 1000, 1000], {
          artifactHash: "baseline-artifact",
          reportHash: `startup-baseline-${index}`,
          sourceSha: "baseline-source",
        }),
        metrics: {
          startupP95Ms: { samples: [1000, 1000, 1000, 1000, 1000], unit: "ms" },
          memoryHighWaterMiB: { samples: [100], unit: "MiB" },
        },
      },
      candidate: {
        ...metricRun(
          "startupP95Ms",
          "ms",
          [
            startupCandidate,
            startupCandidate,
            startupCandidate,
            startupCandidate,
            startupCandidate,
          ],
          {
            artifactHash: "candidate-artifact",
            reportHash: `startup-candidate-${index}`,
            sourceSha: "candidate-source",
          },
        ),
        metrics: {
          startupP95Ms: {
            samples: [
              startupCandidate,
              startupCandidate,
              startupCandidate,
              startupCandidate,
              startupCandidate,
            ],
            unit: "ms",
          },
          memoryHighWaterMiB: { samples: [memoryCandidate], unit: "MiB" },
        },
      },
      order: index % 2 === 0 ? "baseline-first" : "candidate-first",
    });
    const makeBaselinePair = (index: number): Record<string, unknown> => ({
      baseline: {
        ...metricRun("startupP95Ms", "ms", [1000, 1000, 1000, 1000, 1000], {
          artifactHash: "baseline-artifact",
          reportHash: `memory-baseline-${index}`,
          sourceSha: "baseline-source",
        }),
        metrics: {
          startupP95Ms: { samples: [1000, 1000, 1000, 1000, 1000], unit: "ms" },
          memoryHighWaterMiB: { samples: [100], unit: "MiB" },
        },
      },
      candidate: {
        ...metricRun("startupP95Ms", "ms", [1250, 1250, 1250, 1250, 1250], {
          artifactHash: "candidate-artifact",
          reportHash: `memory-candidate-${index}`,
          sourceSha: "candidate-source",
        }),
        metrics: {
          startupP95Ms: { samples: [1250, 1250, 1250, 1250, 1250], unit: "ms" },
          memoryHighWaterMiB: { samples: [116], unit: "MiB" },
        },
      },
      order: index % 2 === 0 ? "baseline-first" : "candidate-first",
    });
    const equality = evaluatePairedComparison(
      {
        lane: "native-linux",
        pairs: [0, 1, 2].map((index) => makeBaselinePair(index)),
        workload: "platformer-production",
      },
      policy,
    );
    expect(equality.verdict).toBe("PASS");
    expect(equality.metrics.map((metric) => metric.regression)).toEqual([false, false]);

    const startupOver = evaluatePairedComparison(
      {
        lane: "native-linux",
        pairs: [0, 1, 2].map((index) => makeMetricPair(index, 1251, 116)),
        workload: "platformer-production",
      },
      policy,
    );
    expect(startupOver.verdict).toBe("FAIL");
    expect(startupOver.metrics.find((metric) => metric.metric === "startupP95Ms")?.regression).toBe(
      true,
    );
  });

  it("requires two of three pair breaches in addition to the median breach", () => {
    const result = evaluatePairedComparison(
      {
        lane: "native-linux",
        pairs: [pair(10, 11.2, 0), pair(10, 11.2, 1), pair(10, 10.5, 2)],
        requiredMetrics: ["frameP95Ms"],
        workload: "platformer-production",
      },
      POLICY,
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.metrics[0]?.pairBreaches).toBe(2);
  });

  it("permits one retained invalid replacement but not two", () => {
    const result = comparison(10.5, {
      pairs: [
        pair(10, 10.5, 0),
        pair(10, 10.5, 1),
        pair(10, 10.5, 2),
        { valid: false, reason: "thermal state changed" },
      ],
    });
    expect(result.verdict).toBe("PASS");
    expect(result.invalidAttempts).toHaveLength(1);
    expect(
      comparison(10.5, {
        pairs: [
          pair(10, 10.5, 0),
          pair(10, 10.5, 1),
          { valid: false, reason: "thermal state changed" },
          { valid: false, reason: "presentation lost" },
        ],
      }).verdict,
    ).toBe("BLOCKED");
    expect(
      evaluatePairedComparison(
        {
          lane: "native-linux",
          pairs: [
            pair(10, 10.5, 0),
            pair(10, 10.5, 1),
            pair(10, 10.5, 2),
            { valid: false, reason: "thermal state changed" },
            { valid: false, reason: "presentation lost" },
          ],
          requiredMetrics: ["frameP95Ms"],
          workload: "platformer-production",
        },
        { ...POLICY, maxInvalidPairs: 2 },
      ).verdict,
    ).toBe("BLOCKED");
  });

  it("blocks missing metrics, unknown metrics, and unrelated devices", () => {
    expect(
      comparison(10.5, {
        requiredMetrics: ["startupP95Ms"],
      }).verdict,
    ).toBe("BLOCKED");
    expect(
      comparison(10.5, {
        requiredMetrics: ["madeUpMetric"],
      }).verdict,
    ).toBe("BLOCKED");
    const differentDevice = pair(10, 10.5, 0, {
      candidate: run(10.5, { device: "device-2", reportHash: "candidate-other-device" }),
    });
    expect(
      evaluatePairedComparison(
        {
          lane: "native-linux",
          pairs: [differentDevice, pair(10, 10.5, 1), pair(10, 10.5, 2)],
          requiredMetrics: ["frameP95Ms"],
          workload: "platformer-production",
        },
        POLICY,
      ).verdict,
    ).toBe("BLOCKED");
    expect(
      comparison(10.5, {
        pairs: [
          pair(10, 10.5, 0, {
            candidate: run(10.5, {
              metrics: { frameP95Ms: { samples: [10.5], unit: "seconds" } },
              reportHash: "candidate-wrong-unit",
            }),
          }),
          pair(10, 10.5, 1),
          pair(10, 10.5, 2),
        ],
      }).verdict,
    ).toBe("BLOCKED");
  });

  it("blocks reused report or artifact identities and candidate-only promotion", () => {
    expect(
      comparison(10.5, {
        pairs: [
          pair(10, 10.5, 0),
          pair(10, 10.5, 1, {
            baseline: run(10, {
              artifactHash: "baseline-artifact",
              reportHash: "baseline-report-0",
              sourceSha: "baseline-source",
            }),
          }),
          pair(10, 10.5, 2),
        ],
      }).verdict,
    ).toBe("BLOCKED");
    expect(
      comparison(10.5, {
        pairs: [
          pair(10, 10.5, 0, {
            candidate: run(10.5, {
              artifactHash: "baseline-artifact",
              reportHash: "candidate-same-artifact",
            }),
          }),
          pair(10, 10.5, 1),
          pair(10, 10.5, 2),
        ],
      }).verdict,
    ).toBe("BLOCKED");
    expect(
      evaluatePairedComparison(
        {
          lane: "native-linux",
          pairs: [{ order: "baseline-first" }],
          workload: "platformer-production",
        },
        POLICY,
      ).verdict,
    ).toBe("BLOCKED");
  });

  it("blocks hardware identity changes between valid pair attempts", () => {
    const changedDevice = pair(10, 10.5, 1, {
      baseline: run(10, {
        device: "device-2",
        reportHash: "baseline-device-2",
        artifactHash: "baseline-artifact",
        sourceSha: "baseline-source",
      }),
      candidate: run(10.5, {
        device: "device-2",
        reportHash: "candidate-device-2",
        artifactHash: "candidate-artifact",
        sourceSha: "candidate-source",
      }),
    });
    expect(
      comparison(10.5, {
        pairs: [pair(10, 10.5, 0), changedDevice, pair(10, 10.5, 2)],
      }).verdict,
    ).toBe("BLOCKED");
  });

  it("keeps independently built native binary hashes in each arm without blocking the pair", () => {
    const result = comparison(10.5, {
      pairs: [
        pair(10, 10.5, 0, {
          baseline: {
            ...run(10, {
              artifactHash: "baseline-artifact",
              nativeBinaryHash: "native-baseline-a",
              reportHash: "native-baseline-0",
              sourceSha: "baseline-source",
            }),
          },
          candidate: {
            ...run(10.5, {
              artifactHash: "candidate-artifact",
              nativeBinaryHash: "native-candidate-a",
              reportHash: "native-candidate-0",
              sourceSha: "candidate-source",
            }),
          },
        }),
        pair(10, 10.5, 1, {
          baseline: run(10, {
            artifactHash: "baseline-artifact",
            nativeBinaryHash: "native-baseline-a",
            reportHash: "native-baseline-1",
            sourceSha: "baseline-source",
          }),
          candidate: run(10.5, {
            artifactHash: "candidate-artifact",
            nativeBinaryHash: "native-candidate-a",
            reportHash: "native-candidate-1",
            sourceSha: "candidate-source",
          }),
        }),
        pair(10, 10.5, 2, {
          baseline: run(10, {
            artifactHash: "baseline-artifact",
            nativeBinaryHash: "native-baseline-a",
            reportHash: "native-baseline-2",
            sourceSha: "baseline-source",
          }),
          candidate: run(10.5, {
            artifactHash: "candidate-artifact",
            nativeBinaryHash: "native-candidate-a",
            reportHash: "native-candidate-2",
            sourceSha: "candidate-source",
          }),
        }),
      ],
    });
    expect(result.verdict).toBe("PASS");
    expect(result.pairs[0]).toMatchObject({
      baselineNativeBinaryHash: "native-baseline-a",
      candidateNativeBinaryHash: "native-candidate-a",
    });
  });

  it("rejects seven valid attempts instead of allowing retries to change the median", () => {
    const result = comparison(10.5, {
      pairs: [
        pair(10, 60, 0),
        pair(10, 60, 1),
        pair(10, 60, 2),
        pair(10, 10.5, 3),
        pair(10, 10.5, 4),
        pair(10, 10.5, 5),
        pair(10, 10.5, 6),
      ],
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.validPairs).toBe(7);
    expect(result.metrics).toEqual([]);
    expect(result.reasons.join(" ")).toMatch(/exactly three valid/u);
  });

  it("rejects a repeated initial order even when both order labels appear", () => {
    const result = comparison(10.5, {
      pairs: [
        pair(10, 10.5, 0),
        pair(10, 10.5, 1),
        { ...pair(10, 10.5, 2), order: "candidate-first" },
      ],
    });
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reasons.join(" ")).toMatch(/alternate/u);
  });

  it("requires every metric declared by the selected lane manifest", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(process.cwd(), "scripts/performance-regression/lanes.json"), "utf8"),
    );
    const browserPairs = [0, 1, 2].map((index) =>
      pair(10, 10.5, index, {
        baseline: run(10, {
          artifactHash: "baseline-artifact",
          lane: "browser-webgpu",
          reportHash: `browser-baseline-${index}`,
          sourceSha: "baseline-source",
        }),
        candidate: run(10.5, {
          artifactHash: "candidate-artifact",
          lane: "browser-webgpu",
          reportHash: `browser-candidate-${index}`,
          sourceSha: "candidate-source",
        }),
      }),
    );
    const result = evaluatePairedComparison(
      {
        lane: "browser-webgpu",
        laneManifest: manifest,
        pairs: browserPairs,
        requiredMetrics: ["frameP95Ms"],
        workload: "platformer-production",
      },
      POLICY,
    );
    expect(result.verdict).toBe("BLOCKED");
    expect(result.reasons.join(" ")).toMatch(/lane-required metrics.*drawCalls.*triangles/u);
  });

  it("allows same-source A/A calibration but labels it separately", () => {
    const aaPairs = [0, 1, 2].map((index) =>
      pair(10, 10.2, index, {
        baseline: run(10, {
          artifactHash: "same-artifact",
          reportHash: `aa-baseline-${index}`,
          sourceSha: "same-source",
        }),
        candidate: run(10.2, {
          artifactHash: "same-artifact",
          reportHash: `aa-candidate-${index}`,
          sourceSha: "same-source",
        }),
      }),
    );
    const result = evaluatePairedComparison(
      {
        calibration: true,
        lane: "native-linux",
        pairs: aaPairs,
        requiredMetrics: ["frameP95Ms"],
        workload: "platformer-production",
      },
      POLICY,
    );
    expect(result.verdict).toBe("PASS");
    expect(result.calibration).toBe(true);
  });

  it("evaluates an absolute candidate floor independently of paired delta", () => {
    const floorPolicy: IPerformancePolicy = {
      ...POLICY,
      metrics: {
        frameP95Ms: {
          absoluteLimit: 1,
          maximum: 102,
          relativeLimit: 0.1,
          unit: "ms",
        },
      },
    };
    const result = evaluatePairedComparison(
      {
        lane: "native-linux",
        pairs: [pair(100, 105, 0), pair(100, 105, 1), pair(100, 105, 2)],
        requiredMetrics: ["frameP95Ms"],
        workload: "platformer-production",
      },
      floorPolicy,
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.metrics[0]?.floorBreaches).toEqual([0, 1, 2]);
  });
});
