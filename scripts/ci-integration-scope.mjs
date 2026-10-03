// No dependencies or install: the paths job runs this against exact Git objects.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const WORKFLOW = ".github/workflows/integration.yml";
const SELECTOR = "scripts/ci-integration-scope.mjs";

function parse(source) {
  if (source.includes("\t") || source.includes("\r")) throw new Error("ambiguous indentation");
  const split = source.split("\njobs:\n");
  if (split.length !== 2 || /^\S/mu.test(split[1])) throw new Error("unbounded jobs mapping");
  const headings = [...split[1].matchAll(/^ {2}([a-z][a-z0-9-]*):\n/gmu)];
  const jobs = new Map(
    headings.map((h, i) => [h[1], split[1].slice(h.index, headings[i + 1]?.index)]),
  );
  if (!jobs.has("paths") || jobs.size !== headings.length) throw new Error("unknown job shape");
  const section = jobs.get("paths");
  const block = / {10}TN_LANE_FILTERS: \|\n((?: {12}[^\n]+\n)+)/u.exec(section)?.[1];
  if (!block) throw new Error("missing filters");
  const filters = new Map();
  for (const line of block.trimEnd().split("\n")) {
    const match = /^ {12}([a-z][a-z-]*) (\^.+)$/u.exec(line);
    if (!match || filters.has(match[1])) throw new Error("ambiguous filters");
    filters.set(match[1], new RegExp(match[2], "u"));
  }
  const outputs = [
    ...section.matchAll(
      /^ {6}([a-z][a-z-]*): \$\{\{ steps\.filter\.outputs\.([a-z][a-z-]*) \}\}$/gmu,
    ),
  ];
  if (
    outputs.length !== filters.size ||
    new Set(outputs.map((m) => m[1])).size !== filters.size ||
    outputs.some((m) => m[1] !== m[2] || !filters.has(m[1]))
  ) {
    throw new Error("filter/output mismatch");
  }
  const dependencies = new Map();
  const roots = new Map();
  for (const [id, body] of jobs) {
    if (id === "paths") continue;
    const declarations = [...body.matchAll(/^ {4}needs: (.+)$/gmu)];
    if (declarations.length !== 1) throw new Error("unknown needs shape");
    const raw = declarations[0][1];
    if (!/^(?:[a-z][a-z0-9-]*|\[[a-z0-9, -]+\])$/u.test(raw))
      throw new Error("unknown needs value");
    const needs = raw
      .replace(/^\[|\]$/gu, "")
      .split(",")
      .map((n) => n.trim());
    if (needs.some((n) => !jobs.has(n))) throw new Error("missing dependency");
    dependencies.set(id, needs);
    const gate = [...body.matchAll(/needs\.paths\.outputs\.([a-z][a-z-]*) == 'true'/gu)];
    if (needs.includes("paths")) {
      if (needs.length !== 1) throw new Error("entry dependency crosses lanes");
      if (gate.length !== 1 || !filters.has(gate[0][1])) throw new Error("unknown root gate");
      roots.set(id, gate[0][1]);
    } else if (gate.length) throw new Error("unbound root gate");
  }
  if (new Set(roots.values()).size !== filters.size) throw new Error("orphan filter");
  const laneFor = (id, seen = new Set()) => {
    if (roots.has(id)) return roots.get(id);
    if (seen.has(id)) throw new Error("cyclic dependencies");
    const lanes = new Set(dependencies.get(id).map((n) => laneFor(n, new Set([...seen, id]))));
    if (lanes.size !== 1) throw new Error("ambiguous dependent lane");
    return [...lanes][0];
  };
  const lanesByJob = new Map([...dependencies.keys()].map((id) => [id, laneFor(id)]));
  return {
    header: split[0],
    jobs,
    filters,
    lanesByJob,
    scheduling: section.replace(block, "<lane filters>\n"),
  };
}

