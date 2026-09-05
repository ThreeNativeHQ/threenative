/**
 * The `needs:` graph of a GitHub Actions workflow, and the rule PRD-296 exists to keep.
 *
 * PRD-296: three gates were behind a permanently red one, so they were skipped on every run this
 * repository had ever produced and nobody had seen any of them fail. The board looked like nine
 * jobs of coverage and was six. The rule it settled on is that **no job may declare `needs:` on a
 * job whose purpose is coverage rather than artifact production** — `needs: build` is legitimate
 * because the downstream lane consumes what `build` packs; `needs: test` as a cost saving is what
 * created the hole, and the saving was illusory because the job never ran.
 *
 * The classification below is derived from the workflow text rather than kept in a list beside it.
 * A hand-maintained allowlist of legal edges is one more thing to forget to update, and forgetting
 * would restore exactly the invisible arrangement this guards.
 */

/** A job as the guard needs to see it. */
export interface ICiJob {
  readonly name: string;
  readonly needs: readonly string[];
  /** Runs `actions/upload-artifact`, so downstream jobs may legitimately be ordered behind it. */
  readonly producesArtifact: boolean;
  /** Reads `needs.<job>.result` — an aggregator whose whole job is to report an upstream verdict. */
  readonly aggregates: readonly string[];
  /**
   * Reads `toJSON(needs)`, which is every upstream result at once.
   *
   * The run summary is the reason this exists: reporting each job's verdict *is* its work, and it
   * cannot name the jobs it reports on without depending on all of them.
   */
  readonly aggregatesAll: boolean;
}

/** One illegal `needs:` edge, phrased the way the failure should read. */
export interface ICiNeedsFinding {
  readonly job: string;
  readonly dependsOn: string;
  readonly problem: string;
}

function jobsBlock(source: string): string {
  const at = source.indexOf("\njobs:\n");
  if (at < 0) throw new Error("CI_WORKFLOW_NO_JOBS: the workflow declares no `jobs:` mapping");
  return source.slice(at);
}

/** Splits the `jobs:` mapping into `[name, section]` pairs, in file order. */
export function jobSections(source: string): readonly (readonly [string, string])[] {
  const jobs = jobsBlock(source);
  const headings = [...jobs.matchAll(/^ {2}([A-Za-z0-9_-]+):\n/gmu)];
  if (headings.length === 0) {
    throw new Error("CI_WORKFLOW_NO_JOBS: the `jobs:` mapping declares no jobs");
  }
  return headings.map((heading, index) => {
    const name = heading[1];
    if (name === undefined) throw new Error("CI_WORKFLOW_NO_JOBS: a job heading has no name");
    return [name, jobs.slice(heading.index, headings[index + 1]?.index ?? jobs.length)] as const;
  });
}

/**
 * The `needs:` a job declares, in either shape Actions accepts: `needs: build` and
 * `needs: [a, b]` inline, or a block sequence underneath.
 *
 * Anchored at exactly four spaces so a `needs:` quoted inside a comment — `ci.yml` has one,
 * explaining why an edge is ordering-only — is not read as an edge.
 */
export function declaredNeeds(section: string): readonly string[] {
  const inline = /^ {4}needs:[ \t]*(.*)$/mu.exec(section);
  if (inline === null) return [];
  const rest = (inline[1] ?? "").trim();
  if (rest.startsWith("[")) {
    return rest
      .slice(1, rest.indexOf("]") < 0 ? undefined : rest.indexOf("]"))
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (rest.length > 0) return [rest];
  // `$` stops before the newline, so the block sequence starts one character further on.
  const block = section.slice((inline.index ?? 0) + inline[0].length).replace(/^\n/u, "");
  const listed: string[] = [];
  for (const line of block.split("\n")) {
    const item = /^ {6}-[ \t]+([A-Za-z0-9_-]+)\s*$/u.exec(line);
    if (item === null) break;
    listed.push(item[1] ?? "");
  }
  return listed;
}

/** Reads the workflow into the shape the rule is stated over. */
export function ciJobGraph(source: string): readonly ICiJob[] {
  return jobSections(source).map(([name, section]) => ({
    aggregates: [...section.matchAll(/needs\.([A-Za-z0-9_-]+)\.result/gu)].map(
      (match) => match[1] ?? "",
    ),
    aggregatesAll: /toJSON\(\s*needs\s*\)/u.test(section),
    name,
    needs: declaredNeeds(section),
    producesArtifact: section.includes("actions/upload-artifact"),
  }));
}

/**
 * Every edge that would hide a gate behind another gate.
 *
 * An edge `job -> dependsOn` is legal when `dependsOn` produces an artifact, or when `job` reads
 * that verdict — `needs.<dependsOn>.result`, or `toJSON(needs)` for a job that reports all of
 * them. An aggregator exists precisely to publish an upstream result and cannot do its work
 * without the edge. Everything else is a coverage job ordered behind another coverage job, which
 * is the arrangement that concealed three broken gates for as long as they existed.
 *
 * Fail-closed: an edge naming a job the workflow does not declare is a finding, not a skip.
 */
export function ciNeedsFindings(jobs: readonly ICiJob[]): readonly ICiNeedsFinding[] {
  const byName = new Map(jobs.map((job) => [job.name, job]));
  const findings: ICiNeedsFinding[] = [];
  for (const job of jobs) {
    for (const dependsOn of job.needs) {
      const upstream = byName.get(dependsOn);
      if (upstream === undefined) {
        findings.push({
          dependsOn,
          job: job.name,
          problem: `${job.name} declares needs: ${dependsOn}, which this workflow does not declare`,
        });
        continue;
      }
      if (upstream.producesArtifact) continue;
      if (job.aggregatesAll || job.aggregates.includes(dependsOn)) continue;
      findings.push({
        dependsOn,
        job: job.name,
        problem: `${job.name} declares needs: ${dependsOn}, and ${dependsOn} produces no artifact and is not aggregated by ${job.name} — a gate behind a gate is skipped on every run the upstream is red, which is indistinguishable from passing`,
      });
    }
  }
  return findings;
}
