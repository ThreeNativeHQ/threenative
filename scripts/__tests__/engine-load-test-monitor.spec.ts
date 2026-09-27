import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type IGitState,
  type IMonitorData,
  parsePrdProgress,
  readAttempts,
  renderProgressHtml,
  safeArtifactHref,
} from "../engine-load-test/monitor.js";

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
    expect(html).not.toMatch(/fps|p50|p95|frameMs|ms\/frame/i);
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
