import { execFile } from "node:child_process";
// `pnpm bench:engines:monitor` — PRD-449 campaign progress monitor. It reads three already
// existing sources of truth (the PRD file, this branch's git history, the campaign's retained
// artifact files) and copies what they say into one offline page. It produces no new timing or
// verdict of its own: explicit iterations link retained evidence; measured deltas are descriptive.
// A run file that was overwritten is not recoverable from here.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  type ICampaignRunRecord,
  PRIMARY_CAMPAIGN_METRIC,
  parseCampaignRun,
} from "./campaign-report.js";

import {
  BenchError,
  type IRunReport,
  parseRunReport,
  requireNumber,
  requireObject,
  requireString,
  summarize,
} from "./report.js";

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PRD_FILE =
  "docs/PRDs/performance/benchmarking/PRD-449-cross-engine-benchmarks-and-html-report.md";
const ARTIFACT_SUBDIR = path.join("artifacts", "engine-load-test", "prd-449");
const RUNS_SUBDIR = "runs";
const PAGE_NAME = "progress.html";
const UNIT = "\x1f";
const RECORD_TIME_KEYS = ["recordedAt", "generatedAt", "timestamp", "startedAt"];
const PENDING = "pending — nothing recorded yet";
const WATCH_HINT =
  "watching; ctrl-c to stop. open the page over file:// — it re-reads itself every 15s, and the reload button still works.\n";

export interface IPrdPhase {
  done: number;
  name: string;
  total: number;
}

export interface IPrdProgress {
  done: number;
  file: string;
  missing: string | null;
  phases: IPrdPhase[];
  status: string;
  total: number;
}

export interface ICommit {
  date: string;
  sha: string;
  subject: string;
}

export interface IGitState {
  base: string;
  baseError: string | null;
  branch: string;
  commits: ICommit[];
  head: string;
  worktree: string;
}

export interface IAttempt {
  run?: ICampaignRunRecord;
  pilot?: IRunReport;
  godotBenchmarks?: IGodotBenchmark[];
  evidenceError?: string;
  kind: "attempt" | "record";
  source: string;
  status: string;
  time: string;
  timeSource: "filesystem" | "record";
}

/** One entry of a Godot upstream benchmark file. The suite reports its own render CPU/GPU split,
 *  which is a different timing definition from a ThreeNative completed-work frame, so it is kept
 *  as its own shape and never folded into a rung summary. */
export interface IGodotBenchmark {
  category: string;
  name: string;
  results: Record<string, number>;
}

export interface IIteration {
  id: string;
  sequence: number;
  baselineRunId: string;
  incumbentRunId: string;
  candidateRunId: string;
  hypothesis: string;
  bottleneck: string;
  nextHypothesis: string;
  decision: "keep" | "reject" | "invalid";
}

export interface IMonitorData {
  pilots?: IAttempt[];
  iterations?: IIteration[];
  iterationErrors?: string[];
  attempts: IAttempt[];
  attemptsRoot: string;
  generatedAt: string;
  git: IGitState;
  prd: IPrdProgress;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** A link is offered only for a real file inside the campaign's artifact root — no scheme, no
 *  `..`, no absolute path, no colon. Anything else renders as plain text. The href is relative to
 *  the artifact root, which is also where the page is written. */
export function safeArtifactHref(rootDir: string, absolutePath: string): string | null {
  const segments = path.relative(path.resolve(rootDir), path.resolve(absolutePath)).split(path.sep);
  if (segments.some((s) => s === "" || s === "." || s === ".." || s.includes(":"))) return null;
  return segments.map(encodeURIComponent).join("/");
}

/** Only `### Phase N: …` sections are phases. Any other `###` heading (`3.1 Optimization classes`)
 *  is prose: it is not a row, and it does not end the phase it sits in, so its boxes still count
 *  toward that phase. Boxes before the first phase (a checklist in a `##` section) are not counted. */
export function parsePrdProgress(markdown: string): { phases: IPrdPhase[]; status: string } {
  const status = markdown.match(/^\*\*Status:\*\*\s*(.+)$/m)?.[1]?.trim() ?? "(no Status line)";
  const phases: IPrdPhase[] = [];
  let current: IPrdPhase | null = null;
  for (const line of markdown.split("\n")) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading?.[1] !== undefined) {
      if (!/^Phase\s+\d+\s*:/i.test(heading[1])) continue;
      current = { done: 0, name: heading[1], total: 0 };
      phases.push(current);
      continue;
    }
    const box = /^\s*-\s+\[( |x|X)\]/.exec(line);
    if (box && current) {
      current.total += 1;
      if (box[1] !== " ") current.done += 1;
    }
  }
  return { phases, status };
}

function recordTime(row: Record<string, unknown>): string | null {
  for (const key of RECORD_TIME_KEYS) {
    const value = row[key];
    if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
      return new Date(value).toISOString();
    }
  }
  return null;
}

async function readAttempt(rootDir: string, absolutePath: string): Promise<IAttempt> {
  const attempt: IAttempt = {
    kind: "record",
    source: path.relative(rootDir, absolutePath),
    status: "unreadable",
    time: (await stat(absolutePath)).mtime.toISOString(),
    timeSource: "filesystem",
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(absolutePath, "utf8"));
  } catch {
    return attempt;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return attempt;
  const row = parsed as Record<string, unknown>;
  const time = recordTime(row);
  if (time !== null) {
    attempt.time = time;
    attempt.timeSource = "record";
  }
  const status =
    typeof row.runStatus === "string"
      ? row.runStatus
      : typeof row.status === "string"
        ? row.status
        : Array.isArray(row.rungs)
          ? "recorded"
          : "unrecorded";
  attempt.kind = status === "unrecorded" ? "record" : "attempt";
  attempt.status = status;
  if (row.schemaVersion !== undefined) {
    try {
      const run = parseCampaignRun(row);
      for (const series of run.rawSeries) {
        const full = await realpath(path.resolve(rootDir, series.path));
        if (safeArtifactHref(await realpath(rootDir), full) === null)
          throw new Error("Raw evidence leaves campaign root");
        const digest = createHash("sha256")
          .update(await readFile(full))
          .digest("hex");
        if (digest !== run.checksums[series.path])
          throw new Error("Raw evidence checksum mismatch");
      }
      attempt.run = run;
    } catch (error) {
      attempt.evidenceError = error instanceof Error ? error.message : String(error);
    }
  }
  if (Array.isArray(row.rungs) && row.schemaVersion === undefined) {
    try {
      attempt.pilot = parseRunReport(row);
    } catch {
      /* Legacy malformed records remain visible. */
    }
  }
  if (row.benchmarks !== undefined) {
    try {
      attempt.godotBenchmarks = parseGodotBenchmarks(row.benchmarks);
    } catch (error) {
      attempt.evidenceError = String(error);
    }
  }
  return attempt;
}

/** A Godot upstream benchmark file has no rungs and no frame samples: it carries the suite's own
 *  render CPU/GPU split. Malformed input throws so the file is named as evidence-unavailable rather
 *  than shown as an empty benchmark. */
