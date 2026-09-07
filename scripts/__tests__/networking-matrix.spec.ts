import { describe, expect, it } from "vitest";

import { makeTempDir } from "../../test-support/temp-dir.js";

const {
  aggregateMatrix,
  assertFiniteMetrics,
  assertNonEmptyObservations,
  formatSummary,
  main,
  parseCli,
  validateManifest,
  validateResultRow,
  verifyNetworkingMatrix,
} = await import(
  // @ts-expect-error The executable JavaScript module is the row's runtime boundary; its behavior is tested here.
  "../verify-networking-matrix.mjs"
);

const HASH_CLIENT = "a".repeat(64);
const HASH_NATIVE = "b".repeat(64);
const HASH_SERVER = "c".repeat(64);
const TEST_COMMIT = "commit-1234567890abcdef";

function sampleManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    prd: 359,
    commit: TEST_COMMIT,
    clientBundleHash: HASH_CLIENT,
    protocolVersion: 1,
    lanes: [
      {
        laneId: "desktop-linux-x64",
        platform: "desktop",
        status: "required",
        requiredProfiles: ["clean-lan"],
        osMinimum: null,
        nativeBinaryHash: HASH_NATIVE,
        serverBinaryHash: HASH_SERVER,
      },
    ],
    ...overrides,
  };
}

function sampleResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    prd: 359,
    laneId: "desktop-linux-x64",
    profile: "clean-lan",
    commit: TEST_COMMIT,
    clientBundleHash: HASH_CLIENT,
    nativeBinaryHash: HASH_NATIVE,
    serverBinaryHash: HASH_SERVER,
    protocolVersion: 1,
    status: "passed",
    assertionCount: 15,
    observations: {
      subject: { sessionId: "sub-1", peerId: "peer-1", authenticated: true },
      partner: { sessionId: "part-1", peerId: "peer-2", authenticated: true },
    },
    metrics: {
      latencyMs: 12.5,
      cpuMs: 0.2,
      submetrics: {
        p95Ms: 15.0,
      },
    },
    versions: { node: "20.18.0", platform: "linux", protocol: 1 },
    startedAt: "2026-09-06T12:00:00.000Z",
    finishedAt: "2026-09-06T12:01:00.000Z",
    subjectSessionId: "sub-1",
    partnerSessionId: "part-1",
    serverObservedPlayerIds: ["player-1", "player-2"],
    artifacts: [{ kind: "stdout.log", sha256: HASH_CLIENT }],
    ...overrides,
  };
}

