#!/usr/bin/env tsx
/**
 * `pnpm publish:check` — the preflight that makes a stale publish impossible.
 *
 * Four packages went up by hand on 2026-08-09 and three never went up at all. Nothing computed a
 * version bump, nothing failed when a package was edited without one, and npm does not permit
 * republishing a version that exists — so the only way that ends well is a check that refuses the
 * tree before anybody runs `pnpm publish`.
 *
 * It answers three questions, and fails closed on each:
 *  - is every publishable workspace package in the publish set, or is one silently missing?
 *  - has any package's `src/` moved since the version it still carries was published?
 *  - did a `catalog:` or `workspace:` specifier survive into a manifest that ships?
 *
 * A registry it cannot reach is not a pass. It exits `2` — `pnpm alpha:bar` and
 * `pnpm studio:probe` use the same rank, where `2` means the question was never answered.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");

export interface IPublishPackage {
  readonly directory: string;
  readonly manifest: string;
  readonly name: string;
  readonly version: string;
}

export interface IPublishFinding {
  readonly detail: string;
  readonly package: string;
  /** `blocked` means the question was not answered — never a pass, and never a plain failure. */
  readonly severity: "blocked" | "fail";
}

export interface IPublishReport {
  readonly checked: readonly string[];
  readonly exitCode: 0 | 1 | 2;
  readonly findings: readonly IPublishFinding[];
}

/** Every workspace package a stranger would have to install. `private` packages are not shipped. */
export function publishSet(repo: string): readonly IPublishPackage[] {
  const root = path.join(repo, "packages");
  if (!fs.existsSync(root))
    throw new Error(`TN_PUBLISH_NO_PACKAGES: ${root} does not exist, so nothing can be published.`);
  const packages: IPublishPackage[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join(root, entry.name, "package.json");
    if (!fs.existsSync(manifest)) continue;
    const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as {
      name?: unknown;
      private?: unknown;
      version?: unknown;
    };
    if (parsed.private === true) continue;
    if (typeof parsed.name !== "string" || typeof parsed.version !== "string")
      throw new Error(`TN_PUBLISH_MANIFEST_MALFORMED: ${manifest} has no name or version.`);
    packages.push({
      directory: path.join(root, entry.name),
      manifest,
      name: parsed.name,
      version: parsed.version,
    });
  }
  if (packages.length === 0)
    throw new Error("TN_PUBLISH_EMPTY_SET: no publishable package was found. Refusing to pass.");
  return packages.sort((left, right) => left.name.localeCompare(right.name));
}

export interface IRegistryFacts {
  /** ISO timestamp the current published version went up, if the package is on the registry. */
  readonly published?: string;
  readonly state: "absent" | "present" | "unreachable";
  readonly version?: string;
}

export type RegistryLookup = (packageName: string) => IRegistryFacts;

export function npmLookup(repo: string): RegistryLookup {
  const userconfig = path.join(repo, ".npmrc");
  const config = fs.existsSync(userconfig) ? ["--userconfig", userconfig] : [];
  return (packageName) => {
    try {
      const stdout = execFileSync(
        "npm",
        [...config, "view", packageName, "version", "time", "--json"],
        { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 },
      );
      const parsed = JSON.parse(stdout) as { time?: Record<string, string>; version?: string };
      if (typeof parsed.version !== "string") return { state: "unreachable" };
      const published = parsed.time?.[parsed.version];
      return {
        state: "present",
        version: parsed.version,
        ...(published === undefined ? {} : { published }),
      };
    } catch (error) {
      const text = `${(error as { stderr?: unknown }).stderr ?? ""}${
        error instanceof Error ? error.message : String(error)
      }`;
      return /E404|404 Not Found/u.test(text) ? { state: "absent" } : { state: "unreachable" };
    }
  };
}

/** Commits touching a package's shipped source since a timestamp. */
export type SourceCommits = (directory: string, since: string) => number;

