#!/usr/bin/env tsx
/**
 * `pnpm publish:check` — the preflight that makes a stale publish impossible.
 *
 * Four packages went up by hand on 2026-08-09 and three never went up at all. Nothing computed a
 * version bump, nothing failed when a package was edited without one, and npm does not permit
 * republishing a version that exists — so the only way that ends well is a check that refuses the
 * tree before anybody runs `pnpm publish`.
 *
 * It answers four questions, and fails closed on each:
 *  - is every publishable workspace package in the publish set, or is one silently missing?
 *  - has any package's `src/` moved since the version it still carries was published?
 *  - did a `catalog:` or `workspace:` specifier survive into a manifest that ships?
 *  - does every publishable package carry a README that its own `files` list would include?
 *  - does every relative import of every shipped script resolve inside the packed tarball?
 *
 * A registry it cannot reach is not a pass. It exits `2` — `pnpm alpha:bar` uses the same rank,
 * where `2` means the question was never answered.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { init, parse } from "es-module-lexer";

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

/**
 * A package page is only useful when its README exists and the package's own `files` list carries
 * it. Packages without an explicit list use npm's default inclusion rules, so existence is enough
 * for them. This stays manifest-based; `unresolvableTarballImports` proves the packed contract.
 */
export function missingPackageReadmes(
  packages: readonly IPublishPackage[],
): readonly IPublishFinding[] {
  const findings: IPublishFinding[] = [];
  for (const item of packages) {
    const readme = path.join(item.directory, "README.md");
    if (!fs.existsSync(readme)) {
      findings.push({
        detail: `${item.name} is missing README.md, so its npm page would have no package documentation.`,
        package: item.name,
        severity: "fail",
      });
      continue;
    }

    const parsed = JSON.parse(fs.readFileSync(item.manifest, "utf8")) as { files?: unknown };
    if (parsed.files === undefined) continue;
    if (!Array.isArray(parsed.files) || !parsed.files.every((entry) => typeof entry === "string"))
      throw new Error(`TN_PUBLISH_FILES_MALFORMED: ${item.manifest} has a non-string files list.`);
    if (parsed.files.includes("README.md")) continue;
    findings.push({
      detail: `${item.name} has a files list ${JSON.stringify(parsed.files)} that does not include README.md, so npm would omit it.`,
      package: item.name,
      severity: "fail",
    });
  }
  return findings;
}

function versionParts(version: string): readonly number[] {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some(Number.isNaN))
    throw new Error(`TN_PUBLISH_VERSION_MALFORMED: '${version}' is not a three-part version.`);
  return parts;
}