describe("networking matrix verification", () => {
  it("rejects missing required lane", () => {
    const manifest = sampleManifest({
      lanes: [
        {
          laneId: "desktop-linux-x64",
          platform: "desktop",
          status: "required",
          requiredProfiles: ["clean-lan", "impaired"],
          nativeBinaryHash: HASH_NATIVE,
          serverBinaryHash: HASH_SERVER,
        },
      ],
    });
    const results = [sampleResult({ profile: "clean-lan" })];

    expect(() => aggregateMatrix(manifest, results)).toThrow(/missing required lane.*impaired/iu);
  });

  it("rejects wrong commit", () => {
    const manifest = sampleManifest({ commit: "expected-commit-hash" });
    const results = [sampleResult({ commit: "different-commit-hash" })];

    expect(() => aggregateMatrix(manifest, results)).toThrow(
      /commit .* does not match manifest commit/iu,
    );
  });

  it("rejects empty observations", () => {
    const resultEmptyArray = sampleResult({ observations: [] });
    const resultEmptyObject = sampleResult({ observations: {} });

    expect(() => validateResultRow(resultEmptyArray)).toThrow(/empty observations/iu);
    expect(() => validateResultRow(resultEmptyObject)).toThrow(/empty observations/iu);
  });

  it("rejects Android deferral", () => {
    const manifest = sampleManifest({
      lanes: [
        {
          laneId: "android-native-arm64-device",
          platform: "android",
          status: "owner-deferred",
          requiredProfiles: ["clean-lan"],
          nativeBinaryHash: HASH_NATIVE,
          serverBinaryHash: HASH_SERVER,
        },
      ],
    });

    expect(() => validateManifest(manifest)).toThrow(
      /cannot be deferred: only iOS lanes may be owner-deferred/iu,
    );
  });

  it("reports iOS deferred without passing it", () => {
    const manifest = sampleManifest({
      lanes: [
        {
          laneId: "desktop-linux-x64",
          platform: "desktop",
          status: "required",
          requiredProfiles: ["clean-lan"],
          nativeBinaryHash: HASH_NATIVE,
          serverBinaryHash: HASH_SERVER,
        },
        {
          laneId: "ios-native-arm64-device",
          platform: "ios",
          status: "owner-deferred",
          requiredProfiles: ["clean-lan"],
          nativeBinaryHash: null,
          serverBinaryHash: null,
        },
      ],
    });

    const results = [sampleResult({ laneId: "desktop-linux-x64", profile: "clean-lan" })];
    const summary = aggregateMatrix(manifest, results);

    expect(summary.verdict).toBe("passed");
    expect(summary.passedRequired).toBe(1);
    expect(summary.totalRequired).toBe(1);
    expect(summary.deferredCount).toBe(1);
    expect(summary.deferred).toEqual([
      {
        laneId: "ios-native-arm64-device",
        platform: "ios",
        status: "owner-deferred",
        reason: "owner-deferred",
      },
    ]);
    // iOS deferred lane is explicitly not in passedRows
    expect(
      summary.passedRows.some(
        (row: Record<string, unknown>) => row.laneId === "ios-native-arm64-device",
      ),
    ).toBe(false);

    const formatted = formatSummary(summary);
    expect(formatted).toMatch(/Verdict: PASSED/u);
    expect(formatted).toMatch(/ios-native-arm64-device \(ios\) \[owner-deferred\]/u);
  });

  it("rejects duplicate (laneId, profile) pairs", () => {
    const manifest = sampleManifest();
    const results = [
      sampleResult({ laneId: "desktop-linux-x64", profile: "clean-lan" }),
      sampleResult({ laneId: "desktop-linux-x64", profile: "clean-lan" }),
    ];

    expect(() => aggregateMatrix(manifest, results)).toThrow(
      /duplicate result for lane 'desktop-linux-x64' and profile 'clean-lan'/u,
    );
  });

  it("rejects non-finite metric values", () => {
    const resultNan = sampleResult({
      metrics: { latency: Number.NaN },
    });
    const resultInf = sampleResult({
      metrics: { nested: { p99: Number.POSITIVE_INFINITY } },
    });

    expect(() => validateResultRow(resultNan)).toThrow(/non-finite metric/iu);
    expect(() => validateResultRow(resultInf)).toThrow(/non-finite metric/iu);
  });

  it("rejects zero assertionCount", () => {
    const resultZero = sampleResult({ assertionCount: 0 });
    expect(() => validateResultRow(resultZero)).toThrow(
      /assertionCount must be a positive integer/iu,
    );
  });

  it("rejects mismatched protocol versions across rows", () => {
    const manifest = sampleManifest({
      protocolVersion: null,
      lanes: [
        {
          laneId: "desktop-linux-x64",
          platform: "desktop",
          status: "required",
          requiredProfiles: ["clean-lan", "impaired"],
          nativeBinaryHash: HASH_NATIVE,
          serverBinaryHash: HASH_SERVER,
        },
      ],
    });
    const results = [
      sampleResult({ profile: "clean-lan", protocolVersion: 1 }),
      sampleResult({ profile: "impaired", protocolVersion: 2 }),
    ];

    expect(() => aggregateMatrix(manifest, results)).toThrow(
      /protocol version mismatch across results/iu,
    );
  });

  it("rejects unrecorded expected hash in manifest for required lane", () => {
    const manifest = sampleManifest({
      lanes: [
        {
          laneId: "desktop-linux-x64",
          platform: "desktop",
          status: "required",
          requiredProfiles: ["clean-lan"],
          nativeBinaryHash: null,
          serverBinaryHash: HASH_SERVER,
        },
      ],
    });
    const results = [sampleResult()];

    expect(() => aggregateMatrix(manifest, results)).toThrow(
      /nativeBinaryHash expected hash is not yet recorded in manifest/iu,
    );
  });

  it("rejects binary hash mismatch against manifest", () => {
    const manifest = sampleManifest({
      lanes: [
        {
          laneId: "desktop-linux-x64",
          platform: "desktop",
          status: "required",
          requiredProfiles: ["clean-lan"],
          nativeBinaryHash: HASH_NATIVE,
          serverBinaryHash: HASH_SERVER,
        },
      ],
    });
    const results = [
      sampleResult({
        serverBinaryHash: "d".repeat(64),
      }),
    ];

    expect(() => aggregateMatrix(manifest, results)).toThrow(/serverBinaryHash mismatch/iu);
  });

  it("loads and validates real qualification-lanes.json without mutation", async () => {
    const { readFile } = await import("node:fs/promises");
    const manifestPath = "docs/PRDs/networking/qualification-lanes.json";
    const raw = JSON.parse(await readFile(manifestPath, "utf8"));
    const validated = validateManifest(raw);

    expect(validated.schemaVersion).toBe(1);
    expect(validated.prd).toBe(359);
    expect(validated.commit).toBeNull();
    expect(validated.lanes.length).toBeGreaterThan(10);

    // Every iOS lane is owner-deferred; every non-iOS lane is required
    for (const lane of validated.lanes) {
      const isIos =
        lane.platform === "ios" ||
        lane.laneId.toLowerCase().startsWith("ios") ||
        lane.laneId.toLowerCase().includes("-ios");
      if (isIos) {
        expect(lane.status).toBe("owner-deferred");
      } else {
        expect(lane.status).toBe("required");
      }
    }
  });

  it("reports unqualified without evidence instead of claiming a pass", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const testDir = await makeTempDir("net-matrix-empty-");
    {
      const manifestPath = join(testDir, "manifest.json");
      await writeFile(manifestPath, JSON.stringify(sampleManifest(), null, 2));
      const resultsDir = join(testDir, "results");
      await mkdir(resultsDir);

      // An ordinary CI run cannot execute the qualification lanes, so no evidence is the
      // normal case. It must not fail, and it must not claim anything either.
      const summary = await verifyNetworkingMatrix({ manifestPath, resultsDir });
      expect(summary.verdict).toBe("unqualified");
      expect(summary.passedRequired).toBe(0);
      expect(formatSummary(summary)).toMatch(/no lane evidence/iu);
      expect(formatSummary(summary)).toMatch(/Verdict: UNQUALIFIED/u);
      expect(formatSummary(summary)).not.toMatch(/Verdict: PASSED/u);
      expect(await main(["--manifest", manifestPath, "--results", resultsDir])).toBe(0);

      // The release path must refuse the same empty run.
      expect(
        await main(["--manifest", manifestPath, "--results", resultsDir, "--require-evidence"]),
      ).toBe(1);
    }
  });

  it("enforces every required row as soon as any evidence exists", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const testDir = await makeTempDir("net-matrix-partial-");
    {
      const manifest = sampleManifest({
        lanes: [
          {
            laneId: "desktop-linux-x64",
            platform: "desktop",
            status: "required",
            requiredProfiles: ["clean-lan"],
            nativeBinaryHash: HASH_NATIVE,
            serverBinaryHash: HASH_SERVER,
          },
          {
            laneId: "desktop-windows-x64",
            platform: "desktop",
            status: "required",
            requiredProfiles: ["clean-lan"],
            nativeBinaryHash: HASH_NATIVE,
            serverBinaryHash: HASH_SERVER,
          },
        ],
      });
      const manifestPath = join(testDir, "manifest.json");
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      const resultsDir = join(testDir, "results");
      await mkdir(resultsDir);
      // One lane reported. Partial evidence is the dangerous case: it must not pass.
      await writeFile(
        join(resultsDir, "desktop-linux-x64.json"),
        JSON.stringify(sampleResult(), null, 2),
      );

      await expect(verifyNetworkingMatrix({ manifestPath, resultsDir })).rejects.toThrow(
        /missing required lane/iu,
      );
      expect(await main(["--manifest", manifestPath, "--results", resultsDir])).toBe(1);
    }
  });

  it("rejects a row that names no protocol version", () => {
    const manifest = sampleManifest();
    // extractProtocolVersion reads row.protocolVersion, versions.protocolVersion and
    // versions.protocol in turn; a row naming none used to skip the check entirely.
    const { protocolVersion: _omitted, ...row } = sampleResult({ versions: { node: "v20" } });
    expect(() => aggregateMatrix(manifest, [row])).toThrow(/names no protocol version/iu);
  });

  it("rejects a lane with no required profiles", () => {
    const manifest = sampleManifest({
      lanes: [
        {
          laneId: "desktop-linux-x64",
          platform: "desktop",
          status: "required",
          requiredProfiles: [],
          nativeBinaryHash: HASH_NATIVE,
          serverBinaryHash: HASH_SERVER,
        },
      ],
    });
    expect(() => validateManifest(manifest)).toThrow(/at least one required profile/iu);
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    expect(() => parseCli(["--manifest", "m", "--results", "r", "--force"])).toThrow(/--force/u);
  });

  it("executes verifyNetworkingMatrix against files on disk", async () => {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const testDir = await makeTempDir("net-matrix-test-");
    {
      const manifest = sampleManifest();
      const manifestPath = join(testDir, "manifest.json");
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      const resultsDir = join(testDir, "results");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(resultsDir);

      const resultPath = join(resultsDir, "desktop-linux-x64.json");
      await writeFile(resultPath, JSON.stringify(sampleResult(), null, 2));

      const summary = await verifyNetworkingMatrix({ manifestPath, resultsDir });
      expect(summary.verdict).toBe("passed");
      expect(summary.passedRequired).toBe(1);
    }
  });
});
