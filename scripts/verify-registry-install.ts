#!/usr/bin/env tsx
/**
 * The clean-room gate: install ThreeNative the way a stranger does, from the public registry.
 *
 * No other gate in this repository exercises that path. `scripts/verify-golden-path.ts` resolves
 * `file:` tarballs *by design* — that is what makes it a packed-artifact gate — and the sandbox,
 * the sweeps and every consumer proof to date do the same. So the repository's own harness has
 * never once noticed that `create-threenative` 404s for every person on earth.
 *
 * The assertion that separates this from the packed gate is the **lockfile**: zero `file:` and
 * zero `link:` specifiers. A run that silently resolved back to this workspace would otherwise
 * look identical to a run that worked, which is the manufactured-evidence failure this repository
 * fails builds over.
 *
 * Fail closed: a step that does not run is a failure, not a skip. There is no flag that turns one
 * into a pass.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** `link:` is pnpm's workspace link; `file:` is a local tarball or directory. Neither ships. */
const LOCAL_SPECIFIER = /(?:^|["'\s:])(?:file|link):/mu;

export const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"] as const;

export interface IRegistryInstallStep {
  readonly detail: string;
  readonly name: string;
  readonly ok: boolean;
}

export interface IRegistryInstallReport {
  readonly exitCode: 0 | 1;
  readonly steps: readonly IRegistryInstallStep[];
}

/**
 * A lockfile naming a local path means the install fell back to this machine. It is the one
 * observation that distinguishes "installed from the registry" from "looked like it did".
 */
export function assertNoLocalSpecifiers(lockfile: string, contents: string): void {
  const offenders = contents
    .split(/\r?\n/u)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter((entry) => LOCAL_SPECIFIER.test(entry.line));
  if (offenders.length > 0)
    throw new Error(
      `TN_REGISTRY_INSTALL_LOCAL_SPECIFIER: ${lockfile} resolves ${offenders.length} dependency(s) from this machine rather than the registry. First: line ${offenders[0]?.number}: ${offenders[0]?.line}`,
    );
}

/**
 * Refuses to report on a project with no lockfile. An install that produced none did not run, and
 * "no lockfile, no offenders, therefore pass" is exactly the vacuous green this gate exists to
 * prevent.
 */
export function checkLockfile(project: string): string {
  const found = LOCKFILES.map((name) => path.join(project, name)).filter((file) =>
    fs.existsSync(file),
  );
  if (found.length === 0)
    throw new Error(
      `TN_REGISTRY_INSTALL_NO_LOCKFILE: ${project} has none of ${LOCKFILES.join(", ")}, so the install cannot be shown to have come from the registry.`,
    );
  for (const file of found)
    assertNoLocalSpecifiers(path.basename(file), fs.readFileSync(file, "utf8"));
  return found.map((file) => path.basename(file)).join(", ");
}

export type CommandRunner = (command: string, args: readonly string[], cwd: string) => string;

export function realRunner(env: NodeJS.ProcessEnv): CommandRunner {
  return (command, args, cwd) =>
    execFileSync(command, [...args], {
      cwd,
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 900_000,
    });
}

export interface IVerifyRegistryInstallOptions {
  /** Where the clean room is created. Must have no workspace above it. */
  readonly parent?: string;
  readonly run?: CommandRunner;
  readonly template?: string;
}

function step(name: string, work: () => string): IRegistryInstallStep {
  try {
    return { detail: work().trim().slice(-400) || "(no output)", name, ok: true };
  } catch (error) {
    return { detail: error instanceof Error ? error.message : String(error), name, ok: false };
  }
}

export function verifyRegistryInstall(
  options: IVerifyRegistryInstallOptions = {},
): IRegistryInstallReport {
  const template = options.template ?? "starter";
  // A private cache and a private store, so a package cached from an earlier workspace install
  // cannot stand in for one the registry would have refused to serve.
  const parent = fs.mkdtempSync(
    path.join(options.parent ?? os.tmpdir(), "threenative-clean-room-"),
  );
  const cache = path.join(parent, "npm-cache");
  fs.mkdirSync(cache, { recursive: true });
  const project = path.join(parent, "my-game");
  const run =
    options.run ?? realRunner({ ...process.env, NPM_CONFIG_CACHE: cache, npm_config_cache: cache });
  const steps: IRegistryInstallStep[] = [];
  try {
    steps.push(
      step("scaffold", () =>
        run(
          "npm",
          ["create", "threenative@latest", "my-game", "--", "--template", template],
          parent,
        ),
      ),
    );
    if (steps[0]?.ok === true) {
      steps.push(step("install", () => run("npm", ["install"], project)));
      steps.push(step("lockfile", () => `Checked ${checkLockfile(project)}; no file: or link:.`));
      steps.push(step("build", () => run("npm", ["run", "build"], project)));
      steps.push(step("test", () => run("npm", ["test"], project)));
    } else {
      for (const name of ["install", "lockfile", "build", "test"])
        steps.push({
          detail: "Not run: the scaffold step never produced a project.",
          name,
          ok: false,
        });
    }
  } finally {
    fs.rmSync(parent, { force: true, recursive: true });
  }
  return { exitCode: steps.every((item) => item.ok) ? 0 : 1, steps };
}

function main(): void {
  const report = verifyRegistryInstall();
  for (const item of report.steps)
    process.stdout.write(`${item.ok ? "pass" : "FAIL"}  ${item.name}\n      ${item.detail}\n`);
  process.stdout.write(
    report.exitCode === 0
      ? "A stranger can install ThreeNative from the registry and build a game.\n"
      : "The registry install path is broken. This is alpha row A1.\n",
  );
  process.exitCode = report.exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