function compareVersions(left: string, right: string): number {
  const [a, b] = [versionParts(left), versionParts(right)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Whether a version satisfies a range, for the comparator forms this repository actually writes:
 * `>=X <Y`, `^X`, `~X`, `X` and `*`. Anything else is refused rather than guessed at — a range
 * this cannot read is a range nobody should be relying on a preflight to check.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const trimmed = range.trim();
  if (trimmed === "*" || trimmed === "") return true;
  if (/^\d+\.\d+\.\d+$/u.test(trimmed)) return compareVersions(version, trimmed) === 0;
  if (/^[\^~]\d+\.\d+\.\d+$/u.test(trimmed)) {
    const floor = trimmed.slice(1);
    const [major, minor] = versionParts(floor);
    if (compareVersions(version, floor) < 0) return false;
    const [candidateMajor, candidateMinor] = versionParts(version);
    // npm's caret is special below 1.0.0: ^0.2.0 means >=0.2.0 <0.3.0, not <1.0.0, because a
    // 0.x minor bump is treated as breaking. Getting this wrong would let the preflight bless a
    // range that npm then refuses at install time — the exact failure it exists to prevent.
    if (trimmed.startsWith("^"))
      return major === 0
        ? candidateMajor === 0 && candidateMinor === minor
        : candidateMajor === major;
    return candidateMajor === major && candidateMinor === minor;
  }
  const comparators = trimmed.split(/\s+/u);
  if (!comparators.every((item) => /^(?:>=|<=|>|<|=)\d+\.\d+\.\d+$/u.test(item)))
    throw new Error(
      `TN_PUBLISH_RANGE_UNREADABLE: '${range}' uses a form this preflight cannot evaluate. Rewrite it as >=X <Y, ^X, ~X or an exact version.`,
    );
  return comparators.every((item) => {
    const operator = /^(?:>=|<=|>|<|=)/u.exec(item)?.[0] ?? "=";
    const bound = item.slice(operator.length);
    const order = compareVersions(version, bound);
    if (operator === ">=") return order >= 0;
    if (operator === "<=") return order <= 0;
    if (operator === ">") return order > 0;
    if (operator === "<") return order < 0;
    return order === 0;
  });
}

/**
 * A peer range on a sibling package must admit the version that sibling is about to publish.
 *
 * `@threenative/physics@0.2.0` and `@threenative/ui@0.2.0` shipped declaring
 * `@threenative/core@">=0.1.0 <0.2.0"` — a range excluding the core released beside them — so
 * `npm install` in a scaffolded project failed with ERESOLVE and no project could be built. The
 * range is hand-maintained and had to move with the release; nothing made it.
 */
export function staleInternalPeerRanges(
  packages: readonly IPublishPackage[],
): readonly IPublishFinding[] {
  const versions = new Map(packages.map((item) => [item.name, item.version]));
  const findings: IPublishFinding[] = [];
  for (const item of packages) {
    const manifest = JSON.parse(fs.readFileSync(item.manifest, "utf8")) as {
      peerDependencies?: Record<string, string>;
    };
    for (const [dependency, range] of Object.entries(manifest.peerDependencies ?? {})) {
      const sibling = versions.get(dependency);
      if (sibling === undefined) continue;
      if (satisfiesRange(sibling, range)) continue;
      findings.push({
        detail: `${item.name} declares peer ${dependency}@'${range}', which excludes the ${sibling} being published beside it. Installing both fails with ERESOLVE.`,
        package: item.name,
        severity: "fail",
      });
    }
  }
  return findings;
}

/**
 * A packed tarball is what a stranger actually installs. `files` lists are hand-maintained and
 * drift from the imports the scripts really make: HEAD ships `package-android.mjs`, which imports
 * `./asset-preflight.mjs`, and that file is not in the list — so `build --target android` from a
 * published install dies `ERR_MODULE_NOT_FOUND` before it reaches a single fetch. Nothing in the
 * workspace can see that, because in the workspace the file is simply there.
 */
export interface ITarballContents {
  /** Every shipped path, relative to the package root. */
  readonly entries: readonly string[];
  /** Contents of the shipped paths these gates read; binary and asset entries are not read. */
  readonly text: ReadonlyMap<string, string>;
}

export type TarballReader = (item: IPublishPackage) => ITarballContents;

const READABLE = /\.(?:mjs|cjs|js|json)$/u;

/** Packs a package exactly as `pnpm publish` would and reads back what came out. */
export function pnpmPackReader(): TarballReader {
  return (item) => {
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), "threenative-pack-"));
    try {
      execFileSync("pnpm", ["pack", "--pack-destination", destination], {
        cwd: item.directory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const packed = fs.readdirSync(destination).filter((name) => name.endsWith(".tgz"));
      if (packed.length !== 1)
        throw new Error(
          `TN_PUBLISH_PACK_FAILED: packing ${item.name} produced ${packed.length} tarball(s); expected exactly one.`,
        );
      const extracted = path.join(destination, "extracted");
      fs.mkdirSync(extracted);
      execFileSync("tar", ["-xzf", path.join(destination, packed[0] as string), "-C", extracted], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return readPackageTree(path.join(extracted, "package"));
    } finally {
      fs.rmSync(destination, { force: true, recursive: true });
    }
  };
}

function readPackageTree(root: string): ITarballContents {
  const entries: string[] = [];
  const text = new Map<string, string>();
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      entries.push(relative);
      if (READABLE.test(relative)) text.set(relative, fs.readFileSync(absolute, "utf8"));
    }
  };
  walk(root);
  return { entries: entries.sort(), text };
}

/**
 * `pnpm pack` rewrites `catalog:` and `workspace:` into real ranges; `npm pack` does not, and the
 * tarball it produces installs nowhere — `EUNSUPPORTEDPROTOCOL` on the stranger's machine and
 * nowhere else. CI only ever runs `pnpm -r publish`, so this cannot detect a policy breach in
 * advance; it makes one visible in the artifact instead of in a user's install log.
 */