export function integrationSelection({ files, before, after }) {
  // An unsupported output expression can override even a true step output. Fail the paths
  // job visibly rather than emit a partial fallback that Actions could treat as a skipped lane.
  const pathsAt = after.indexOf("\n  paths:\n");
  if (pathsAt < 0) throw new Error("missing paths output owner");
  const rest = after.slice(pathsAt + 1);
  const nextJob = /^ {2}[a-z][a-z0-9-]*:/mu.exec(rest.slice(1));
  const paths = nextJob ? rest.slice(0, nextJob.index + 1) : rest;
  const outputHeader = /^ {4}outputs:\n/mu.exec(paths);
  if (!outputHeader) throw new Error("missing integration outputs");
  const outputRest = paths.slice(outputHeader.index + outputHeader[0].length);
  const sibling = /^ {4}[a-z][a-z0-9-]*:/mu.exec(outputRest);
  if (!sibling) throw new Error("unbounded integration outputs");
  const outputBlock = outputRest.slice(0, sibling.index);
  const outputNames = outputBlock
    .split("\n")
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
    .map((line) => {
      const match =
        /^ {6}([a-z][a-z-]*): \$\{\{ steps\.filter\.outputs\.([a-z][a-z-]*) \}\}$/u.exec(line);
      if (!match || match[1] !== match[2])
        throw new Error("unsupported integration output expression");
      return match[1];
    });
  if (!outputNames.length) throw new Error("no integration outputs");
  if (new Set(outputNames).size !== outputNames.length)
    throw new Error("duplicate integration outputs");
  const declaredLanes = new Set([
    ...[...paths.matchAll(/^ {12}([a-z][a-z-]*) /gmu)].map((m) => m[1]),
    ...[...after.matchAll(/needs\.paths\.outputs\.([a-z][a-z-]*)/gu)].map((m) => m[1]),
  ]);
  if (
    declaredLanes.size !== outputNames.length ||
    outputNames.some((name) => !declaredLanes.has(name))
  ) {
    throw new Error("incomplete integration output inventory");
  }
  const all = (reason) => ({
    lanes: Object.fromEntries(outputNames.map((n) => [n, true])),
    reason,
  });
  try {
    const current = parse(after);
    if (!Array.isArray(files) || files.some((f) => typeof f !== "string"))
      return all("unknown changed paths");
    if (files.includes(SELECTOR)) return all("shared selector changed");
    const lanes = new Set();
    for (const file of files) {
      for (const [lane, pattern] of current.filters) if (pattern.test(file)) lanes.add(lane);
    }
    if (files.includes(WORKFLOW)) {
      const previous = parse(before);
      if (
        current.header !== previous.header ||
        current.scheduling !== previous.scheduling ||
        [...current.jobs.keys()].join() !== [...previous.jobs.keys()].join() ||
        [...current.filters.keys()].join() !== [...previous.filters.keys()].join()
      ) {
        return all("shared scheduling or workflow shape changed");
      }
      for (const [lane, pattern] of current.filters) {
        if (pattern.source !== previous.filters.get(lane).source) lanes.add(lane);
      }
      for (const [id, body] of current.jobs) {
        if (id !== "paths" && body !== previous.jobs.get(id)) {
          lanes.add(current.lanesByJob.get(id));
          lanes.add(previous.lanesByJob.get(id));
        }
      }
    }
    return {
      lanes: Object.fromEntries(outputNames.map((n) => [n, lanes.has(n)])),
      reason: "source filters and bounded job/dependency comparison",
    };
  } catch (error) {
    if (error.message === "unknown root gate") throw error;
    return all(`fail closed: ${error.message}`);
  }
}

export function integrationGitSelection(base, head) {
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
  const after = git("show", `${head}:${WORKFLOW}`);
  try {
    if (!/^[a-f0-9]{40}$/u.test(base ?? "") || !/^[a-f0-9]{40}$/u.test(head ?? ""))
      throw new Error("missing exact source identity");
    if (git("rev-parse", "HEAD").trim() !== head) throw new Error("checkout/source mismatch");
    git("merge-base", "--is-ancestor", base, head);
    // --no-renames retains both endpoints: removing a source is an impact too.
    const files = git("diff", "--no-renames", "--name-only", "-z", base, head, "--")
      .split("\0")
      .filter(Boolean);
    return integrationSelection({ files, before: git("show", `${base}:${WORKFLOW}`), after });
  } catch {
    return integrationSelection({ files: [SELECTOR], before: "", after });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = integrationGitSelection(process.env.TN_BASE_SHA, process.env.TN_HEAD_SHA);
  console.log(result.reason);
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(result.lanes)
      .map(([lane, selected]) => `${lane}=${selected}\n`)
      .join(""),
  );
}
