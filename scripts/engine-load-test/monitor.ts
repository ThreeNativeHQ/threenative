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

import { type IRunReport, parseRunReport, summarize } from "./report.js";

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
  evidenceError?: string;
  kind: "attempt" | "record";
  source: string;
  status: string;
  time: string;
  timeSource: "filesystem" | "record";
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
  return attempt;
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
:root{color-scheme:dark;--bg:#101312;--panel:#191d1a;--line:#343b33;--muted:#a6b0a5;--ink:#f0f4e9;--accent:#d1ef86;--bad:#ffab9f}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 "Helvetica Neue",Helvetica,sans-serif}main{max-width:1440px;margin:auto;padding:38px 5vw}h1,h2,h3,p{margin:0}h1{font-size:clamp(30px,4vw,54px);font-weight:500;letter-spacing:-.055em;line-height:1.1}h2{font-size:22px;letter-spacing:-.025em;font-weight:500}h3{font-size:16px}a{color:var(--accent);text-underline-offset:4px}button{background:transparent;border:1px solid var(--line);color:var(--ink);border-radius:6px;padding:9px 15px;cursor:pointer}button:hover{border-color:var(--accent)}a:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:4px}.eyebrow,.label,th{font:11px/1.5 "DejaVu Sans Mono",monospace;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}.eyebrow{color:var(--accent);margin-bottom:16px}.topline,.section-head{display:flex;align-items:center;justify-content:space-between;gap:20px}.topline{margin-bottom:35px}.subtitle{color:var(--muted);margin-top:16px;max-width:720px}.live{font-size:12px;color:var(--muted)}.live:before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);margin-right:8px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);margin:34px 0 26px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--panel)}.kpi{padding:23px;border-right:1px solid var(--line)}.kpi:last-child{border:0}.value{display:block;font-size:42px;letter-spacing:-.05em;margin:9px 0 3px;line-height:1.1}.value.missing{color:var(--muted)}.coverage{margin:-10px 0 26px;color:var(--muted);font-size:12px}.pilot-table{min-width:760px}.pilot-table td:first-child{max-width:270px;overflow-wrap:anywhere}.small,.note{font-size:12px;color:var(--muted)}.panel{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:25px;margin-bottom:24px}.section-head{margin-bottom:22px}.badge{display:inline-block;border:1px solid var(--line);border-radius:4px;padding:4px 9px;font:11px "DejaVu Sans Mono",monospace;color:var(--muted)}.empty-chart{height:245px;display:grid;place-content:center;text-align:center;border-bottom:1px solid var(--line);background:repeating-linear-gradient(to bottom,transparent,transparent 59px,#343b3366 60px);padding:20px}.empty-chart h3{font-size:24px;font-weight:400;margin-bottom:10px}.empty-chart p{color:var(--muted);max-width:530px}.chart-note{margin-top:14px;color:var(--muted);font-size:12px}.grid{align-items:start;display:grid;grid-template-columns:1.7fr 1fr;gap:24px}.grid>.panel{min-width:0}.state{border-left:2px solid var(--accent);padding-left:16px;margin:20px 0}.state p{margin-top:8px;overflow-wrap:anywhere}.state .label{color:var(--accent)}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:14px 12px;border-bottom:1px solid var(--line);vertical-align:top}th:first-child,td:first-child{padding-left:0}td{font-size:13px}code{font:12px "DejaVu Sans Mono",monospace;overflow-wrap:anywhere}.timeline{max-height:310px;overflow:auto;list-style:none;padding:0;margin:0}.timeline li{position:relative;margin-left:5px;padding:0 0 23px 22px;border-left:1px solid var(--line)}.timeline li:before{content:"";position:absolute;left:-4px;top:7px;width:7px;height:7px;border-radius:50%;background:var(--accent)}.timeline p{margin-top:4px;overflow-wrap:anywhere}.timeline time{color:var(--muted);font-size:12px}.timeline code{margin-right:8px}.phase{margin-top:18px}.phase-head{display:flex;justify-content:space-between;gap:20px;font-size:12px}progress{width:100%;height:6px;border:0;border-radius:8px;background:var(--line);accent-color:var(--accent)}progress::-webkit-progress-bar{background:var(--line);border-radius:8px}progress::-webkit-progress-value{background:var(--accent);border-radius:8px}.error{color:var(--bad);overflow-wrap:anywhere}.trend{border-top:1px solid var(--line);padding-top:20px;margin-top:20px}.trend svg{width:100%;height:auto;max-height:260px}.trend text{fill:var(--muted);font:12px monospace}.trend circle{fill:var(--accent)}.trend polyline{fill:none;stroke:var(--accent);stroke-width:2}.trend .baseline{stroke:#a6b0a5;stroke-dasharray:5 5}.trend .incumbent{stroke:#8dbdd5}.legend{display:flex;gap:20px;flex-wrap:wrap;font-size:12px;color:var(--muted)}details summary{cursor:pointer;font-size:14px}details p{margin:12px 0}footer{font-size:12px;color:var(--muted);margin-top:24px;overflow-wrap:anywhere}@media(max-width:850px){.grid{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,1fr)}.kpi:nth-child(2){border-right:0}.kpi:nth-child(-n+2){border-bottom:1px solid var(--line)}}@media(max-width:480px){main{padding:24px 18px}.panel{padding:18px}.topline{align-items:flex-start}.value{font-size:34px}.kpi{padding:18px}.section-head{align-items:flex-start}.live{max-width:140px}.badge{white-space:nowrap}}
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
  const candidateValue = latestValues ? latestValues[2]?.toFixed(3) : "—";
  const baselineDelta = latestValues
    ? percent(latestValues[0] as number, latestValues[2] as number)
    : "—";
  const incumbentDelta = latestValues
    ? percent(latestValues[1] as number, latestValues[2] as number)
    : "—";
  const metricNote = latestQualified ? e(latestQualified.iteration.id) : "No qualified run";
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
        return `<tr><td>${attemptLink(data, attempt)}</td><td colspan="3">Unreadable legacy pilot</td></tr>`;
      return summarize(pilot)
        .map(
          (rung) =>
            `<tr><td>${attemptLink(data, attempt)}<p class="small">${e(pilot.arm)} · recorded type: ${e(pilot.build.type)}</p><p class="small">${e(pilot.build.notes || "Build notes not recorded")}</p></td><td>${e(pilot.driver.adapter)}<p class="small">${e(pilot.driver.renderer)}</p></td><td>${e(rung.mode)} / ${rung.objectCount} objects</td><td>${rung.p95.toFixed(3)} ms<p class="small">${rung.repeats} repeat(s) · ${rung.sampleCount} samples</p></td></tr>`,
        )
        .join("");
    })
    .join("");
  const latest = iterations.at(-1);
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
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="15">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Performance iterations · PRD-449</title><style>${STYLE}</style></head><body><main>
<div class="topline"><div class="eyebrow">ThreeNative / Performance lab</div><div class="live">Offline snapshot · refreshes every 15s</div></div>
<header><div class="section-head"><h1>Performance, over time.</h1><button type="button" onclick="location.reload()">Reload ↻</button></div><p class="subtitle">Performance iterations, with the evidence to call them. Completed-work mean, comparable experiments, and every retained outcome.</p></header>
<section class="kpis" aria-label="Performance metrics"><div class="kpi"><span class="label">Latest qualified candidate</span><strong class="value ${latestQualified ? "" : "missing"}">${candidateValue}</strong><span class="small">ms/frame · ${metricNote}</span></div><div class="kpi"><span class="label">Δ original baseline</span><strong class="value ${latestQualified ? "" : "missing"}">${baselineDelta}</strong><span class="small">${latestQualified ? "Negative = faster · same experiment" : "No qualified run"}</span></div><div class="kpi"><span class="label">Δ incumbent</span><strong class="value ${latestQualified ? "" : "missing"}">${incumbentDelta}</strong><span class="small">${latestQualified ? "Negative = faster · same experiment" : "No qualified run"}</span></div><div class="kpi"><span class="label">Qualified iterations</span><strong class="value">${qualified.filter((item) => item.comparable).length}</strong><span class="small">Comparable baseline + incumbent + candidate</span></div></section>
<p class="coverage">Retained attempts: ${data.attempts.filter((attempt) => attempt.kind === "attempt").length + (data.pilots?.length ?? 0)} · Verified v2 runs: ${valid.length} · Invalid / other campaign records: ${data.attempts.length - valid.length} · Unqualified pilots: ${data.pilots?.length ?? 0}</p>
<section class="panel"><div class="section-head"><h2>Performance trend</h2><span class="badge">Lower is better</span></div>${charts || `<div class="empty-chart"><h3>No qualified iterations yet</h3><p>Baseline, incumbent and candidate runs must be explicitly linked to an iteration and share an experiment, machine, backend and timing scope.</p></div>`}<p class="chart-note">Completed-work mean in ms/frame. Lines connect recorded iteration observations only. A lower point is an observed change, not statistical proof. Software rendering is excluded. PRD activity is not performance improvement.</p></section>
${pilotRows ? `<section class="panel"><div class="section-head"><h2>Unqualified pilots</h2><span class="badge">Exploration only</span></div><p class="note">Real observations with no qualified iteration linkage. Different devices, builds and workloads are not comparable; these are not evidence of improvement.</p><div class="table-wrap" tabindex="0" role="region" aria-label="Pilot observations; scroll horizontally for all columns"><table class="pilot-table"><thead><tr><th>Run / build</th><th>GPU / renderer</th><th>Workload</th><th>Frame p95</th></tr></thead><tbody>${pilotRows}</tbody></table></div></section>` : ""}
<section class="panel"><div class="section-head"><h2>Iteration decisions</h2><span class="badge">${iterations.length} recorded</span></div>${iterationRows ? `<div class="table-wrap"><table><thead><tr><th>Decision</th><th>Experiment</th><th>Candidate</th><th>Δ baseline / incumbent</th><th>Raw run evidence</th></tr></thead><tbody>${iterationRows}</tbody></table></div>` : `<p class="note">No decisions recorded. Keep, reject and invalid outcomes appear here when an iteration links its three run IDs.</p>`}${(data.iterationErrors ?? []).map((error) => `<p class="error">${e(error)}</p>`).join("")}</section>
<div class="grid"><section class="panel"><h2>Current experiment</h2><div class="state"><div class="label">Bottleneck</div><p>${e(latest?.bottleneck ?? "Not measured yet")}</p></div><div class="state"><div class="label">Next hypothesis</div><p>${e(latest?.nextHypothesis ?? "Awaiting a qualified baseline and an explicit iteration record.")}</p></div><p class="note">${latest ? `From recorded iteration ${e(latest.id)}; statements are recorded hypotheses, not inferred diagnoses.` : "No timing or improvement claim has been invented."}</p></section><section class="panel"><h2>Implementation activity</h2><p class="note" style="margin:8px 0 22px">Chronological commits · activity only</p><ol class="timeline">${commits || `<li>${e(PENDING)}</li>`}</ol>${data.git.baseError ? `<p class="error">${e(data.git.baseError)}</p>` : ""}</section></div>

<section class="panel"><div class="section-head"><h2>Retained evidence</h2><span class="badge">All outcomes</span></div><div class="table-wrap"><table><thead><tr><th>Recorded</th><th>Status</th><th>Source file</th></tr></thead><tbody>${attempts || `<tr><td colspan="3">${e(PENDING)}</td></tr>`}</tbody></table></div></section>
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