export function unresolvedTarballSpecifiers(
  item: IPublishPackage,
  contents: ITarballContents,
): readonly IPublishFinding[] {
  const manifest = contents.text.get("package.json");
  if (manifest === undefined)
    return [
      {
        detail: `${item.name} packs a tarball with no package.json, so what it would publish cannot be read.`,
        package: item.name,
        severity: "blocked",
      },
    ];
  const parsed = JSON.parse(manifest) as Record<string, unknown>;
  const findings: IPublishFinding[] = [];
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const block = parsed[field];
    if (typeof block !== "object" || block === null) continue;
    for (const [dependency, specifier] of Object.entries(block as Record<string, unknown>))
      if (typeof specifier === "string" && UNRESOLVED.test(specifier))
        findings.push({
          detail: `${item.name} packs ${field}.${dependency} as '${specifier}', a workspace protocol npm cannot install. The tarball was not produced by \`pnpm pack\`.`,
          package: item.name,
          severity: "fail",
        });
  }
  return findings;
}

/**
 * Relative specifiers a shipped script imports. Parsed rather than pattern-matched: this file's
 * first draft used regexes and reported `./game.js` as missing from the runtime-native tarball,
 * because `profile-production.mjs` writes that import *into a generated bundle* as a string. A
 * gate whose failures are half fiction gets suppressed rather than fixed.
 *
 * Dynamic forms count. `profile-production.mjs` reaches `../../../scripts/gate-records.mjs` from
 * under a CLI guard; that still fails on an installed copy, just later and further from the cause.
 */
export async function relativeSpecifiers(file: string, source: string): Promise<readonly string[]> {
  await init;
  let parsed: ReturnType<typeof parse>[0];
  try {
    [parsed] = parse(source, file);
  } catch (error) {
    throw new Error(
      `TN_PUBLISH_MODULE_UNREADABLE: ${file} is shipped but could not be parsed as a module, so its imports cannot be checked: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const found = new Set<string>();
  for (const item of parsed) if (item.n?.startsWith(".") === true) found.add(item.n);
  return [...found].sort();
}

/** Every relative import of every shipped script must resolve to something else that shipped. */
export async function unresolvableTarballImports(
  item: IPublishPackage,
  contents: ITarballContents,
): Promise<readonly IPublishFinding[]> {
  const shipped = new Set(contents.entries);
  const findings: IPublishFinding[] = [];
  for (const [file, source] of contents.text) {
    if (file.endsWith(".json")) continue;
    for (const specifier of await relativeSpecifiers(file, source)) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      if (shipped.has(resolved)) continue;
      findings.push({
        detail: `${item.name} ships ${file}, which imports '${specifier}', but ${resolved} is not in the tarball. Loading it fails ERR_MODULE_NOT_FOUND on an installed copy.`,
        package: item.name,
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
  readonly tarballs?: TarballReader;
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

export async function checkPublishState(
  options: ICheckPublishOptions = {},
): Promise<IPublishReport> {
  const repo = options.repo ?? REPO;
  const lookup = options.lookup ?? npmLookup(repo);
  const commits = options.sourceCommits ?? gitSourceCommits(repo);
  const packages = publishSet(repo);
  const findings: IPublishFinding[] = [];
  for (const item of packages) {
    const finding = versionFinding(item, lookup(item.name), commits);
    if (finding !== undefined) findings.push(finding);
  }
  findings.push(...missingPackageReadmes(packages));
  findings.push(...staleInternalPeerRanges(packages));
  findings.push(...missingFromReleaseWorkflow(repo, packages));
  findings.push(...unresolvedTemplateSpecifiers(repo));
  const readTarball = options.tarballs ?? pnpmPackReader();
  for (const item of packages) {
    const contents = readTarball(item);
    findings.push(...unresolvedTarballSpecifiers(item, contents));
    findings.push(...(await unresolvableTarballImports(item, contents)));
  }
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

async function main(): Promise<void> {
  const report = await checkPublishState();
  process.stdout.write(formatPublishReport(report));
  process.exitCode = report.exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    // A question this preflight could not answer is never a pass; 2 is the blocked rank.
    process.exitCode = 2;
  });
