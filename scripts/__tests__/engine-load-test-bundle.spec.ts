import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeCampaignReport } from "../engine-load-test/bundle.js";
import { buildDraftPlan } from "../engine-load-test/plan.js";

describe("campaign bundle writer", () => {
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  it("renders a partial bundle and verifies the output manifest", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tn-campaign-"));
    try {
      await writeFile(path.join(dir, "plan.json"), `${JSON.stringify(buildDraftPlan())}\n`);
      const result = await writeCampaignReport(dir);
      expect(result).toEqual({ partial: true, runs: 0 });
      const html = await readFile(path.join(dir, "report.html"));
      expect(html.toString()).toContain("PARTIAL — required measured evidence");
      expect(html.toString()).toContain(
        "Missing publication metadata: sources.lock.json, machine.json",
      );
      const manifest = await readFile(path.join(dir, "checksums.sha256"), "utf8");
      const digest = createHash("sha256").update(html).digest("hex");
      expect(manifest).toContain(`${digest}  report.html\n`);
      const second = await writeCampaignReport(dir);
      expect(second).toEqual(result);
      expect(await readFile(path.join(dir, "checksums.sha256"), "utf8")).toBe(manifest);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a symlinked plan that escapes the bundle", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tn-campaign-"));
    const outside = await mkdtemp(path.join(tmpdir(), "tn-outside-"));
    try {
      await writeFile(path.join(outside, "plan.json"), `${JSON.stringify(buildDraftPlan())}\n`);
      await symlink(path.join(outside, "plan.json"), path.join(dir, "plan.json"));
      await expect(writeCampaignReport(dir)).rejects.toThrow(/escapes root/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("checks source and machine locks before clearing publication metadata gaps", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tn-campaign-"));
    try {
      const plan = buildDraftPlan();
      await writeFile(path.join(dir, "plan.json"), `${JSON.stringify(plan)}\n`);
      const lockedCells = Object.fromEntries(
        plan.cells.map((cell) => [
          cell.id,
          Object.fromEntries(
            cell.arms.map((id) => [
              id,
              {
                sourceHash: "a".repeat(64),
                buildHash: "b".repeat(64),
                dependencyLockSha256: "c".repeat(64),
                patchSha256: null,
                version: "1.0.0",
                backend: "vulkan",
                compiler: "clang 20",
                buildFlags: "release",
              },
            ]),
          ),
        ]),
      );
      const source = {
        schemaVersion: 1,
        bevyCommit: "c6f634ca9f406d68ba5109d921247b654cb42c10",
        godotBenchmarkCommit: "b059e38a81230a87293828bbf65ab247b6b2d2a8",
        threenativeCommit: "d".repeat(40),
        threePackageSha256: "e".repeat(64),
        godotEngineBinarySha256: "f".repeat(64),
        foxAssetSha256: "0".repeat(64),
        foxAssetLicense: "CC0 model, CC-BY-4.0 rigging",
        foxAssetAttribution: "PixelMannen; @tomkranis",
        cells: lockedCells,
      };
      const machine = {
        schemaVersion: 1,
        date: "2026-09-25",
        id: "test-machine",
        os: "linux",
        cpu: "test CPU",
        gpu: "test GPU",
        driver: "test driver",
        lane: "physical-hardware",
      };
      const sourceBytes = `${JSON.stringify(source)}\n`;
      const machineBytes = `${JSON.stringify(machine)}\n`;
      await writeFile(path.join(dir, "sources.lock.json"), sourceBytes);
      await writeFile(path.join(dir, "machine.json"), machineBytes);
      expect(await writeCampaignReport(dir)).toEqual({ partial: true, runs: 0 });
      const html = await readFile(path.join(dir, "report.html"), "utf8");
      expect(html).not.toContain("Missing publication metadata:");
      expect(html).toContain("machine: test-machine; OS: linux; CPU: test CPU; GPU: test GPU");
      expect(html).toContain("driver: test driver");
      const manifest = await readFile(path.join(dir, "checksums.sha256"), "utf8");
      expect(manifest).toContain(`${hash(sourceBytes)}  sources.lock.json\n`);
      expect(manifest).toContain(`${hash(machineBytes)}  machine.json\n`);
      machine.date = "2026-02-30";
      await writeFile(path.join(dir, "machine.json"), `${JSON.stringify(machine)}\n`);
      await expect(writeCampaignReport(dir)).rejects.toThrow(/machine.json.date/u);
      await writeFile(path.join(dir, "machine.json"), machineBytes);
      const other = plan.cells.find(
        (cell) => cell.id !== plan.cells[0]?.id && cell.arms.includes("tn-desktop"),
      );
      if (other === undefined) throw new Error("missing second TN cell");
      const otherLock = lockedCells[other.id]?.["tn-desktop"];
      if (otherLock === undefined) throw new Error("missing second TN lock");
      otherLock.buildHash = "1".repeat(64);
      await writeFile(path.join(dir, "sources.lock.json"), `${JSON.stringify(source)}\n`);
      expect(await writeCampaignReport(dir)).toEqual({ partial: true, runs: 0 });
      delete lockedCells[plan.cells[0]?.id ?? "missing"];
      await writeFile(path.join(dir, "sources.lock.json"), `${JSON.stringify(source)}\n`);
      await expect(writeCampaignReport(dir)).rejects.toThrow(/sources.lock.json.cells/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("verifies every referenced raw artifact before deriving any result", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tn-campaign-"));
    try {
      const plan = buildDraftPlan();
      const cell = plan.cells[0];
      if (cell === undefined) throw new Error("missing test cell");
      await mkdir(path.join(dir, "runs"));
      await mkdir(path.join(dir, "raw"));
      await writeFile(path.join(dir, "plan.json"), `${JSON.stringify(plan)}\n`);
      const raw = `${JSON.stringify({
        schemaVersion: 1,
        unit: "ms",
        boundaries: [
          { frameId: 0, monotonicMs: 100 },
          { frameId: 1, monotonicMs: 110 },
          { frameId: 2, monotonicMs: 120 },
        ],
        finalCompletionMs: 120,
      })}\n`;
      await writeFile(path.join(dir, "raw", "frames.json"), raw);
      await writeFile(path.join(dir, "raw", "conformance.json"), '{"pass":true}\n');
      const run = {
        arm: {
          backend: "vulkan",
          build: { hash: "a".repeat(64), type: "release" },
          engine: "threenative",
          flags: {},
          id: "tn-desktop",
          version: "0.1.0",
        },
        block: 1,
        campaignHash: "a".repeat(64),
        campaignId: "test-campaign",
        checksums: {
          "raw/frames.json": hash(raw),
          "raw/conformance.json": hash('{"pass":true}\n'),
        },
        comparability: "matched-task",
        comparabilityReason: null,
        derivationVersion: "derive-1",
        durationMs: { measure: 20, startup: 1, warmup: 1 },
        experiment: cell.experiment,
        fixture: { conformance: "pass", evidence: "raw/conformance.json", hash: "b".repeat(64) },
        machine: {
          gpu: "gpu",
          id: "machine",
          lane: "physical-hardware",
          os: "linux",
          preflight: { passed: true, reason: null },
        },
        metrics: [{ name: "completed-work-mean-ms", reason: null, unit: "ms", value: 10 }],
        order: 0,
        outcome: { reason: null, runStatus: "valid" },
        planHash: "a".repeat(64),
        runId: "run-1",
        schemaVersion: 2,
        session: 1,
        sourceHash: "a".repeat(64),
        timing: {
          definition: "completed work",
          measuredFrames: 2,
          rawSeries: "raw/frames.json",
          rawSeriesReason: null,
          warmupFrames: 1,
        },
      };
      await writeFile(path.join(dir, "runs", "run-1.json"), `${JSON.stringify(run)}\n`);
      expect(await writeCampaignReport(dir)).toEqual({ partial: true, runs: 1 });
      const primary = run.metrics[0];
      if (primary === undefined) throw new Error("missing primary metric");
      primary.value = 20;
      await writeFile(path.join(dir, "runs", "run-1.json"), `${JSON.stringify(run)}\n`);
      await expect(writeCampaignReport(dir)).rejects.toThrow(/completed-work mean mismatch/u);
      primary.value = 10;
      await writeFile(path.join(dir, "runs", "run-1.json"), `${JSON.stringify(run)}\n`);
      await writeFile(path.join(dir, "raw", "frames.json"), "[1,1]\n");
      await expect(writeCampaignReport(dir)).rejects.toThrow(/checksum mismatch/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("regenerates a paired result and all published bytes from retained inputs", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tn-campaign-"));
    try {
      const cell = buildDraftPlan().cells[0];
      if (cell === undefined) throw new Error("missing test cell");
      const plan = { status: "draft", bootstrapSeed: 449, cells: [cell] };
      const planBytes = `${JSON.stringify(plan)}\n`;
      await mkdir(path.join(dir, "runs"));
      await mkdir(path.join(dir, "raw"));
      await writeFile(path.join(dir, "plan.json"), planBytes);
      const evidence = '{"pass":true}\n';
      await writeFile(path.join(dir, "raw", "conformance.json"), evidence);
      for (const { block, session } of cell.plannedBlocks) {
        for (const [order, armId] of ["tn-desktop", "bevy-desktop"].entries()) {
          const ms = order === 0 ? 10 : 20;
          const runId = `${armId}-${block}`;
          const rawRef = `raw/${runId}.json`;
          const raw = `${JSON.stringify({
            schemaVersion: 1,
            unit: "ms",
            boundaries: [
              { frameId: 0, monotonicMs: 100 },
              { frameId: 1, monotonicMs: 100 + ms },
              { frameId: 2, monotonicMs: 100 + 2 * ms },
            ],
            finalCompletionMs: 100 + 2 * ms,
          })}\n`;
          await writeFile(path.join(dir, rawRef), raw);
          await writeFile(
            path.join(dir, "runs", `${runId}.json`),
            `${JSON.stringify({
              arm: {
                backend: "vulkan",
                build: { hash: "a".repeat(64), type: "release" },
                engine: armId === "tn-desktop" ? "threenative" : "bevy",
                flags: {},
                id: armId,
                version: "1.0.0",
              },
              block,
              campaignHash: "b".repeat(64),
              campaignId: "paired-regeneration",
              checksums: { [rawRef]: hash(raw), "raw/conformance.json": hash(evidence) },
              comparability: "matched-task",
              comparabilityReason: null,
              derivationVersion: "derive-1",
              durationMs: { measure: 2 * ms, startup: 0, warmup: 1 },
              experiment: cell.experiment,
              fixture: {
                conformance: "pass",
                evidence: "raw/conformance.json",
                hash: "c".repeat(64),
              },
              machine: {
                gpu: "gpu",
                id: "machine",
                lane: "physical-hardware",
                os: "linux",
                preflight: { passed: true, reason: null },
              },
              metrics: [{ name: "completed-work-mean-ms", reason: null, unit: "ms", value: ms }],
              order,
              outcome: { reason: null, runStatus: "valid" },
              planHash: hash(planBytes),
              runId,
              schemaVersion: 2,
              session,
              sourceHash: "d".repeat(64),
              timing: {
                definition: "completed work",
                measuredFrames: 2,
                rawSeries: rawRef,
                rawSeriesReason: null,
                warmupFrames: 1,
              },
            })}\n`,
          );
        }
      }
      expect(await writeCampaignReport(dir)).toEqual({ partial: true, runs: 14 });
      const outputs = ["report.html", "results.json", "results.csv", "checksums.sha256"];
      const first = await Promise.all(outputs.map((name) => readFile(path.join(dir, name))));
      expect(first[0]?.toString()).toContain("2.00×");
      expect(
        JSON.parse((first[1] as Buffer).toString()).rows[0].comparisons[0].statistics.ratio,
      ).toBeCloseTo(2);
      expect(JSON.parse((first[1] as Buffer).toString()).rawTiming["tn-desktop-1"]).toMatchObject({
        frameCount: 2,
        histogram: [0, 0, 2, 0, 0, 0],
        hitchCount: 0,
        gpuSampleCount: 0,
        gpuMissingFrames: 2,
      });
      expect(first[0]?.toString()).toContain("Frame interval distribution");
      expect(first[0]?.toString()).toContain("Hitches &gt;2× median");
      expect(first[0]?.toString()).toContain("GPU timestamp samples");
      expect(first[0]?.toString()).toContain("p50 10.00 · p95 10.00 · p99 10.00 ms");
      await writeFile(path.join(dir, "report.html"), "stale generated output");
      expect(await writeCampaignReport(dir)).toEqual({ partial: true, runs: 14 });
      const second = await Promise.all(outputs.map((name) => readFile(path.join(dir, name))));
      for (const [index, bytes] of first.entries()) expect(second[index]).toEqual(bytes);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
