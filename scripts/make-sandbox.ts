/**
 * Build a sandbox that behaves like a user's machine with ThreeNative installed from npm.
 *
 * The point is context, not packaging. An agent working inside the monorepo can read
 * `packages/*\/src`, `docs/`, every `AGENTS.md` and the charter, and it does — measurably,
 * before writing a line of game code. A user's agent can read none of that: the packages
 * ship `files: ["dist"]`, so the source simply is not on disk.
 *
 * So we pack the packages into tarballs, scaffold outside the monorepo, and install. The
 * sandbox must live outside this repo or it inherits the `AGENTS.md` chain and the pnpm
 * workspace, which is the whole thing we are removing.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = ["core", "physics", "ui", "playtest"] as const;

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function readFlag(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value ?? fallback;
}

function main(): void {
  const out = path.resolve(REPO, readFlag("--out", "../threenative-sandbox"));
  const template = readFlag("--template", "starter");

  if (out.startsWith(`${REPO}${path.sep}`)) {
    throw new Error(
      `Sandbox must live outside the repo, got ${out}. Inside it, the agent inherits every AGENTS.md up to the root plus the pnpm workspace — the bloat this removes.`,
    );
  }
  // The scaffolder refuses a non-empty target, so the tarballs stage in a sibling.
  const staging = `${out}-packages`;
  for (const dir of [out, staging]) if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  fs.mkdirSync(staging, { recursive: true });

  run("pnpm", ["--filter", "./packages/**", "build"], REPO);

  const tarballs: Record<string, string> = {};
  for (const name of [...PACKAGES, "create-threenative"]) {
    run(
      "pnpm",
      ["--filter", `./packages/${name}`, "exec", "pnpm", "pack", "--pack-destination", staging],
      REPO,
    );
  }
  for (const file of fs.readdirSync(staging)) {
    const owner = [...PACKAGES].find((name) => file.startsWith(`threenative-${name}-`));
    if (owner !== undefined) tarballs[owner] = path.join(staging, file);
  }

  const missing = PACKAGES.filter((name) => tarballs[name] === undefined);
  if (missing.length > 0)
    throw new Error(`pnpm pack produced no tarball for: ${missing.join(", ")}`);

  const scaffold = [
    "node",
    path.join(REPO, "packages/create-threenative/dist/index.js"),
    "<target>",
    "--template",
    template,
    ...PACKAGES.flatMap((name) => [`--${name}-package`, tarballs[name] as string]),
  ];

  // --bare leaves the scaffolding to the agent, so the run starts the way a user's does.
  const bare = process.argv.includes("--bare");
  let next: string;
  if (bare) {
    fs.mkdirSync(out, { recursive: true });
    const reference = path.resolve(REPO, readFlag("--reference", "examples/REFERENCE.png"));
    if (fs.existsSync(reference))
      fs.copyFileSync(reference, path.join(out, path.basename(reference)));
    // The scaffold invocation is 400 characters of tarball paths. Nobody types that.
    const script = path.join(out, "scaffold.sh");
    fs.writeFileSync(
      script,
      `#!/bin/sh\nset -e\n${scaffold.join(" ").replace("<target>", '"${1:-game}"')}\n`,
    );
    fs.chmodSync(script, 0o755);
    next = "./scaffold.sh my-game";
  } else {
    run(scaffold[0] as string, [...scaffold.slice(1, 2), out, ...scaffold.slice(3)], REPO);
    next = `cd ${out} && pnpm dev`;
  }

  process.stdout.write(
    [
      "",
      `${bare ? "bare sandbox ready" : "sandbox ready"}: ${out}`,
      "",
      "  framework source on disk: none — packages ship dist, so only .d.ts is readable",
      "  CHARTER.md, docs/, PRDs, budgets, LOC classifier: not present",
      `  AGENTS.md in scope: ${bare ? "0 until it scaffolds" : "1 (the generated one)"}`,
      "",
      `  run from ${out}:`,
      `  ${next}`,
      "",
      "Rebuild it after any framework change — the tarballs are a snapshot, not a link.",
      "",
    ].join("\n"),
  );
}

main();
