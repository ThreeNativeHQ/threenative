import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type IGitState,
  type IMonitorData,
  parsePrdProgress,
  readAttempts,
  readIterations,
  renderProgressHtml,
  safeArtifactHref,
} from "../engine-load-test/monitor.js";

import type { ICampaignRunRecord } from "../engine-load-test/campaign-report.js";
import type { IRunReport } from "../engine-load-test/report.js";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

function campaignRecord(overrides: Partial<ICampaignRunRecord> = {}): Record<string, unknown> {
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
    derivationVersion: 1,
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
    schemaVersion: 2,
    session: "session-2",
    sourceSha256: DIGEST_B,
    status: "valid",
    timingDefinition: "completed-work mean over 6000 rendered frames, drained once at the boundary",
    ...overrides,
  };
}

const PRD = `**Status:** PARTIAL — two boxes landed

## 9. Verification strategy

- [ ] a box outside any phase section is not a phase box

### Phase 1: Freeze sources

- [x] landed box
- [ ] open box

### Phase 2: Measure

- [x] another landed box
`;

const HOSTILE = `<img src=x onerror="alert('x')"> & </script>`;

const MIXED_HEADINGS = `**Status:** mixed heading levels

### 3.1 Optimization classes

- [ ] prose box before any phase is not a phase box

### Phase 1: Freeze sources

- [x] landed box
- [ ] open box

### 6.1 Canonical fixture contract

- [x] subsection box still belongs to the phase it sits in

### Phase 2: Measure

- [x] another landed box
`;

function gitState(overrides: Partial<IGitState> = {}): IGitState {
  return {
    base: "1111111",
    baseError: null,
    branch: "feat/prd-449",
    commits: [],
    head: "2222222",
    worktree: "prd-449-cross-engine-benchmarks",
    ...overrides,
  };
}

function data(overrides: Partial<IMonitorData> = {}): IMonitorData {
  const { phases, status } = parsePrdProgress(PRD);
  return {
    attempts: [],
    attemptsRoot: "artifacts/engine-load-test/prd-449",
    generatedAt: "2026-09-27T10:00:00.000Z",
    git: gitState(),
    prd: {
      done: phases.reduce((sum, phase) => sum + phase.done, 0),
      file: "docs/PRDs/performance/benchmarking/PRD-449-cross-engine-benchmarks-and-html-report.md",
      missing: null,
      phases,
      status,
      total: phases.reduce((sum, phase) => sum + phase.total, 0),
    },
    ...overrides,
  };
}

async function campaignDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "tn-monitor-"));
}

