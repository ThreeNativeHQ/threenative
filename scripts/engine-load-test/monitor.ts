// `pnpm bench:engines:monitor` — PRD-449 campaign progress monitor. It reads three already
// existing sources of truth (the PRD file, this branch's git history, the campaign's retained
// artifact files) and copies what they say into one offline page. It computes no timing, no
// ratio and no verdict of its own: an attempt row shows only the record's own status word and
// where the file is. A run file that was overwritten is not recoverable from here.
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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
  kind: "attempt" | "record";
  source: string;
  status: string;
  time: string;
  timeSource: "filesystem" | "record";
}

export interface IMonitorData {
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
  return attempt;
}

/** Every retained JSON file under the campaign's `runs/` subtree is listed, including malformed
 *  and failed ones — a deleted or overwritten attempt cannot be shown, and an unreadable one is
 *  named rather than dropped. Only `runs/` is scanned: the campaign root also holds frozen source
 *  trees and compatibility records, which are inputs, not attempts. `source` stays relative to
 *  the campaign root, where `progress.html` is written, so its links resolve. */
export async function readAttempts(rootDir: string): Promise<IAttempt[]> {
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
  const runsRoot = path.join(rootDir, RUNS_SUBDIR);
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
    attempts: await readAttempts(attemptsRoot),
    attemptsRoot: path.relative(repoRoot, attemptsRoot),
    generatedAt: new Date().toISOString(),
    git: await readGitState(),
    prd,
  };
}

const STYLE =
  ":root{color-scheme:light dark}body{font:15px/1.5 ui-sans-serif,system-ui,sans-serif;margin:0 auto;max-width:70rem;padding:1.5rem}h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:2rem;border-bottom:1px solid #8884;padding-bottom:.3rem}table{border-collapse:collapse;width:100%;margin:.5rem 0}th,td{border-bottom:1px solid #8884;padding:.3rem .5rem;text-align:left;vertical-align:top}th{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;opacity:.75}code{font:13px ui-monospace,monospace}dl{display:grid;grid-template-columns:auto 1fr;gap:.2rem 1rem;margin:.5rem 0}dt{font-weight:600}dd{margin:0}meta,footer{opacity:.75;font-size:.85rem}button{font:inherit;padding:.3rem .7rem}";

function row(cells: string): string {
  return `<tr>${cells}</tr>`;
}

function cell(value: string): string {
  return `<td>${value}</td>`;
}

export function renderProgressHtml(data: IMonitorData): string {
  const e = escapeHtml;
  const phases = data.prd.phases
    .map((phase) => row(cell(e(phase.name)) + cell(`${phase.done}/${phase.total}`)))
    .join("");
  // Already in git --reverse order: the same day is not one moment, so sorting by date then
  // sha would rewrite chronology for every same-day commit pair.
  const commits = data.git.commits
    .map((commit) =>
      row(cell(e(commit.date)) + cell(`<code>${e(commit.sha)}</code>`) + cell(e(commit.subject))),
    )
    .join("");
  const attempts = data.attempts
    .map((attempt) => {
      const href = safeArtifactHref(
        data.attemptsRoot,
        path.join(data.attemptsRoot, attempt.source),
      );
      const source =
        href === null ? e(attempt.source) : `<a href="${e(href)}">${e(attempt.source)}</a>`;
      const stamp = e(attempt.time) + (attempt.timeSource === "filesystem" ? " (file time)" : "");
      return row(cell(stamp) + cell(e(attempt.kind)) + cell(e(attempt.status)) + cell(source));
    })
    .join("");
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta http-equiv="refresh" content="15">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PRD-449 campaign progress</title>
<style>${STYLE}</style>
<h1>PRD-449 campaign progress</h1>
<p>Generated ${e(data.generatedAt)} from the PRD file, this branch's git history and the retained files under <code>${e(data.attemptsRoot)}</code>. This page re-reads itself off disk every 15 seconds — no network — or reload it now. <button onclick="location.reload()">reload</button></p>
<dl>
<dt>worktree</dt><dd><code>${e(data.git.worktree)}</code></dd>
<dt>branch</dt><dd><code>${e(data.git.branch)}</code></dd>
<dt>HEAD</dt><dd><code>${e(data.git.head)}</code></dd>
<dt>merge-base</dt><dd><code>${e(data.git.base === "" ? "unavailable" : data.git.base)}</code></dd>
<dt>PRD</dt><dd><code>${e(data.prd.file)}</code> — ${e(data.prd.status)}</dd>
</dl>
<h2>PRD boxes (${data.prd.done}/${data.prd.total})</h2>
<table><thead><tr><th>phase</th><th>boxes</th></tr></thead><tbody>${
    phases === "" ? row(cell(e(PENDING))) : phases
  }</tbody></table>
${data.prd.missing === null ? "" : `<p>PRD file unreadable: ${e(data.prd.missing)}</p>`}
<h2>Implementation iterations</h2>
<table><thead><tr><th>date</th><th>commit</th><th>subject</th></tr></thead><tbody>${
    commits === "" ? row(cell(e(PENDING))) : commits
  }</tbody></table>
${data.git.baseError === null ? "" : `<p>${e(data.git.baseError)}</p>`}
<h2>Retained benchmark attempts</h2>
<table><thead><tr><th>recorded</th><th>kind</th><th>recorded status</th><th>source</th></tr></thead><tbody>${
    attempts === "" ? row(cell(e(PENDING))) : attempts
  }</tbody></table>
<footer>No timing, ratio or verdict is produced here: every number a run claims stays in that run's own file, and a run file that was overwritten leaves no history behind. The attempt history below is only as complete as the retained files are.</footer>
</html>
`;
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
      `wrote ${path.relative(repoRoot, out)} — ${data.prd.done}/${data.prd.total} boxes, ${data.git.commits.length} iterations, ${data.attempts.length} retained attempts\n`,
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