export function gitSourceCommits(repo: string): SourceCommits {
  return (directory, since) => {
    const source = path.join(directory, "src");
    const target = fs.existsSync(source) ? source : directory;
    const stdout = execFileSync(
      "git",
      ["log", "--oneline", `--since=${since}`, "--", path.relative(repo, target)],
      { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return stdout.split("\n").filter((line) => line.trim().length > 0).length;
  };
}

const UNRESOLVED = /^(?:catalog:|workspace:)/u;

/**
 * A template manifest ships to a user's disk verbatim. `catalog:` and `workspace:` are pnpm
 * workspace protocols with no meaning outside this repository, so one surviving into a scaffolded
 * project is an install that fails on the stranger's machine and nowhere else.
 */
export function unresolvedTemplateSpecifiers(repo: string): readonly IPublishFinding[] {
  const root = path.join(repo, "packages", "create-threenative", "templates");
  if (!fs.existsSync(root)) return [];
  const findings: IPublishFinding[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join(root, entry.name, "package.json");
    if (!fs.existsSync(manifest)) continue;
    const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as Record<string, unknown>;
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      const block = parsed[field];
      if (typeof block !== "object" || block === null) continue;
      for (const [dependency, specifier] of Object.entries(block as Record<string, unknown>))
        if (typeof specifier === "string" && UNRESOLVED.test(specifier))
          findings.push({
            detail: `templates/${entry.name}/package.json ${field}.${dependency} is '${specifier}', which has no meaning outside this workspace.`,
            package: `template:${entry.name}`,
            severity: "fail",
          });
    }
  }
  return findings;
}

export const RELEASE_WORKFLOW = ".github/workflows/npm-release.yml";

/**
 * The publish set is the workflow's list, not this script's. A package that exists, is not
 * private, and is missing from that list is the failure mode that produced three 404s: nobody
 * decided not to publish it, it was simply never named anywhere.
 */
export function missingFromReleaseWorkflow(
  repo: string,
  packages: readonly IPublishPackage[],
): readonly IPublishFinding[] {
  const workflow = path.join(repo, RELEASE_WORKFLOW);
  if (!fs.existsSync(workflow))
    return [
      {
        detail: `${RELEASE_WORKFLOW} does not exist, so there is no publish set to check against.`,
        package: "release-workflow",
        severity: "blocked",
      },
    ];
  const text = fs.readFileSync(workflow, "utf8");
  return packages
    .filter((item) => !text.includes(item.name))
    .map((item) => ({
      detail: `${item.name} is publishable but is not named in ${RELEASE_WORKFLOW}, so a release would silently skip it.`,
      package: item.name,
      severity: "fail" as const,
    }));
}

export interface ICheckPublishOptions {
  readonly lookup?: RegistryLookup;
  readonly repo?: string;
  readonly sourceCommits?: SourceCommits;
}

function versionFinding(
  item: IPublishPackage,
  facts: IRegistryFacts,
  commits: SourceCommits,
): IPublishFinding | undefined {
  if (facts.state === "unreachable")
    return {
      detail: `The registry could not be reached, so it is unknown whether ${item.version} is already published.`,
      package: item.name,
      severity: "blocked",
    };
  // Never published is not a defect here: publishing it is the whole point. The defect is a
  // version that cannot go up because the same string is already on the registry.
  if (facts.state === "absent") return undefined;
  if (facts.version !== item.version) return undefined;
  if (facts.published === undefined)
    return {
      detail: `${item.name}@${item.version} is already published and the registry reported no publish time, so drift cannot be measured.`,
      package: item.name,
      severity: "blocked",
    };
  const moved = commits(item.directory, facts.published);
  if (moved === 0) return undefined;
  return {
    detail: `${item.name} still declares ${item.version}, which was published ${facts.published}, and its source has ${moved} commit(s) since. npm cannot republish a version that exists — bump it.`,
    package: item.name,
    severity: "fail",
  };
}

export function checkPublishState(options: ICheckPublishOptions = {}): IPublishReport {
  const repo = options.repo ?? REPO;
  const lookup = options.lookup ?? npmLookup(repo);
  const commits = options.sourceCommits ?? gitSourceCommits(repo);
  const packages = publishSet(repo);
  const findings: IPublishFinding[] = [];
  for (const item of packages) {
    const finding = versionFinding(item, lookup(item.name), commits);
    if (finding !== undefined) findings.push(finding);
  }
  findings.push(...missingFromReleaseWorkflow(repo, packages));
  findings.push(...unresolvedTemplateSpecifiers(repo));
  const blocked = findings.some((finding) => finding.severity === "blocked");
  return {
    checked: packages.map((item) => item.name),
    exitCode: blocked ? 2 : findings.length > 0 ? 1 : 0,
    findings,
  };
}

export function formatPublishReport(report: IPublishReport): string {
  const lines = [`Checked ${report.checked.length} package(s): ${report.checked.join(", ")}`];
  for (const finding of report.findings)
    lines.push(`${finding.severity.toUpperCase()}  ${finding.package}: ${finding.detail}`);
  lines.push(
    report.exitCode === 0
      ? "Every package is ready to publish."
      : `${report.findings.length} finding(s). This tree must not be published as it stands.`,
  );
  return `${lines.join("\n")}\n`;
}

function main(): void {
  const report = checkPublishState();
  process.stdout.write(formatPublishReport(report));
  process.exitCode = report.exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