function parseGodotBenchmarks(value: unknown): IGodotBenchmark[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new BenchError("TN_BENCH_BAD_SHAPE", "benchmarks must be a non-empty array");
  return value.map((entry, index) => {
    const row = requireObject(entry, `benchmarks[${index}]`);
    const raw = requireObject(row.results, `benchmarks[${index}].results`);
    const results: Record<string, number> = {};
    for (const [key, metric] of Object.entries(raw))
      results[key] = requireNumber(raw, key, `benchmarks[${index}].results`);
    return {
      category: requireString(row, "category", `benchmarks[${index}]`),
      name: requireString(row, "name", `benchmarks[${index}]`),
      results,
    };
  });
}

/** Every retained JSON file under the campaign's `runs/` subtree is listed, including malformed
 *  and failed ones — a deleted or overwritten attempt cannot be shown, and an unreadable one is
 *  named rather than dropped. Only `runs/` is scanned: the campaign root also holds frozen source
 *  trees and compatibility records, which are inputs, not attempts. `source` stays relative to
 *  the campaign root, where `progress.html` is written, so its links resolve. */
export async function readAttempts(rootDir: string, subdir = RUNS_SUBDIR): Promise<IAttempt[]> {
  const found: IAttempt[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".json")) {
        found.push(await readAttempt(rootDir, full));
      }
    }
  };
  const runsRoot = path.join(rootDir, subdir);
  try {
    if (!(await stat(runsRoot)).isDirectory()) return [];
  } catch {
    return [];
  }
  await walk(runsRoot);
  return [...found].sort(
    (a, b) => Date.parse(a.time) - Date.parse(b.time) || a.source.localeCompare(b.source),
  );
}

