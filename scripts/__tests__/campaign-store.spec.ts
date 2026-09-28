import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CAMPAIGN_DERIVATION_VERSION,
  CAMPAIGN_SCHEMA_VERSION,
  type ICampaignRunRecord,
  parseCampaignRun,
} from "../engine-load-test/campaign-report.js";
import { storeCampaignRun } from "../engine-load-test/campaign-store.js";
import { readAttempts } from "../engine-load-test/monitor.js";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const RUN_ID = "prd-449-2026-09-27-a-b03-o02";
const FRAMES = "frameMs,frameIndex\n1.5,0\n2.5,1\n3.5,2\n";
const FRAMES_REF = `raw/${RUN_ID}-frameMs.csv`;
const LATENCY = "frameMs,frameIndex\n9.5,0\n10.5,1\n";
const LATENCY_REF = `raw/${RUN_ID}-gpuLatencyMs.csv`;

function campaignRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "tn-campaign-store-"));
}

function record(overrides: Partial<ICampaignRunRecord> = {}): ICampaignRunRecord {
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
    checksums: {},
    conformance: { evidencePath: "conformance/tn-native.json", reason: null, status: "passed" },
    derivationVersion: CAMPAIGN_DERIVATION_VERSION,
    durations: {
      measured: { unit: "ms", value: 3_000 },
      startup: { reason: "no startup profile in this run", unit: "ms", value: null },
      warmup: { unit: "ms", value: 1_000 },
    },
    experiment: {
      executionProtocol: "deterministic-throughput",
      fixtureRevision: "cubes@2",
      load: "L1",
      optimizationClass: "default",
      renderingProfile: "common-1920x1080",
      variant: "all-rotating",
      workload: "bevy-many-cubes",
    },
    fixtureSha256: DIGEST_A,
    machine: {
      cpu: "AMD Ryzen 9 7950X",
      gpu: "NVIDIA GeForce RTX 2080",
      operatingSystem: "Linux 6.11",
      preflight: { competingGpuWork: false, powerMode: "performance" },
    },
    metrics: {
      completedWorkMeanMsPerFrame: { unit: "ms/frame", value: 8.4 },
      frameP99Ms: { reason: "no per-frame intervals recorded", unit: "ms", value: null },
    },
    order: 2,
    planSha256: DIGEST_A,
    rawSeries: [{ metric: "frameMs", path: FRAMES_REF, sampleCount: 3 }],
    reason: null,
    runId: RUN_ID,
    schemaVersion: CAMPAIGN_SCHEMA_VERSION,
    session: "session-2",
    sourceSha256: DIGEST_B,
    status: "valid",
    timingDefinition: "completed-work mean over 3 rendered frames, drained once at the boundary",
    ...overrides,
  };
}

