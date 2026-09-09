#!/usr/bin/env tsx
/**
 * `pnpm release` — one command that publishes the workspace, in the order that works.
 *
 * The 0.2.0 release took four publishes instead of one, and three of the four mistakes were
 * mechanical:
 *
 *  - `create-threenative` went out second, but its templates pin every other package, so it
 *    shipped pins to a `@threenative/physics` that was repaired minutes later. **Order matters,
 *    and it is not alphabetical.** This publishes in dependency order and puts the scaffolder
 *    last, always.
 *  - `@threenative/physics` and `@threenative/ui` shipped a peer range excluding the core beside
 *    them, so `npm install` died with ERESOLVE. `pnpm publish:check` catches that now, but only
 *    if somebody remembers to run it. This runs it, and refuses to publish when it is red.
 *  - The published CLI was a no-op and nothing noticed until a human tried it. This ends by
 *    installing from the registry in a clean room, so the run tells you whether what you shipped
 *    actually works.
 *
 * Dry by default. `--yes` is the only thing that publishes, because the one action here cannot
 * be undone: npm versions are immutable, and a broken publish can be deprecated but never
 * replaced.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MCP_SERVERS } from "../packages/core/mcp/servers.mjs";
import {
  type ICheckPublishOptions,
  type IPublishPackage,
  type RegistryLookup,
  checkPublishState,
  formatPublishReport,
  npmLookup,
  publishSet,
} from "./check-publish-state.js";

const REPO = path.resolve(import.meta.dirname, "..");

export interface IReleaseCohort {
  readonly bundledMcpServers: readonly string[];
  readonly order: readonly string[];
  readonly templatePins: readonly string[];
  readonly versions: ReadonlyMap<string, string>;
}

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

/** Validate the structural identity of one candidate before any registry or publish command runs. */
export function validateTemplatePins(
  templateRoot: string,
  versions: ReadonlyMap<string, string>,
): readonly string[] {
  if (!fs.existsSync(templateRoot)) return [];
  const findings: string[] = [];
  for (const entry of fs.readdirSync(templateRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join(templateRoot, entry.name, "package.json");
    if (!fs.existsSync(manifest)) continue;
    const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as Record<string, unknown>;
    for (const field of DEPENDENCY_FIELDS) {
      const block = parsed[field];
      if (typeof block !== "object" || block === null || Array.isArray(block)) continue;
      for (const [dependency, specifier] of Object.entries(block as Record<string, unknown>)) {
        const candidate = versions.get(dependency);
        if (candidate === undefined || specifier === candidate) continue;
        findings.push(
          `templates/${entry.name}/package.json ${field}.${dependency} pins '${String(specifier)}', but the candidate cohort carries '${candidate}'.`,
        );
      }
    }
  }
  return findings;
}

/** The release must carry the shims and the two bundled servers the public MCP table advertises. */
export function validateReleaseCohort(repo = REPO, packages = publishSet(repo)): IReleaseCohort {
  const versions = new Map(packages.map((item) => [item.name, item.version]));
  if (versions.size !== packages.length)
    throw new Error(
      "TN_RELEASE_COHORT_DUPLICATE: the publish set contains a duplicate package name.",
    );
  for (const [name, version] of versions) {
    if (!/^\d+\.\d+\.\d+$/u.test(version))
      throw new Error(`TN_RELEASE_COHORT_VERSION: ${name} has candidate version '${version}'.`);
  }
  const pinFindings = validateTemplatePins(
    path.join(repo, "packages", "create-threenative", "templates"),
    versions,
  );
  if (pinFindings.length > 0)
    throw new Error(`TN_RELEASE_COHORT_TEMPLATE_PINS: ${pinFindings.join(" | ")}`);

  const core = packages.find((item) => item.name === "@threenative/core");
  if (core === undefined)
    throw new Error("TN_RELEASE_COHORT_CORE_MISSING: @threenative/core is not in the publish set.");
  const coreMcp = path.join(core.directory, "mcp");
  const requiredBundles = ["engine-server.mjs", "blender-server.mjs"];
  for (const bundle of requiredBundles) {
    const file = path.join(coreMcp, bundle);
    if (!fs.existsSync(file) || fs.statSync(file).size === 0)
      throw new Error(`TN_RELEASE_COHORT_MCP_BUNDLE: ${file} is missing or empty.`);
  }
  const bundledMcpServers = Object.keys(MCP_SERVERS);
  if (bundledMcpServers.length === 0)
    throw new Error("TN_RELEASE_COHORT_MCP_TABLE: the public MCP table is empty.");
  return {
    bundledMcpServers,
    order: releaseOrder(packages),
    templatePins: pinFindings,
    versions,
  };
}

export interface IPrepareReleaseCohortOptions
  extends Pick<
    ICheckPublishOptions,
    | "allowCurrentPublishSetPins"
    | "allowMissingPrebuilt"
    | "lookup"
    | "prebuiltProbe"
    | "sourceCommits"
    | "tarballs"
  > {
  readonly repo?: string;
}

/** Run the immutable-version preflight against the exact structural cohort; never publishes. */
export async function prepareReleaseCohort(
  options: IPrepareReleaseCohortOptions = {},
): Promise<IReleaseCohort> {
  const repo = options.repo ?? REPO;
  const packages = publishSet(repo);
  const cohort = validateReleaseCohort(repo, packages);
  const report = await checkPublishState({ ...options, repo });
  if (report.exitCode !== 0)
    throw new Error(`TN_RELEASE_COHORT_RED: ${formatPublishReport(report).trim()}`);
  return cohort;
}

/**
 * Dependency order: a package goes out after everything it depends on.
 *
 * The instinct was "publish the scaffolder last, because its templates pin everything else". That
 * is not available in general — a package that depends on `create-threenative` gives the scaffolder
 * a dependent, so it cannot be last. Studio was that package until it moved to its own repository;
 * the ordering test keeps the case covered so the instinct cannot come back.
 *
 * What actually prevents the 0.2.0 mistake is not the order but publishing **one consistent
 * tree in one run**: the pins in `create-threenative`'s templates and the versions of the
 * packages they name come from the same working tree, so they cannot disagree the way they did
 * when the scaffolder was published on its own and its dependencies were repaired afterwards.
 */
export function releaseOrder(packages: readonly { name: string; manifest: string }[]): string[] {
  const names = new Set(packages.map((item) => item.name));
  const dependencies = new Map<string, Set<string>>();
  for (const item of packages) {
    const manifest = JSON.parse(fs.readFileSync(item.manifest, "utf8")) as Record<string, unknown>;
    const internal = new Set<string>();
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      const block = manifest[field];
      if (typeof block !== "object" || block === null) continue;
      for (const dependency of Object.keys(block as Record<string, unknown>))
        if (names.has(dependency) && dependency !== item.name) internal.add(dependency);
    }
    dependencies.set(item.name, internal);
  }
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visit = (name: string): void => {
    if (ordered.includes(name)) return;
    if (visiting.has(name))
      throw new Error(
        `TN_RELEASE_DEPENDENCY_CYCLE: ${[...visiting, name].join(" -> ")}. Publish order is undefined.`,
      );
    visiting.add(name);
    for (const dependency of dependencies.get(name) ?? []) visit(dependency);
    visiting.delete(name);
    ordered.push(name);
  };
  for (const item of packages) visit(item.name);
  return ordered;
}