/** Iteration files link retained run IDs to an explicit code experiment; file order is never an iteration. */
export async function readIterations(
  rootDir: string,
): Promise<{ iterations: IIteration[]; iterationErrors: string[] }> {
  const iterations: IIteration[] = [];
  const iterationErrors: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(path.join(rootDir, "iterations"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") iterationErrors.push(String(error));
    return { iterations, iterationErrors };
  }
  for (const file of entries.filter((name) => name.endsWith(".json")).sort()) {
    try {
      const value = JSON.parse(await readFile(path.join(rootDir, "iterations", file), "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Expected iteration object");
      for (const key of [
        "id",
        "baselineRunId",
        "incumbentRunId",
        "candidateRunId",
        "hypothesis",
        "bottleneck",
        "nextHypothesis",
      ]) {
        if (typeof value[key] !== "string" || !value[key].trim()) throw new Error(`Missing ${key}`);
      }
      if (
        !Number.isSafeInteger(value.sequence) ||
        value.sequence < 1 ||
        !["keep", "reject", "invalid"].includes(value.decision)
      )
        throw new Error("Invalid sequence or decision");
      if (iterations.some((item) => item.id === value.id || item.sequence === value.sequence))
        throw new Error("Duplicate iteration identity or sequence");
      iterations.push(value as IIteration);
    } catch (error) {
      iterationErrors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { iterations: iterations.sort((a, b) => a.sequence - b.sequence), iterationErrors };
}

async function git(args: string[]): Promise<string> {
  return (await execFileAsync("git", args, { cwd: repoRoot })).stdout;
}

export async function readGitState(): Promise<IGitState> {
  const worktree = path.basename(repoRoot);
  const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const head = (await git(["rev-parse", "HEAD"])).trim();
  let base = "";
  try {
    base = (await git(["merge-base", "develop", "HEAD"])).trim();
  } catch {
    base = "";
  }
  const commits: ICommit[] = base
    ? (
        await git([
          "log",
          "--reverse",
          "--date=short",
          `--format=%H${UNIT}%ad${UNIT}%s`,
          `${base}..HEAD`,
        ])
      )
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => {
          const [sha = "", date = "", subject = ""] = line.split(UNIT);
          return { date, sha, subject };
        })
    : [];
  return {
    base,
    baseError: base ? null : "no merge-base with develop; iteration history unavailable",
    branch,
    commits,
    head,
    worktree,
  };
}

export async function collectMonitorData(): Promise<IMonitorData> {
  const prdPath = path.join(repoRoot, PRD_FILE);
  const attemptsRoot = path.join(repoRoot, ARTIFACT_SUBDIR);
  let prd: IPrdProgress;
  try {
    const { phases, status } = parsePrdProgress(await readFile(prdPath, "utf8"));
    prd = {
      done: phases.reduce((sum, phase) => sum + phase.done, 0),
      file: PRD_FILE,
      missing: null,
      phases,
      status,
      total: phases.reduce((sum, phase) => sum + phase.total, 0),
    };
  } catch (error) {
    prd = {
      done: 0,
      file: PRD_FILE,
      missing: error instanceof Error ? error.message : String(error),
      phases: [],
      status: PENDING,
      total: 0,
    };
  }
  return {
    ...(await readIterations(attemptsRoot)),
    attempts: await readAttempts(attemptsRoot),
    pilots: await readAttempts(attemptsRoot, "pilots"),
    attemptsRoot: path.relative(repoRoot, attemptsRoot),
    generatedAt: new Date().toISOString(),
    git: await readGitState(),
    prd,
  };
}

const STYLE = `
:root{color-scheme:dark;--bg:#101312;--panel:#191d1a;--line:#343b33;--muted:#a6b0a5;--ink:#f0f4e9;--accent:#d1ef86;--bad:#ffab9f}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 "Helvetica Neue",Helvetica,sans-serif}main{max-width:1440px;margin:auto;padding:38px 5vw}h1,h2,h3,p{margin:0}h1{font-size:clamp(30px,4vw,54px);font-weight:500;letter-spacing:-.055em;line-height:1.1}h2{font-size:22px;letter-spacing:-.025em;font-weight:500}h3{font-size:16px}a{color:var(--accent);text-underline-offset:4px}button{background:transparent;border:1px solid var(--line);color:var(--ink);border-radius:6px;padding:9px 15px;cursor:pointer}button:hover{border-color:var(--accent)}a:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:4px}.eyebrow,.label,th{font:11px/1.5 "DejaVu Sans Mono",monospace;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}.eyebrow{color:var(--accent);margin-bottom:16px}.topline,.section-head{display:flex;align-items:center;justify-content:space-between;gap:20px}.topline{margin-bottom:35px}.subtitle{color:var(--muted);margin-top:16px;max-width:720px}.live{font-size:12px;color:var(--muted)}.live:before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);margin-right:8px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);margin:34px 0 26px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--panel)}.kpi{padding:23px;border-right:1px solid var(--line)}.kpi:last-child{border:0}.kpi strong{display:block;font-size:42px;letter-spacing:-.05em;margin:9px 0 3px;line-height:1.1}.kpi.missing strong{color:var(--muted)}.kpi .small{display:block;max-width:340px}.coverage{margin:-10px 0 26px;color:var(--muted);font-size:12px}.pilot-table{min-width:760px}.pilot-table td:first-child{max-width:270px;overflow-wrap:anywhere}.compare-table{min-width:1040px}.compare-table td:first-child{max-width:300px;overflow-wrap:anywhere}.compare-table caption{text-align:left;padding:0 0 12px}.win-tn{color:var(--accent)}.win-godot{color:var(--bad)}.pill{display:inline-block;padding:3px 12px;border-radius:999px;font:600 12px/1.4 "DejaVu Sans Mono",monospace;letter-spacing:.06em;border:1px solid currentColor}.pill.win-tn{background:#d1ef8622}.pill.win-godot{background:#ffab9f22}details.methodology{margin-top:18px}.scoreboard-bars{width:100%;max-width:760px;height:auto;margin-top:22px}.scoreboard-bars text{font:11px "DejaVu Sans Mono",monospace;fill:var(--muted)}.scoreboard-bars .group{fill:var(--ink);font-size:12px}.trend .godot{stroke:#7fd1c4}.small,.note{font-size:12px;color:var(--muted)}.panel{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:25px;margin-bottom:24px}.section-head{margin-bottom:22px}.badge{display:inline-block;border:1px solid var(--line);border-radius:4px;padding:4px 9px;font:11px "DejaVu Sans Mono",monospace;color:var(--muted)}.empty-chart{height:245px;display:grid;place-content:center;text-align:center;border-bottom:1px solid var(--line);background:repeating-linear-gradient(to bottom,transparent,transparent 59px,#343b3366 60px);padding:20px}.empty-chart h3{font-size:24px;font-weight:400;margin-bottom:10px}.empty-chart p{color:var(--muted);max-width:530px}.chart-note{margin-top:14px;color:var(--muted);font-size:12px}.grid{align-items:start;display:grid;grid-template-columns:1.7fr 1fr;gap:24px}.grid>.panel{min-width:0}.state{border-left:2px solid var(--accent);padding-left:16px;margin:20px 0}.state p{margin-top:8px;overflow-wrap:anywhere}.state .label{color:var(--accent)}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:14px 12px;border-bottom:1px solid var(--line);vertical-align:top}th:first-child,td:first-child{padding-left:0}td{font-size:13px}code{font:12px "DejaVu Sans Mono",monospace;overflow-wrap:anywhere}.timeline{max-height:310px;overflow:auto;list-style:none;padding:0;margin:0}.timeline li{position:relative;margin-left:5px;padding:0 0 23px 22px;border-left:1px solid var(--line)}.timeline li:before{content:"";position:absolute;left:-4px;top:7px;width:7px;height:7px;border-radius:50%;background:var(--accent)}.timeline p{margin-top:4px;overflow-wrap:anywhere}.timeline time{color:var(--muted);font-size:12px}.timeline code{margin-right:8px}.phase{margin-top:18px}.phase-head{display:flex;justify-content:space-between;gap:20px;font-size:12px}progress{width:100%;height:6px;border:0;border-radius:8px;background:var(--line);accent-color:var(--accent)}progress::-webkit-progress-bar{background:var(--line);border-radius:8px}progress::-webkit-progress-value{background:var(--accent);border-radius:8px}.error{color:var(--bad);overflow-wrap:anywhere}.trend{border-top:1px solid var(--line);padding-top:20px;margin-top:20px}.trend svg{width:100%;height:auto;max-height:260px}.trend text{fill:var(--muted);font:12px monospace}.trend circle{fill:var(--accent)}.trend polyline{fill:none;stroke:var(--accent);stroke-width:2}.trend .baseline{stroke:#a6b0a5;stroke-dasharray:5 5}.trend .incumbent{stroke:#8dbdd5}.legend{display:flex;gap:20px;flex-wrap:wrap;font-size:12px;color:var(--muted)}details summary{cursor:pointer;font-size:14px}details p{margin:12px 0}footer{font-size:12px;color:var(--muted);margin-top:24px;overflow-wrap:anywhere}@media(max-width:850px){.grid{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,1fr)}.kpi:nth-child(2){border-right:0}.kpi:nth-child(-n+2){border-bottom:1px solid var(--line)}}@media(max-width:480px){main{padding:24px 18px}.panel{padding:18px}.topline{align-items:flex-start}.kpi strong{font-size:34px}.kpi{padding:18px}.section-head{align-items:flex-start}.live{max-width:140px}.badge{white-space:normal;overflow-wrap:anywhere;min-width:0;text-align:right}}
`;

function attemptLink(data: IMonitorData, attempt: IAttempt, label = attempt.source): string {
  const href = safeArtifactHref(data.attemptsRoot, path.join(data.attemptsRoot, attempt.source));
  return href === null
    ? escapeHtml(label)
    : `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

/** Build/source hashes may change between iterations. Experiment, environment and timing scope may not. */
function comparisonKey(run: ICampaignRunRecord): string {
  return JSON.stringify([
    run.campaignId,
    run.planSha256,
    run.fixtureSha256,
    Object.entries(run.experiment).sort(),
    run.arm.arm,
    run.arm.backend,
    run.arm.build,
    Object.entries(run.arm.flags).sort(),
    run.machine.cpu,
    run.machine.gpu,
    run.machine.operatingSystem,
    run.machine.preflight.powerMode,
    run.machine.preflight.competingGpuWork,
    run.timingDefinition,
    run.derivationVersion,
  ]);
}

function latestHardwarePilot(data: IMonitorData): IAttempt | undefined {
  return (data.pilots ?? [])
    .filter(
      (attempt) =>
        attempt.pilot &&
        /nvidia/i.test(attempt.pilot.driver.adapter) &&
        /vite production build/i.test(attempt.pilot.build.notes) &&
        !/swiftshader|llvmpipe|software/i.test(
          `${attempt.pilot.driver.adapter} ${attempt.pilot.driver.renderer}`,
        ),
    )
    .at(-1);
}

function kpi(label: string, value: string, note: string, missing = false): string {
  return `<div class="kpi${missing ? " missing" : ""}"><span class="label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><span class="small">${escapeHtml(note)}</span></div>`;
}
/** The measured pilot is the page's first section: one run's real numbers above its own per-frame
 *  line. The four cards are four different observations — completed-work mean, frame p95, CPU
 *  submit mean and frame count — never one substituted for another, and an absent measurement
 *  reads "—" with the reason beside it rather than a borrowed number. */
function renderPilotTrace(data: IMonitorData): string {
  const latest = latestHardwarePilot(data);
  if (!latest?.pilot) return "";
  const pilot = latest.pilot;
  const headline = pilot.rungs.at(-1);
  if (!headline) return "";
  const headlineSummary = summarize({ ...pilot, rungs: [headline] })[0];
  const completedWork = typeof headline.completedWorkMeanMs === "number";
  const submit = headline.cpuSubmitMeanMs !== undefined;
  const headlineNote =
    headline.completedWorkMeanMs === null
      ? `Unavailable: ${headline.completedWorkReason ?? "reason not recorded"}`
      : headline.completedWorkMeanMs === undefined
        ? "Not recorded"
        : "Cadence-inclusive browser delivery";
  const cards = `<section class="kpis" aria-label="Latest hardware pilot measured metrics">${kpi("Completed-work mean", completedWork ? `${headline.completedWorkMeanMs?.toFixed(3)} ms/frame` : "—", headlineNote, !completedWork)}${kpi("Frame interval p95", headlineSummary ? `${headlineSummary.p95.toFixed(3)} ms` : "—", "Render loop intervals, including rAF waits", !headlineSummary)}${kpi("CPU submit mean", submit ? `${headline.cpuSubmitMeanMs?.toFixed(3)} ms/frame` : "—", submit ? "CPU submit only" : "Not recorded", !submit)}${kpi("Measured frames", String(headline.measuredFrames ?? headline.frameMs.length), "Frames the timed window covered")}</section>`;
  const traces = pilot.rungs
    .map((rung) => {
      const samples = rung.frameMs;
      const maximum = samples.reduce((peak, value) => Math.max(peak, value), 0.001) * 1.1;
      const points = samples
        .map(
          (value, index) =>
            `${55 + (index * 590) / Math.max(1, samples.length - 1)},${180 - (value / maximum) * 145}`,
        )
        .join(" ");
      const summary = summarize({ ...pilot, rungs: [rung] })[0];
      return `<div class="trend"><h3>${escapeHtml(rung.mode)} · ${rung.objectCount} objects · repeat ${rung.repeat}</h3><p class="small">${samples.length} samples · p50 ${summary?.p50.toFixed(3)} ms · p95 ${summary?.p95.toFixed(3)} ms</p><svg viewBox="0 0 700 250" width="700" height="250" role="img" aria-label="Render loop intervals in milliseconds for ${samples.length} samples of ${escapeHtml(rung.mode)} at ${rung.objectCount} objects; lower is faster"><text x="0" y="17">Frame interval, ms</text><text x="0" y="42">${maximum.toFixed(1)}</text><text x="25" y="115">${(maximum / 2).toFixed(1)}</text><text x="25" y="184">0</text><path d="M50 30V180H660" fill="none" stroke="#465040"/><polyline points="${points}"/><text x="55" y="205">1</text><text x="645" y="205" text-anchor="end">${samples.length}</text><text x="350" y="238" text-anchor="middle">Sample index · ${samples.length} frames · one run, one repeat</text></svg></div>`;
    })
    .join("");
  return `<section class="panel" aria-label="Latest hardware pilot frame trace"><div class="section-head"><h2>Latest hardware pilot frame trace</h2><span class="badge">Exploratory · one run · cadence-inclusive</span></div><p class="note">Exploratory browser delivery. The trace is render loop interval including rAF waits, not completed-work time or iteration improvement.</p><p class="small">${escapeHtml(pilot.driver.adapter)} · ${escapeHtml(pilot.build.notes)} · headline rung ${escapeHtml(headline.mode)} · ${headline.objectCount} objects · repeat ${headline.repeat}</p>${cards}<p class="coverage">Drain policy: ${escapeHtml(headline.drainPolicy ?? "Not recorded")} · Raw JSON: ${attemptLink(data, latest)} · selected by retained file time, not iteration order.</p>${traces}</section>`;
}

/** The scoreboard the owner reads first: one row per comparison, every cell computed from the raw
 *  pilot file that row names. Two L2 ThreeNative files exist and only the display-fix one is the
 *  corrected physical-display run, so each row names its files and a file that is not retained
 *  reads "missing" instead of borrowing a near neighbour. */
const SCOREBOARD_ROWS = [
  {
    godot: "pilots/godot-desktop-4096-visible-2026-09-27.json",
    godotMode: "L1",
    label: "Same scene, shipped defaults",
    note: "One mesh per cube; each engine's own default batching. Headline row.",
    tn: "pilots/tn-desktop-4096-l3-shipped-default-40warmup-2026-09-27.json",
    tnMode: "L3",
  },
  {
    godot: "pilots/godot-desktop-4096-l2-visible-2026-09-27.json",
    godotMode: "L2",
    label: "Explicit instancing (both)",
    note: "",
    tn: "pilots/tn-desktop-4096-l2-display-fix-2026-09-27.json",
    tnMode: "L2",
  },
  {
    godot: "pilots/godot-desktop-4096-visible-2026-09-27.json",
    godotMode: "L1",
    label: "TN auto-batching OFF (diagnostic)",
    note: "Shows TN's per-draw cost when it cannot batch.",
    tn: "pilots/tn-desktop-4096-physical-visible-2026-09-27.json",
    tnMode: "L1",
  },
] as const;

const GODOT_UPSTREAM_SOURCE = "pilots/godot-lights-meshes-box1000-upstream-2026-09-27.json";

interface IPhysicalPair {
  attempt: IAttempt;
  pilot: IRunReport;
  samples: number[];
  summary: NonNullable<ReturnType<typeof summarize>[number]>;
  rung: NonNullable<IRunReport["rungs"][number]>;
}

function physicalPilot(
  data: IMonitorData,
  source: string,
  mode: string,
): IPhysicalPair | undefined {
  const attempt = (data.pilots ?? []).find((item) => item.source === source && item.pilot);
  const pilot = attempt?.pilot;
  const rung = pilot?.rungs.find((item) => item.mode === mode && item.objectCount === 4096);
  if (!attempt?.pilot || !pilot || !rung) return undefined;
  return {
    attempt,
    pilot,
    rung,
    samples: rung.frameMs,
    summary: summarize({ ...pilot, rungs: [rung] })[0] as IPhysicalPair["summary"],
  };
}

const MISSING = "missing";

interface IScoreboardRow {
  godotPair?: IPhysicalPair;
  label: string;
  note: string;
  tnPair?: IPhysicalPair;
}

/** "NVIDIA GeForce RTX 2080 / 1.4.351" -> "RTX 2080": the board, without the vendor or the driver
 *  version. The full adapter string stays in the methodology block below. */
function gpuName(adapter: string | undefined): string {
  const board = adapter?.split(" / ")[0]?.trim();
  if (!board) return "GPU not recorded";
  return board.replace(/^(NVIDIA GeForce|AMD|Radeon|Intel)\s+/iu, "");
}

function ms(pair: IPhysicalPair | undefined): string {
  return pair ? `${pair.summary.p50.toFixed(2)} / ${pair.summary.p95.toFixed(2)} ms` : MISSING;
}

function draws(godot: IPhysicalPair | undefined, tn: IPhysicalPair | undefined): string {
  return godot && tn ? `${godot.rung.drawCalls} vs ${tn.rung.drawCalls}` : MISSING;
}

/** The two verdict cells the owner reads: who won this row and by how much, taken from the two
 *  files the row names. The winner follows p50, the slow-frame column p95 — when they disagree the
 *  cell says so rather than picking one silently. Speed is the slower p50 over the faster p50, so a
 *  row missing either side is "missing" in both cells, never a borrowed or invented number. */
function verdict(godot: IPhysicalPair | undefined, tn: IPhysicalPair | undefined): string {
  if (!godot || !tn) return `<td>${MISSING}</td><td>${MISSING}</td>`;
  const faster = (key: "p50" | "p95"): "ThreeNative" | "Godot" =>
    tn.summary[key] < godot.summary[key] ? "ThreeNative" : "Godot";
  const median = faster("p50");
  const slow = faster("p95");
  const winner =
    median === slow
      ? median
      : `TN on median, ${slow === "ThreeNative" ? "TN" : "Godot"} on slow frames (p95)`;
  const ratio =
    Math.max(godot.summary.p50, tn.summary.p50) / Math.min(godot.summary.p50, tn.summary.p50);
  const pill = `<span class="pill ${median === "ThreeNative" ? "win-tn" : "win-godot"}">${median === "ThreeNative" ? "TN" : "Godot"}</span>`;
  const split = median === slow ? "" : `<p class="small">${winner}</p>`;
  return `<td>${pill}${split}</td><td>${median} ${ratio.toFixed(1)}x faster</td>`;
}

/** Where the headline row's engine loses, per row, in the same files as the table. Empty when no
 *  retained row has Godot ahead, so the page never shows a loss list it has no losses for. */
function whereTnLoses(rows: IScoreboardRow[]): string {
  const items = rows.flatMap((row) => {
    const { godotPair: godot, tnPair: tn } = row;
    if (!godot || !tn) return [];
    const gaps = (["p50", "p95"] as const)
      .filter((key) => godot.summary[key] < tn.summary[key])
      .map((key) => `${(tn.summary[key] - godot.summary[key]).toFixed(2)} ms on ${key}`);
    return gaps.length === 0
      ? []
      : [`<li>${escapeHtml(row.label)}: Godot ahead by ${gaps.join(", ")}</li>`];
  });
  return items.length === 0 ? "" : `<h3>Where TN loses</h3><ul>${items.join("")}</ul>`;
}

/** Grouped median bars, one group per row, all three on one axis scaled to the slowest cell, so the
 *  3 ms headline row and the 30 ms diagnostic row are read against each other rather than apart. */
function scoreboardBars(rows: IScoreboardRow[]): string {
  const scale = Math.max(
    ...rows.flatMap((row) => [row.godotPair?.summary.p50 ?? 0, row.tnPair?.summary.p50 ?? 0]),
    0.001,
  );
  const bar = (pair: IPhysicalPair | undefined, label: string, y: number, fill: string): string =>
    pair === undefined
      ? `<text x="0" y="${y + 13}">${escapeHtml(label)}: ${MISSING}</text>`
      : `<text x="0" y="${y + 13}">${escapeHtml(label)}</text><rect x="52" y="${y}" width="${Math.max(1, (pair.summary.p50 / scale) * 430).toFixed(1)}" height="17" rx="3" fill="${fill}"></rect><text x="${(52 + (pair.summary.p50 / scale) * 430 + 6).toFixed(1)}" y="${y + 13}">${pair.summary.p50.toFixed(2)} ms</text>`;
  const groups = rows
    .map((row, index) => {
      const top = 34 + index * 86;
      return `<text class="group" x="0" y="${top - 8}">${escapeHtml(row.label)}</text>${bar(row.godotPair, "Godot", top, "#7fd1c4")}${bar(row.tnPair, "TN", top + 24, "var(--accent)")}`;
    })
    .join("");
  const reading = rows
    .map(
      (row) =>
        `${row.label}: Godot ${row.godotPair ? `${row.godotPair.summary.p50.toFixed(2)} ms` : MISSING}, TN ${row.tnPair ? `${row.tnPair.summary.p50.toFixed(2)} ms` : MISSING}`,
    )
    .join("; ");
  return `<svg class="scoreboard-bars" viewBox="0 0 700 ${34 + rows.length * 86}" role="img" aria-label="Median frame time in milliseconds, Godot against ThreeNative, per row: ${escapeHtml(reading)}; shorter is a lower recorded observation, not a qualified speedup">${groups}</svg>`;
}

function comparisonSeriesPoints(samples: number[], maximum: number, width: number): string {
  return samples
    .map(
      (value, index) =>
        `${55 + (index * 590) / Math.max(1, width - 1)},${180 - (value / maximum) * 145}`,
    )
    .join(" ");
}

/** The Godot upstream suite's own file: a render CPU/GPU split on its own workload, which is a
 *  different timing definition from a ThreeNative completed-work frame. Named, never paired. */
function renderGodotUpstream(data: IMonitorData): string {
  const attempt = (data.pilots ?? []).find((item) => item.source === GODOT_UPSTREAM_SOURCE);
  if (!attempt)
    return `<p class="note">Godot-only upstream pilot <code>${escapeHtml(path.basename(GODOT_UPSTREAM_SOURCE))}</code>: missing from retained artifacts, so no value is shown.</p>`;
  const entry = attempt.godotBenchmarks?.[0];
  if (!entry)
    return `<p class="note">Godot-only upstream pilot ${attemptLink(data, attempt)}: unsupported shape — no benchmark entries parsed, so no value is shown.</p>`;
  const cpu = entry.results.render_cpu;
  const gpu = entry.results.render_gpu;
  return `<p class="note">Godot-only upstream pilot · ${escapeHtml(entry.category)} · ${escapeHtml(entry.name)}: ${typeof cpu === "number" ? `render CPU ${cpu.toFixed(4)} ms` : `${MISSING} render CPU`} · ${typeof gpu === "number" ? `render GPU ${gpu.toFixed(4)} ms` : `${MISSING} render GPU`}. Not comparable to the ThreeNative completed-work frame time above: different workload, different timing definition, and its <code>time</code> field is the suite's own. No ThreeNative equivalent is retained for it — that half of the pair is pending. Raw JSON: ${attemptLink(data, attempt)}</p>`;
}

/** ThreeNative against Godot on the same display: the requested workload, each engine's own
 *  p50/p95, who won that row and by how much, and the file behind it. Exploratory, not qualified. */
function renderEngineComparison(data: IMonitorData): string {
  const e = escapeHtml;
  const rows: IScoreboardRow[] = SCOREBOARD_ROWS.map((row) => ({
    label: row.label,
    note: row.note,
    godotPair: physicalPilot(data, row.godot, row.godotMode),
    tnPair: physicalPilot(data, row.tn, row.tnMode),
  }));
  const retained = rows.find((row) => row.godotPair ?? row.tnPair);
  const head = retained?.godotPair ?? retained?.tnPair;
  const title = head
    ? `ThreeNative vs Godot — ${head.rung.objectCount.toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ",")} cubes, ${e(gpuName(head.pilot.driver.adapter))}, ${head.pilot.display.width}x${head.pilot.display.height}`
    : "ThreeNative vs Godot";
  const caveat =
    "Pilot numbers: one run per engine, 120 frames each; the seven-block repeated protocol is still pending, so treat gaps under ~10% as noise.";
  const table = rows
    .map(
      (row) =>
        `<tr><td><strong>${e(row.label)}</strong>${row.note ? `<p class="small">${e(row.note)}</p>` : ""}</td><td>${e(ms(row.godotPair))}</td><td>${e(ms(row.tnPair))}</td>${verdict(row.godotPair, row.tnPair)}<td>${e(draws(row.godotPair, row.tnPair))}</td><td>${row.godotPair ? `Godot ${attemptLink(data, row.godotPair.attempt, path.basename(row.godotPair.attempt.source))}` : "Godot file missing"}<p class="small">${row.tnPair ? `TN ${attemptLink(data, row.tnPair.attempt, path.basename(row.tnPair.attempt.source))}` : "TN file missing"}</p></td></tr>`,
    )
    .join("");
  const charts = rows
    .map((row) => {
      const series = (
        [
          { cls: "godot", label: "Godot", pair: row.godotPair },
          { cls: "tn", label: "ThreeNative", pair: row.tnPair },
        ] as { cls: string; label: string; pair: IPhysicalPair | undefined }[]
      ).filter(
        (item): item is { cls: string; label: string; pair: IPhysicalPair } =>
          item.pair !== undefined,
      );
      if (series.length === 0) return "";
      const width = Math.max(...series.map((item) => item.pair.samples.length));
      const maximum = Math.max(...series.flatMap((item) => item.pair.samples), 0.001) * 1.1;
      const lines = series
        .map(
          (item) =>
            `<polyline class="${item.cls}" points="${comparisonSeriesPoints(item.pair.samples, maximum, width)}"><title>${e(item.label)} ${e(row.label)}: p50 ${item.pair.summary.p50.toFixed(2)} ms, p95 ${item.pair.summary.p95.toFixed(2)} ms, ${item.pair.samples.length} samples</title></polyline>`,
        )
        .join("");
      const reading = series
        .map((item) => `${item.label} p50 ${item.pair.summary.p50.toFixed(2)} ms`)
        .join(", ");
      const godotVersion = row.godotPair?.pilot.engine.version;
      return `<div class="trend"><h3>${e(row.label)} · per-frame series</h3><p class="small">${e(reading)} · ${width} sample slots · zero-based axis scaled to this row only</p><svg viewBox="0 0 700 250" role="img" aria-label="Per-frame intervals in milliseconds for ${e(row.label)}: ${e(reading)}; exploratory observations only"><text x="0" y="17">ms ↓</text><text x="0" y="42">${maximum.toFixed(1)}</text><text x="25" y="115">${(maximum / 2).toFixed(1)}</text><text x="25" y="184">0</text><path d="M50 30V180H660" fill="none" stroke="#465040"/>${lines}<text x="55" y="205">1</text><text x="645" y="205" text-anchor="end">${width}</text><text x="350" y="238" text-anchor="middle">Sample index · one run per arm · not an improvement trend</text></svg><div class="legend"><span style="color:#7fd1c4">— Godot ${e(godotVersion ?? "version not recorded")}</span><span style="color:var(--accent)">— ThreeNative native host</span></div></div>`;
    })
    .join("");
  return `<section class="panel" aria-label="ThreeNative against Godot scoreboard"><div class="section-head"><h2>${title}</h2><span class="badge">Exploratory · one run per engine</span></div><p class="note">${e(caveat)}</p><div class="table-wrap" tabindex="0" role="region" aria-label="ThreeNative against Godot scoreboard; scroll horizontally for all columns"><table class="compare-table"><caption class="small">Median and 95th-percentile frame time in milliseconds, the winner by median, plus draw calls, per scene.</caption><thead><tr><th scope="col">Scene</th><th scope="col">Godot p50 / p95</th><th scope="col">ThreeNative p50 / p95</th><th scope="col">Winner</th><th scope="col">Speed</th><th scope="col">Draw calls · Godot vs TN</th><th scope="col">Raw JSON</th></tr></thead><tbody>${table}</tbody></table></div>${scoreboardBars(rows)}${whereTnLoses(rows)}<p class="chart-note">Median frame time per row, one axis. Godot teal, ThreeNative green.</p><details class="methodology"><summary>Methodology and caveats</summary><p class="note">Unqualified observations, not engine rankings. L1 has a known output/draw mismatch; L2 uses different visible-count semantics. Full fixture conformance and paired blocks are missing for these rows.</p><p class="note">Same display, matching legacy first-eight placement hash, full fixture equivalence unverified. Every row is exploratory: one run per engine, no repeated pair, no qualified iteration. Modes are distinct requested workloads; Winner follows p50 and Speed is the slower p50 over the faster p50 of the two files each row names, so both are read off retained samples only and do not establish relative engine performance.</p><p class="note">Warmup frames are not recorded in these JSON files — the L3 file's name says 40, its content records no warmup field — so the retained 120 samples per file are all this page claims. The Godot suite's <code>time</code> field and its CPU/GPU split are its own definitions.</p><p class="note">Adapters as recorded: Godot ${e(rows.find((row) => row.godotPair)?.godotPair?.pilot.driver.adapter ?? MISSING)} · TN ${e(rows.find((row) => row.tnPair)?.tnPair?.pilot.driver.adapter ?? MISSING)}.</p>${renderGodotUpstream(data)}</details>${charts}</section>`;
}

export function renderProgressHtml(data: IMonitorData): string {
  const e = escapeHtml;
  const iterations = data.iterations ?? [];
  const valid = data.attempts.filter(
    (attempt) => attempt.run?.status === "valid" && !attempt.evidenceError,
  );
  const qualified = iterations.map((iteration) => {
    const runs = [iteration.baselineRunId, iteration.incumbentRunId, iteration.candidateRunId].map(
      (id) => {
        const matches = valid.filter((attempt) => attempt.run?.runId === id);
        return matches.length === 1 ? matches[0] : undefined;
      },
    );
    const [baseline, incumbent, candidate] = runs;
    const comparable =
      baseline?.run &&
      incumbent?.run &&
      candidate?.run &&
      runs.every(
        (attempt) =>
          attempt?.run &&
          comparisonKey(attempt.run) === comparisonKey(baseline.run as ICampaignRunRecord) &&
          !/swiftshader|llvmpipe|software/i.test(
            `${attempt.run.arm.backend} ${attempt.run.machine.gpu}`,
          ),
      );
    return { iteration, runs, comparable: Boolean(comparable) && iteration.decision !== "invalid" };
  });
  const groups = new Map<string, typeof qualified>();
  for (const item of qualified.filter((item) => item.comparable)) {
    const baseline = item.runs[0]?.run as ICampaignRunRecord;
    const key = `${comparisonKey(baseline)}:${baseline.runId}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const charts = [...groups.values()]
    .map((items) => {
      const run = items[0]?.runs[0]?.run as ICampaignRunRecord;
      const metric = (attempt: IAttempt | undefined): number =>
        attempt?.run?.metrics[PRIMARY_CAMPAIGN_METRIC]?.value as number;
      const maximum = Math.max(...items.flatMap((item) => item.runs.map(metric)), 0.001) * 1.15;
      const x = (index: number): number => 55 + (index * 590) / Math.max(1, items.length - 1);
      const y = (value: number): number => 180 - (value / maximum) * 145;
      const lines = [0, 1, 2]
        .map(
          (series) =>
            `<polyline class="${["baseline", "incumbent", "candidate"][series]}" points="${items.map((item, index) => `${x(index)},${y(metric(item.runs[series]))}`).join(" ")}"/>`,
        )
        .join("");
      const referencePoints = [0, 1]
        .map((series) =>
          items
            .map(
              (item, index) =>
                `<circle style="fill:${series === 0 ? "#a6b0a5" : "#8dbdd5"}" cx="${x(index)}" cy="${y(metric(item.runs[series]))}" r="3"><title>${series === 0 ? "Baseline" : "Incumbent"}: ${metric(item.runs[series]).toFixed(3)} ms/frame</title></circle>`,
            )
            .join(""),
        )
        .join("");
      const points = items
        .map(
          (item, index) =>
            `<circle cx="${x(index)}" cy="${y(metric(item.runs[2]))}" r="4"><title>${e(item.iteration.id)}: ${metric(item.runs[2]).toFixed(3)} ms/frame</title></circle><text x="${x(index)}" y="205" text-anchor="middle">${item.iteration.sequence}</text>`,
        )
        .join("");
      return `<div class="trend"><h3>${e(run.experiment.workload)} · ${e(run.experiment.load)} · ${e(run.arm.arm)}</h3><p class="small">${e(run.experiment.variant)} / ${e(run.experiment.optimizationClass)} / ${e(run.experiment.renderingProfile)} / ${e(run.arm.backend)} / ${e(run.machine.gpu)}</p><svg viewBox="0 0 700 235" role="img" aria-label="Completed-work mean milliseconds per frame by explicit iteration sequence; lower is better"><text x="0" y="17">ms/frame ↓</text><text x="0" y="42">${maximum.toFixed(1)}</text><text x="25" y="184">0</text><path d="M50 30V180H660" fill="none" stroke="#465040"/>${lines}${referencePoints}${points}<text x="350" y="232" text-anchor="middle">Iteration sequence</text></svg><div class="legend"><span>┄ Original baseline</span><span style="color:#8dbdd5">— Incumbent</span><span style="color:var(--accent)">● Candidate</span></div></div>`;
    })
    .join("");
  const percent = (before: number, after: number): string =>
    before > 0 ? `${(((after - before) / before) * 100).toFixed(1)}%` : "n/a (zero baseline)";
  const latestQualified = qualified.filter((item) => item.comparable).at(-1);
  const latestValues = latestQualified?.runs.map(
    (attempt) => attempt?.run?.metrics[PRIMARY_CAMPAIGN_METRIC]?.value as number,
  );
  const candidateValue = latestValues ? (latestValues[2]?.toFixed(3) ?? "—") : "—";
  const baselineDelta = latestValues
    ? percent(latestValues[0] as number, latestValues[2] as number)
    : "—";
  const incumbentDelta = latestValues
    ? percent(latestValues[1] as number, latestValues[2] as number)
    : "—";
  const metricNote = latestQualified ? latestQualified.iteration.id : "No qualified run";
  const iterationRows = qualified
    .map(({ iteration, runs, comparable }) => {
      const values = runs.map((attempt) => attempt?.run?.metrics[PRIMARY_CAMPAIGN_METRIC]?.value);
      const candidate = runs[2];
      return `<tr><td><span class="badge">${e(iteration.decision)}</span></td><td><strong>${e(iteration.id)}</strong><p class="small">${e(iteration.hypothesis)}</p></td><td>${comparable ? `${values[2]?.toFixed(3)} ms/frame` : "Unqualified"}</td><td>${comparable ? `${percent(values[0] as number, values[2] as number)} / ${percent(values[1] as number, values[2] as number)}` : "No comparable evidence"}</td><td>${candidate ? attemptLink(data, candidate, iteration.candidateRunId) : e(iteration.candidateRunId)}<p class="small">${runs[0] ? attemptLink(data, runs[0], "baseline") : "baseline missing"} · ${runs[1] ? attemptLink(data, runs[1], "incumbent") : "incumbent missing"}</p></td></tr>`;
    })
    .join("");
  const pilotRows = (data.pilots ?? [])
    .map((attempt) => {
      const pilot = attempt.pilot;
      if (!pilot)
        return `<tr><td>${attemptLink(data, attempt)}</td><td colspan="3">${attempt.godotBenchmarks ? "Godot upstream benchmark file · render CPU/GPU split, no rung samples or frame series" : attempt.evidenceError ? `Evidence unavailable: ${e(attempt.evidenceError)}` : "Unreadable legacy pilot"}</td></tr>`;
      return summarize(pilot)
        .map(
          (rung) =>
            `<tr><td>${attemptLink(data, attempt)}<p class="small">${e(pilot.arm)} · recorded type: ${e(pilot.build.type)}</p><p class="small">${e(pilot.build.notes || "Build notes not recorded")}</p></td><td>${e(pilot.driver.adapter)}<p class="small">${e(pilot.driver.renderer)}</p></td><td>${e(rung.mode)} / ${rung.objectCount} objects</td><td>${rung.p95.toFixed(3)} ms<p class="small">${rung.repeats} repeat(s) · ${rung.sampleCount} samples</p></td></tr>`,
        )
        .join("");
    })
    .join("");
  const latest = iterations.at(-1);
  const currentPilot = latestHardwarePilot(data);
  const spans = currentPilot?.pilot?.rungs
    .map(
      (rung) =>
        `${rung.mode} / ${rung.objectCount} objects / repeat ${rung.repeat}: completed-work mean ${typeof rung.completedWorkMeanMs === "number" ? `${rung.completedWorkMeanMs.toFixed(3)} ms/frame` : "unavailable"}; CPU submit mean ${rung.cpuSubmitMeanMs === undefined ? "unavailable" : `${rung.cpuSubmitMeanMs.toFixed(3)} ms/frame`}.`,
    )
    .join(" ");
  const currentObservation =
    latest?.bottleneck ??
    (spans
      ? `${spans} Exploratory, cadence-inclusive browser delivery. Stage/GPU attribution is unavailable.`
      : "No observed spans yet; stage/GPU attribution is unavailable.");
  const nextHypothesis =
    latest?.nextHypothesis ??
    (currentPilot
      ? "Profile CPU submission and individual render stages to test which consumes CPU time; measure GPU work separately before assigning a bottleneck."
      : "Awaiting a qualified baseline and an explicit iteration record.");
  const attempts = data.attempts
    .map(
      (attempt) =>
        `<tr><td>${e(attempt.time)}<p class="small">${attempt.timeSource === "filesystem" ? "File time · not iteration time" : "Record time"}</p></td><td><span class="badge">${e(attempt.status)}</span>${attempt.evidenceError ? `<p class="error">Evidence unavailable: ${e(attempt.evidenceError)}</p>` : ""}</td><td>${attemptLink(data, attempt)}</td></tr>`,
    )
    .join("");
  const phases = data.prd.phases
    .map(
      (phase) =>
        `<div class="phase"><div class="phase-head"><span>${e(phase.name)}</span><span>${phase.done}/${phase.total}</span></div><progress value="${phase.done}" max="${Math.max(1, phase.total)}" aria-label="${e(phase.name)}"></progress></div>`,
    )
    .join("");
  const commits = data.git.commits
    .map(
      (commit) =>
        `<li><time>${e(commit.date)}</time><p><code title="${e(commit.sha)}">${e(commit.sha.slice(0, 9))}</code>${e(commit.subject)}</p></li>`,
    )
    .join("");
  const qualifiedCards = `<section class="kpis" aria-label="Qualified iteration metrics">${kpi("Latest qualified candidate", candidateValue, `ms/frame · ${metricNote}`, !latestQualified)}${kpi("Δ original baseline", baselineDelta, latestQualified ? "Negative = faster · same experiment" : "No qualified run", !latestQualified)}${kpi("Δ incumbent", incumbentDelta, latestQualified ? "Negative = faster · same experiment" : "No qualified run", !latestQualified)}${kpi("Qualified iterations", String(qualified.filter((item) => item.comparable).length), "Comparable baseline + incumbent + candidate")}</section>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="15">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Performance iterations · PRD-449</title><style>${STYLE}</style></head><body><main>
<div class="topline"><div class="eyebrow">ThreeNative / Performance lab</div><div class="live">Offline snapshot · refreshes every 15s</div></div>
<header><div class="section-head"><h1>Performance, over time.</h1><button type="button" onclick="location.reload()">Reload ↻</button></div><p class="subtitle">ThreeNative against Godot on the same physical display first, then the latest measured hardware run, then every qualified iteration with the evidence to call it. Completed-work mean, per-frame samples, and the decisions behind them.</p></header>
${renderEngineComparison(data)}
${renderPilotTrace(data)}
<section class="panel" aria-label="Qualified iterations"><div class="section-head"><h2>Qualified iterations</h2><span class="badge">${qualified.filter((item) => item.comparable).length} qualified</span></div><p class="note">Only explicit iterations whose baseline, incumbent and candidate runs are retained, checksummed and comparable count here. A pilot alone is not an iteration.</p>
${qualifiedCards}
${charts || `<div class="empty-chart"><h3>No qualified iterations yet</h3><p>Baseline, incumbent and candidate runs must be explicitly linked to an iteration and share an experiment, machine, backend and timing scope.</p></div>`}<p class="chart-note">Completed-work mean in ms/frame. Lines connect recorded iteration observations only. A lower point is an observed change, not statistical proof. Software rendering is excluded. PRD activity is not performance improvement.</p>
<h3>Iteration decisions</h3>${iterationRows ? `<div class="table-wrap"><table><thead><tr><th>Decision</th><th>Experiment</th><th>Candidate</th><th>Δ baseline / incumbent</th><th>Raw run evidence</th></tr></thead><tbody>${iterationRows}</tbody></table></div>` : `<p class="note">No decisions recorded. Keep, reject and invalid outcomes appear here when an iteration links its three run IDs.</p>`}${(data.iterationErrors ?? []).map((error) => `<p class="error">${e(error)}</p>`).join("")}</section>
<div class="grid"><section class="panel"><h2>Current experiment</h2><div class="state"><div class="label">${latest ? "Recorded bottleneck" : "Observed spans"}</div><p>${e(currentObservation)}</p></div><div class="state"><div class="label">Next hypothesis</div><p>${e(nextHypothesis)}</p></div><p class="note">${latest ? `From recorded iteration ${e(latest.id)}; statements are recorded hypotheses, not inferred diagnoses.` : currentPilot ? `Latest hardware production pilot: ${attemptLink(data, currentPilot)}. Profiling hypothesis only; no diagnosed bottleneck or speedup.` : "No timing or improvement claim has been invented."}</p></section><section class="panel"><h2>Implementation activity</h2><p class="note" style="margin:8px 0 22px">Chronological commits · activity only</p><ol class="timeline">${commits || `<li>${e(PENDING)}</li>`}</ol>${data.git.baseError ? `<p class="error">${e(data.git.baseError)}</p>` : ""}</section></div>
${pilotRows ? `<section class="panel"><div class="section-head"><h2>Unqualified pilots</h2><span class="badge">Exploration only</span></div><p class="note">Real observations with no qualified iteration linkage. Different devices, builds and workloads are not comparable; these are not evidence of improvement.</p><div class="table-wrap" tabindex="0" role="region" aria-label="Pilot observations; scroll horizontally for all columns"><table class="pilot-table"><thead><tr><th>Run / build</th><th>GPU / renderer</th><th>Workload</th><th>Frame p95</th></tr></thead><tbody>${pilotRows}</tbody></table></div></section>` : ""}
<section class="panel"><div class="section-head"><h2>Retained evidence</h2><span class="badge">All outcomes</span></div><p class="coverage" style="margin:0 0 18px">Retained attempts: ${data.attempts.filter((attempt) => attempt.kind === "attempt").length + (data.pilots?.length ?? 0)} · Verified v2 runs: ${valid.length} · Invalid / other campaign records: ${data.attempts.length - valid.length} · Unqualified pilots: ${data.pilots?.length ?? 0}</p><div class="table-wrap"><table><thead><tr><th>Recorded</th><th>Status</th><th>Source file</th></tr></thead><tbody>${attempts || `<tr><td colspan="3">${e(PENDING)}</td></tr>`}</tbody></table></div></section>
<details class="panel"><summary>Implementation progress · ${data.prd.done}/${data.prd.total} PRD boxes</summary><p class="small">${e(data.prd.status)}</p>${phases}${data.prd.missing ? `<p class="error">PRD file unreadable: ${e(data.prd.missing)}</p>` : ""}<p><code>${e(data.prd.file)}</code></p></details>
<footer>Generated ${e(data.generatedAt)} · <code>${e(data.git.branch)}</code> · HEAD <code>${e(data.git.head)}</code><br>Worktree ${e(data.git.worktree)} · merge-base ${e(data.git.base || "unavailable")}<br>Sources: ${e(data.attemptsRoot)}/runs and /iterations. Retained files only; overwritten runs cannot be recovered. Entirely offline, no external requests.</footer>
</main></body></html>`;
}

export async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, filePath);
}

export async function runMonitorCli(argv: string[]): Promise<void> {
  const watch = argv.includes("--watch");
  const requested = Number(argv[argv.indexOf("--interval") + 1]);
  const interval = Number.isFinite(requested) && requested > 0 ? requested : 5_000;
  const out = path.join(repoRoot, ARTIFACT_SUBDIR, PAGE_NAME);
  const once = async (): Promise<void> => {
    const data = await collectMonitorData();
    await writeFileAtomic(out, renderProgressHtml(data));
    process.stdout.write(
      `wrote ${path.relative(repoRoot, out)} — ${data.iterations?.length ?? 0} performance iterations, ${data.git.commits.length} commits, ${data.attempts.length} retained runs\n`,
    );
  };
  await once();
  if (!watch) return;
  process.stdout.write(WATCH_HINT);
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    await once();
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runMonitorCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