describe("PRD-449 campaign progress monitor", () => {
  it("counts only phase boxes and says pending for an empty campaign", () => {
    const html = renderProgressHtml(data());
    expect(html).toContain("2/3");
    expect(html).not.toContain("1/4");
    // Two pending tables: iterations and retained attempts. The PRD's own boxes are not pending.
    expect(html.match(/pending — nothing recorded yet/g)).toHaveLength(2);
    expect(html).toContain("PARTIAL — two boxes landed");
    // Nothing measured is invented for a campaign that has kept nothing yet.
    expect(html).toContain("No qualified iterations yet");
    expect(html).toContain("Latest qualified candidate");
    expect(html).toContain("Δ original baseline");
    expect(html).toContain("No qualified run");
    expect(html).not.toContain("0.0%");
    expect(html).not.toContain("<polyline");
    // Offline self-refresh, no network: a meta refresh, and the manual button still there.
    expect(html).toContain('<meta http-equiv="refresh" content="15">');
    expect(html).toContain("location.reload()");
  });

  it("counts a `###` subsection as no row and no stolen box", () => {
    const { phases, status } = parsePrdProgress(MIXED_HEADINGS);
    expect(phases).toEqual([
      { done: 2, name: "Phase 1: Freeze sources", total: 3 },
      { done: 1, name: "Phase 2: Measure", total: 1 },
    ]);
    expect(status).toBe("mixed heading levels");

    const html = renderProgressHtml(
      data({
        prd: {
          done: 3,
          file: "docs/PRDs/performance/benchmarking/PRD-449-cross-engine-benchmarks-and-html-report.md",
          missing: null,
          phases,
          status,
          total: 4,
        },
      }),
    );
    expect(html).toContain("2/3");
    expect(html).not.toContain("3.1 Optimization classes");
    expect(html).not.toContain("6.1 Canonical fixture contract");
  });

  it("lists every kept attempt in chronological order, invalid and unreadable included", async () => {
    const root = await campaignDir();
    const runs = path.join(root, "runs");
    await mkdir(path.join(runs, "block-2"), { recursive: true });
    await writeFile(
      path.join(runs, "block-2", "run.json"),
      JSON.stringify({ recordedAt: "2026-09-02T09:00:00Z", runStatus: "invalid" }),
    );
    await writeFile(
      path.join(runs, "aaa-early.json"),
      JSON.stringify({
        recordedAt: "2026-09-01T09:00:00Z",
        rungs: [{ frameMs: [12.3], p95: 9.9 }],
      }),
    );
    await writeFile(path.join(runs, "zzz-truncated.json"), "{ truncated");
    // Frozen Godot source and compatibility records live beside `runs/`; they are inputs, not
    // attempts, so an attempt table that lists them is reporting a benchmark nobody ran.
    await mkdir(path.join(root, "godot-benchmarks", "src"), { recursive: true });
    await writeFile(
      path.join(root, "godot-benchmarks", "src", "extension_api.json"),
      JSON.stringify({ recordedAt: "2026-09-03T09:00:00Z", rungs: [] }),
    );

    const attempts = await readAttempts(root);
    expect(attempts.map((attempt) => attempt.status)).toEqual([
      "recorded",
      "invalid",
      "unreadable",
    ]);
    expect(attempts[1]?.timeSource).toBe("record");
    // Sources are relative to the campaign root, where progress.html is written.
    expect(attempts.map((attempt) => attempt.source)).toEqual([
      "runs/aaa-early.json",
      "runs/block-2/run.json",
      "runs/zzz-truncated.json",
    ]);

    const html = renderProgressHtml(
      data({
        attempts,
        attemptsRoot: root,
        git: gitState({
          // Same day, and sha order is the opposite of git --reverse order: sorting by date then
          // sha would show "second landed" first.
          commits: [
            { date: "2026-09-01", sha: "bb22cc3", subject: "first landed" },
            { date: "2026-09-01", sha: "aa11bb2", subject: "second landed" },
          ],
        }),
      }),
    );
    expect(html.indexOf("runs/aaa-early.json")).toBeLessThan(html.indexOf("runs/block-2/run.json"));
    expect(html.indexOf("runs/block-2/run.json")).toBeLessThan(
      html.indexOf("runs/zzz-truncated.json"),
    );
    expect(html).not.toContain("extension_api.json");
    expect(html).toContain('href="runs/aaa-early.json"');
    expect(html).toContain('href="runs/block-2/run.json"');
    expect(html).toContain("invalid");
    expect(html.indexOf("bb22cc3")).toBeLessThan(html.indexOf("aa11bb2"));
    // A run's own numbers stay in that run's file; the page reports only its status and path.
    expect(html).not.toMatch(/frameMs|p95|12\.3|9\.9/);
  });

  it("escapes untrusted text and links only paths inside the campaign root", async () => {
    const root = await campaignDir();
    const hostileName = "<img src=x onerror=alert(1)>.json";
    await mkdir(path.join(root, "runs"), { recursive: true });
    await writeFile(path.join(root, "runs", hostileName), JSON.stringify({ runStatus: HOSTILE }));
    const attempts = await readAttempts(root);

    const html = renderProgressHtml(
      data({
        attempts,
        attemptsRoot: root,
        git: gitState({ commits: [{ date: "2026-09-01", sha: "aaaaaaa", subject: HOSTILE }] }),
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("</script>");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;/script&gt;");
    // An in-root file is linked with a percent-encoded relative href, never raw markup.
    expect(html).toContain(`href="runs/${encodeURIComponent(hostileName)}"`);

    expect(safeArtifactHref(root, path.join(root, "runs", "run.json"))).toBe("runs/run.json");
    expect(safeArtifactHref(root, path.join(root, "runs", "block-1", "run.json"))).toBe(
      "runs/block-1/run.json",
    );
    expect(safeArtifactHref(root, path.join(root, "..", "escape.json"))).toBeNull();
    expect(safeArtifactHref(root, path.join(root, "https:", "evil.json"))).toBeNull();
    expect(safeArtifactHref(root, root)).toBeNull();
  });
});

describe("performance iteration evidence", () => {
  it("renders real iteration trends only for matching, retained, checksummed hardware runs", async () => {
    const root = await campaignDir();
    await mkdir(path.join(root, "runs"));
    await mkdir(path.join(root, "iterations"));
    const raw = "[10,8,6]";
    await writeFile(path.join(root, "samples.json"), raw);
    const checksum = createHash("sha256").update(raw).digest("hex");
    for (const [id, value] of [
      ["baseline", 10],
      ["incumbent", 8],
      ["candidate", 6],
    ] as const) {
      await writeFile(
        path.join(root, "runs", `${id}.json`),
        JSON.stringify(
          campaignRecord({
            runId: id,
            rawSeries: [{ metric: "frameMs", path: "samples.json", sampleCount: 3 }],
            checksums: { "samples.json": checksum },
            metrics: { completedWorkMeanMsPerFrame: { unit: "ms/frame", value } },
          }),
        ),
      );
    }
    const iteration = {
      id: "iteration-1",
      sequence: 1,
      baselineRunId: "baseline",
      incumbentRunId: "incumbent",
      candidateRunId: "candidate",
      hypothesis: "Reduce dispatch",
      bottleneck: "Submission",
      nextHypothesis: "Measure batching",
      decision: "keep",
    };
    await writeFile(path.join(root, "iterations", "one.json"), JSON.stringify(iteration));
    const collected = {
      attempts: await readAttempts(root),
      attemptsRoot: root,
      ...(await readIterations(root)),
    };
    const html = renderProgressHtml(data(collected));
    expect(html).toContain("<polyline");
    expect(html).toContain("6.000 ms/frame");
    expect(html).toContain(">6.000</strong>");
    expect(html).toContain(">-40.0%</strong>");
    expect(html).toContain(">-25.0%</strong>");
    expect(html).toContain("-40.0% / -25.0%");
    expect(html).toContain('href="runs/candidate.json"');
    expect(html).toContain("Measure batching");
    expect(renderProgressHtml(data({ ...collected, iterations: [] }))).not.toContain("<polyline");
    const candidate = collected.attempts.find((attempt) => attempt.run?.runId === "candidate");
    if (!candidate?.run) throw new Error("Missing candidate fixture");
    const originalRun = candidate.run;
    candidate.run = {
      ...originalRun,
      experiment: { ...originalRun.experiment, load: "different-load" },
    };
    expect(renderProgressHtml(data(collected))).not.toContain("<polyline");
    candidate.run = originalRun;
    expect(
      renderProgressHtml(
        data({ ...collected, iterations: [{ ...iteration, decision: "invalid" }] }),
      ),
    ).not.toContain("<polyline");
    candidate.run = { ...candidate.run, machine: { ...candidate.run.machine, gpu: "SwiftShader" } };
    expect(renderProgressHtml(data(collected))).toContain("No qualified iterations yet");
    expect(renderProgressHtml(data(collected))).not.toContain("-40.0%");
    await writeFile(path.join(root, "samples.json"), "changed");
    const corrupted = await readAttempts(root);
    expect(corrupted.every((attempt) => attempt.evidenceError?.includes("checksum"))).toBe(true);
    expect(renderProgressHtml(data({ ...collected, attempts: corrupted }))).not.toContain(
      "<polyline",
    );
  });

  it("reports malformed iteration records without fabricating a timeline", async () => {
    const root = await campaignDir();
    await mkdir(path.join(root, "iterations"));
    await writeFile(path.join(root, "iterations", "broken.json"), "{}");
    const result = await readIterations(root);
    expect(result.iterations).toEqual([]);
    expect(result.iterationErrors[0]).toContain("Missing id");
  });
});

it("plots exploratory pilot samples and distinguishes observed, zero, null and absent means", () => {
  const pilot: IRunReport = {
    arm: "tn-web",
    build: { type: "release", notes: "vite production build" },
    device: { battery: null, label: "desktop" },
    display: { height: 1080, width: 1920, refreshHz: 60, vsync: false },
    driver: { adapter: "nvidia / turing", renderer: "three/webgpu WebGPURenderer" },
    engine: { name: "threenative", version: "0.9.0" },
    rungs: [
      {
        mode: "L1",
        objectCount: 1024,
        repeat: 1,
        frameMs: [2, 4, 3, 5],
        drawCalls: 1,
        triangles: 12288,
        visibleObjects: 1024,
        positionHash: "fixture",
      },
    ],
  };
  const attempt = {
    kind: "attempt" as const,
    status: "recorded",
    time: "2026-09-27T10:00:00Z",
    timeSource: "filesystem" as const,
    source: "pilots/hardware.json",
    pilot,
  };
  const html = renderProgressHtml(data({ pilots: [attempt] }));
  expect(html).toContain("Latest hardware pilot frame trace");
  expect(html).toContain("4 samples · p50 3.000 ms · p95 5.000 ms");
  const points = html
    .match(/<polyline points="([^"]+)"/)?.[1]
    ?.split(" ")
    .map((point) => point.split(",").map(Number));
  expect(points).toHaveLength(4);
  expect(points?.map((point) => point[0])).toEqual([
    55, 251.66666666666666, 448.3333333333333, 645,
  ]);
  expect(points?.[0]?.[1]).toBeCloseTo(127.2727);
  expect(points?.[3]?.[1]).toBeCloseTo(48.1818);
  expect(html).toContain('href="pilots/hardware.json"');
  expect(html).toContain("not completed-work or iteration improvement");
  expect(html).toContain("No qualified iterations yet");
  expect(html).toContain("No qualified run");
  const rung = pilot.rungs[0];
  if (!rung) throw new Error("Missing pilot rung fixture");
  const withObservation = (value: number | null): string =>
    renderProgressHtml(
      data({
        pilots: [
          {
            ...attempt,
            pilot: {
              ...pilot,
              rungs: [
                {
                  ...rung,
                  completedWorkMeanMs: value,
                  completedWorkReason: value === null ? "GPU drain unavailable <unsafe>" : null,
                  cpuSubmitMeanMs: 0,
                  measuredFrames: 4,
                  drainPolicy: "drain after final frame",
                },
              ],
            },
          },
        ],
      }),
    );
  const measured = withObservation(18.125);
  expect(measured).toContain("18.125 ms/frame");
  expect(measured).toContain("0.000 ms/frame");
  expect(measured).toContain("Exploratory, cadence-inclusive browser delivery");
  expect(measured).toContain("Measured frames</span><strong>4</strong>");
  expect(measured).toContain("Drain policy: drain after final frame");
  expect(measured).toContain("No qualified run");
  const unavailable = withObservation(null);
  expect(unavailable).toContain("Completed-work mean</span><strong>—</strong>");
  expect(unavailable).toContain("Unavailable: GPU drain unavailable &lt;unsafe&gt;");
  expect(unavailable).not.toContain("18.125 ms/frame");
  expect(html).toContain("Not recorded");

  expect(
    renderProgressHtml(
      data({
        pilots: [
          { ...attempt, pilot: { ...pilot, build: { ...pilot.build, notes: "vite dev build" } } },
        ],
      }),
    ),
  ).not.toContain("Latest hardware pilot frame trace");
  expect(
    renderProgressHtml(
      data({
        pilots: [
          {
            ...attempt,
            pilot: { ...pilot, driver: { ...pilot.driver, adapter: "google / swiftshader" } },
          },
        ],
      }),
    ),
  ).not.toContain("Latest hardware pilot frame trace");
});