function run(command: string, args: readonly string[], label: string): void {
  process.stdout.write(`\n▸ ${label}\n`);
  try {
    execFileSync(command, [...args], { cwd: REPO, stdio: "inherit" });
  } catch {
    throw new Error(`TN_RELEASE_STEP_FAILED: ${label}. Nothing further was published.`);
  }
}

/** Refuse to publish artifacts produced from package files that are not in the commit. */
export function assertCleanPackageTree(repo = REPO): void {
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "packages"], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
  if (dirty.length > 0)
    throw new Error(
      `TN_RELEASE_DIRTY_TREE: packages/ has uncommitted changes, so the published artifact would correspond to no commit:\n${dirty}\nCommit first, then release.`,
    );
}

/** Publish only a complete candidate cohort whose exact versions are absent from npm. */
export function unpublishedReleasePackages(
  packages: readonly IPublishPackage[],
  lookup: RegistryLookup,
): readonly IPublishPackage[] {
  const states = packages.map((item) => {
    let facts: ReturnType<RegistryLookup>;
    try {
      facts = lookup(item.name, item.version);
    } catch (error) {
      throw new Error(
        `TN_RELEASE_REGISTRY_LOOKUP: could not determine whether ${item.name}@${item.version} exists: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (facts.state === "unreachable")
      throw new Error(
        `TN_RELEASE_REGISTRY_UNREACHABLE: could not determine whether ${item.name}@${item.version} exists. Nothing will be published.`,
      );
    return { facts, item };
  });
  const present = states.filter(({ facts }) => facts.state === "present");
  if (present.length > 0) {
    const state = states
      .map(({ facts, item }) => `${item.name}@${item.version}=${facts.state}`)
      .join(", ");
    const code =
      present.length === states.length
        ? "TN_RELEASE_COHORT_ALREADY_PUBLISHED"
        : "TN_RELEASE_COHORT_PARTIAL";
    throw new Error(
      `${code}: the exact candidate cohort is ${state}. Refusing to republish an existing version or publish only part of a cohort.`,
    );
  }
  return states.map(({ item }) => item);
}

async function waitForRegistry(name: string, version: string): Promise<void> {
  // A brand-new scoped package is not readable the instant it is published, and publishing the
  // scaffolder before its dependencies are visible produces an install nobody can reproduce.
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}`);
      if (response.ok) {
        const body = (await response.json()) as { versions?: Record<string, unknown> };
        if (body.versions?.[version] !== undefined) return;
      }
    } catch {
      // Not visible yet; the deadline is the only thing that ends this loop.
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(
    `TN_RELEASE_NOT_VISIBLE: ${name}@${version} did not become readable on the registry within 180s. Later packages would pin a version their consumers cannot resolve.`,
  );
}

async function packReleaseSet(packages: readonly { name: string }[]): Promise<void> {
  const destination = await mkdtemp(path.join(os.tmpdir(), "threenative-release-pack-"));
  try {
    for (const { name } of packages) {
      run("pnpm", ["--filter", name, "pack", "--pack-destination", destination], `pack ${name}`);
    }
  } finally {
    await rm(destination, { force: true, recursive: true });
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const publish = argv.includes("--yes");
  const prepare = argv.includes("--prepare");
  const skipGates = argv.includes("--skip-gates");
  // Publish the runtime package before its prebuilt release exists. A deliberate, named decision:
  // `install-prebuilt.mjs` already treats a missing release as a packaging fact rather than a
  // broken download — it warns, the install finishes, the web half of a game works, and every
  // native lane fails closed later on the binary that is not there.
  const allowMissingPrebuilt = argv.includes("--allow-missing-prebuilt");
  const unknown = argv.filter(
    (arg) => !["--yes", "--prepare", "--skip-gates", "--allow-missing-prebuilt"].includes(arg),
  );
  if (unknown.length > 0) throw new Error(`TN_RELEASE_UNKNOWN_FLAG: ${unknown.join(", ")}`);

  // Publish from a committed tree, always. The 0.2.x releases went out of a working tree and
  // were committed afterwards, so the artifacts on the registry correspond to no commit — and
  // `publish:check` then reports the package as needing a bump, because its source "moved"
  // after the publish. There is no way to tell, later, which source a published tarball was.
  if (publish) assertCleanPackageTree(REPO);

  const packages = publishSet(REPO);
  const cohort = validateReleaseCohort(REPO, packages);
  const order = [...cohort.order];
  const versions = new Map(packages.map((item) => [item.name, item.version]));

  process.stdout.write("Release order:\n");
  for (const [index, name] of order.entries())
    process.stdout.write(`  ${index + 1}. ${name}@${versions.get(name)}\n`);

  const report = await checkPublishState({
    allowCurrentPublishSetPins: true,
    allowMissingPrebuilt,
    repo: REPO,
  });
  process.stdout.write(`\n${formatPublishReport(report)}`);
  if (report.exitCode !== 0)
    throw new Error("TN_RELEASE_PREFLIGHT_RED: pnpm publish:check refused this tree.");

  if (prepare) {
    process.stdout.write(
      `\nPrepared candidate cohort at ${execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: REPO,
        encoding: "utf8",
      }).trim()}: ${cohort.bundledMcpServers.length} MCP server(s), ${packages.length} package(s). Nothing was published.\n`,
    );
    return;
  }

  if (!skipGates) {
    run("pnpm", ["typecheck"], "pnpm typecheck");
    run("pnpm", ["lint"], "pnpm lint");
    run("pnpm", ["test"], "pnpm test");
  }
  run("pnpm", ["build"], "pnpm build");

  if (publish) {
    assertCleanPackageTree(REPO);
    const postBuildReport = await checkPublishState({
      allowCurrentPublishSetPins: true,
      allowMissingPrebuilt,
      repo: REPO,
    });
    process.stdout.write(
      `\nPost-build publish preflight:\n${formatPublishReport(postBuildReport)}`,
    );
    if (postBuildReport.exitCode !== 0)
      throw new Error("TN_RELEASE_POST_BUILD_PREFLIGHT_RED: the built tree is not publishable.");
  }

  if (!publish) {
    await packReleaseSet(packages);
    process.stdout.write(
      "\nDry run packed every publishable package. Nothing was published. Re-run with --yes to publish, which cannot be undone.\n",
    );
    return;
  }

  // `--provenance` asks npm to attest where the tarball was built, which it can only do from a
  // CI runner with an OIDC token. Passing it from a workstation fails the publish outright, so a
  // local release drops the flag and says so rather than dying on it. The attestation is a
  // property of where the release ran, not of the artifact's correctness — a locally published
  // version is a real version, it simply carries no provenance statement.
  const attestable = process.env.GITHUB_ACTIONS === "true";
  if (!attestable) {
    process.stdout.write(
      "\nPublishing without --provenance: npm can only attest a build from CI, and this is not CI.\n",
    );
  }
  const publishPackages = unpublishedReleasePackages(packages, npmLookup(REPO));
  const publishNames = new Set(publishPackages.map((item) => item.name));
  for (const name of order) {
    if (!publishNames.has(name)) continue;
    const version = versions.get(name);
    if (version === undefined) throw new Error(`TN_RELEASE_NO_VERSION: ${name}`);
    run(
      "pnpm",
      [
        "--filter",
        name,
        "publish",
        "--no-git-checks",
        "--access",
        "public",
        ...(attestable ? ["--provenance"] : []),
      ],
      `publish ${name}@${version}`,
    );
    process.stdout.write(`  waiting for ${name}@${version} to be readable…\n`);
    await waitForRegistry(name, version);
  }

  run(
    "pnpm",
    ["tsx", "scripts/verify-registry-install.ts"],
    "clean-room install from the registry",
  );
  process.stdout.write("\nPublished, and installable from the registry.\n");
}

if (import.meta.url === `file://${process.argv[1]}`)
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