describe("immutable campaign run store", () => {
  it("should retain a parser-valid run plus its raw series where the monitor reads them", async () => {
    const root = await campaignRoot();

    const stored = await storeCampaignRun({
      campaignRoot: root,
      rawSeries: { [FRAMES_REF]: FRAMES },
      record: record(),
    });

    expect(stored.runPath).toBe(path.join(root, "runs", `${RUN_ID}.json`));
    expect(stored.rawPaths).toEqual([path.join(root, FRAMES_REF)]);
    expect(await readFile(stored.rawPaths[0] as string, "utf8")).toBe(FRAMES);
    const published = parseCampaignRun(
      JSON.parse(await readFile(stored.runPath, "utf8")) as unknown,
    );
    expect(published.runId).toBe(RUN_ID);
    expect(published.checksums[FRAMES_REF]).toBe(createHash("sha256").update(FRAMES).digest("hex"));
    // The monitor lists the attempt and re-hashes the samples itself: a store that wrote a record
    // its own reader cannot verify would show as an evidence error on the dashboard.
    const attempts = await readAttempts(root);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.run?.runId).toBe(RUN_ID);
    expect(attempts[0]?.evidenceError).toBeUndefined();
  });

  it("should refuse a repeated run id and leave the retained bytes unchanged", async () => {
    const root = await campaignRoot();
    const first = await storeCampaignRun({
      campaignRoot: root,
      rawSeries: { [FRAMES_REF]: FRAMES },
      record: record(),
    });
    const before = {
      raw: await readFile(first.rawPaths[0] as string, "utf8"),
      run: await readFile(first.runPath, "utf8"),
    };

    await expect(
      storeCampaignRun({
        campaignRoot: root,
        rawSeries: { [FRAMES_REF]: `${FRAMES}4.5,3\n` },
        record: record(),
      }),
    ).rejects.toThrow(/TN_BENCH_OUTPUT_EXISTS/u);

    expect(await readFile(first.rawPaths[0] as string, "utf8")).toBe(before.raw);
    expect(await readFile(first.runPath, "utf8")).toBe(before.run);
  });

  it("should refuse a taken run id before writing unrelated raw bytes", async () => {
    const root = await campaignRoot();
    const first = await storeCampaignRun({
      campaignRoot: root,
      rawSeries: { [FRAMES_REF]: FRAMES },
      record: record(),
    });
    const retainedRun = await readFile(first.runPath, "utf8");

    await expect(
      storeCampaignRun({
        campaignRoot: root,
        rawSeries: { [LATENCY_REF]: LATENCY },
        record: record({
          rawSeries: [{ metric: "gpuLatencyMs", path: LATENCY_REF, sampleCount: 2 }],
        }),
      }),
    ).rejects.toThrow(/TN_BENCH_OUTPUT_EXISTS/u);

    expect(await readdir(path.join(root, "raw"))).toEqual([`${RUN_ID}-frameMs.csv`]);
    expect(await readFile(first.runPath, "utf8")).toBe(retainedRun);
    expect((await readAttempts(root))[0]?.evidenceError).toBeUndefined();
  });

  it("should refuse a raw directory symlink that escapes the campaign root", async () => {
    const root = await campaignRoot();
    const outside = await campaignRoot();
    await symlink(outside, path.join(root, "raw"), "dir");
    await expect(
      storeCampaignRun({
        campaignRoot: root,
        rawSeries: { [FRAMES_REF]: FRAMES },
        record: record(),
      }),
    ).rejects.toThrow(/TN_BENCH_UNSAFE_ARTIFACT_REF/u);
    expect(await readdir(outside)).toEqual([]);
  });

  it("should refuse an artifact reference that leaves the campaign root", async () => {
    const root = await campaignRoot();

    for (const ref of [
      "../escape.csv",
      "/tmp/escape.csv",
      `samples/${RUN_ID}-frameMs.csv`,
      `raw/${RUN_ID}-frameMs.json`,
    ])
      await expect(
        storeCampaignRun({
          campaignRoot: root,
          rawSeries: { [ref]: FRAMES },
          record: record({ rawSeries: [{ metric: "frameMs", path: ref, sampleCount: 3 }] }),
        }),
      ).rejects.toThrow(
        new RegExp(`TN_BENCH_UNSAFE_ARTIFACT_REF.*${ref.replaceAll(".", "\\.")}`, "u"),
      );

    expect(await readdir(root)).toEqual([]);
  });

  it("should refuse bytes that do not match the checksum the record claims", async () => {
    const root = await campaignRoot();

    await expect(
      storeCampaignRun({
        campaignRoot: root,
        rawSeries: { [FRAMES_REF]: FRAMES },
        record: record({ checksums: { [FRAMES_REF]: DIGEST_A } }),
      }),
    ).rejects.toThrow(/TN_BENCH_BAD_SHAPE/u);
    await expect(
      storeCampaignRun({
        campaignRoot: root,
        rawSeries: { "raw/unnamed.csv": FRAMES },
        record: record(),
      }),
    ).rejects.toThrow(/TN_BENCH_BAD_SHAPE/u);
    await expect(
      storeCampaignRun({
        campaignRoot: root,
        rawSeries: { [FRAMES_REF]: "" },
        record: record(),
      }),
    ).rejects.toThrow(/TN_BENCH_BAD_SHAPE/u);

    expect(await readdir(root)).toEqual([]);
  });

  it("should refuse a record the v2 reader refuses and publish no valid record", async () => {
    const root = await campaignRoot();

    await expect(
      storeCampaignRun({
        campaignRoot: root,
        rawSeries: { [FRAMES_REF]: FRAMES },
        // A valid run whose primary metric was never observed is a measurement claim with nothing
        // behind it, so the store must not publish it as one.
        record: record({
          metrics: {
            completedWorkMeanMsPerFrame: {
              reason: "frame meter never read",
              unit: "ms/frame",
              value: null,
            },
          },
        }),
      }),
    ).rejects.toThrow(/TN_BENCH_BAD_SHAPE/u);

    expect(await readdir(root)).toEqual([]);
  });
});
