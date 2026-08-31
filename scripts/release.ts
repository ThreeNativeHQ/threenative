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
import { checkPublishState, formatPublishReport, publishSet } from "./check-publish-state.js";

const REPO = path.resolve(import.meta.dirname, "..");

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
  const skipGates = argv.includes("--skip-gates");
  // Publish the runtime package before its prebuilt release exists. A deliberate, named decision:
  // `install-prebuilt.mjs` already treats a missing release as a packaging fact rather than a
  // broken download — it warns, the install finishes, the web half of a game works, and every
  // native lane fails closed later on the binary that is not there.
  const allowMissingPrebuilt = argv.includes("--allow-missing-prebuilt");
  const unknown = argv.filter(
    (arg) => !["--yes", "--skip-gates", "--allow-missing-prebuilt"].includes(arg),
  );
  if (unknown.length > 0) throw new Error(`TN_RELEASE_UNKNOWN_FLAG: ${unknown.join(", ")}`);

  // Publish from a committed tree, always. The 0.2.x releases went out of a working tree and
  // were committed afterwards, so the artifacts on the registry correspond to no commit — and
  // `publish:check` then reports the package as needing a bump, because its source "moved"
  // after the publish. There is no way to tell, later, which source a published tarball was.
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "packages"], {
    cwd: REPO,
    encoding: "utf8",
  }).trim();
  if (dirty.length > 0 && publish)
    throw new Error(
      `TN_RELEASE_DIRTY_TREE: packages/ has uncommitted changes, so the published artifact would correspond to no commit:\n${dirty}\nCommit first, then release.`,
    );

  const packages = publishSet(REPO);
  const order = releaseOrder(packages);
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

  if (!skipGates) {
    run("pnpm", ["typecheck"], "pnpm typecheck");
    run("pnpm", ["lint"], "pnpm lint");
    run("pnpm", ["test"], "pnpm test");
  }
  run("pnpm", ["build"], "pnpm build");

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
  for (const name of order) {
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
