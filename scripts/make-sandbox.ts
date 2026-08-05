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
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = ["core", "physics", "ui", "playtest"] as const;

export interface SweepManifest {
  readonly genre: string;
  readonly briefHash: string;
  readonly template: string;
  readonly date: string;
  readonly frameworkVersion: string;
  readonly sourceLines: number;
}

interface GenreInput {
  readonly brief: string;
  readonly briefHash: string;
  readonly reference: string;
}

export interface SandboxOptions {
  readonly bare?: boolean;
  readonly genre: string;
  readonly out?: string;
  readonly packageTarballs?: Partial<Record<(typeof PACKAGES)[number], string>>;
  readonly prepare?: boolean;
  readonly repo?: string;
  readonly template?: string;
}

export interface SandboxResult {
  readonly manifest: SweepManifest;
  readonly out: string;
}

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

export function readFlag(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
  return value;
}

function isFile(file: string): boolean {
  return fs.existsSync(file) && fs.statSync(file).isFile();
}

function isDirectory(directory: string): boolean {
  return fs.existsSync(directory) && fs.statSync(directory).isDirectory();
}

function assertGenreName(genre: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(genre))
    throw new Error(`Invalid genre '${genre}'; use a lowercase genre slug.`);
}

export function resolveGenre(repo: string, genre: string): GenreInput {
  assertGenreName(genre);
  const directory = path.join(repo, "docs", "benchmark", "genres", genre);
  const brief = path.join(directory, "brief.md");
  if (!isFile(brief)) throw new Error(`Genre '${genre}' is missing its required brief: ${brief}`);
  const reference = path.join(directory, "reference.png");
  if (!isFile(reference))
    throw new Error(`Genre '${genre}' is missing its required reference image: ${reference}`);
  const briefHash = createHash("sha256").update(fs.readFileSync(brief)).digest("hex");
  return { brief, briefHash, reference };
}

export function readManifest(file: string): SweepManifest {
  const value = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<SweepManifest>;
  const required = [
    "genre",
    "briefHash",
    "template",
    "date",
    "frameworkVersion",
    "sourceLines",
  ] as const;
  for (const key of required) {
    if (value[key] === undefined || value[key] === "")
      throw new Error(`Invalid sweep manifest '${file}': missing ${key}.`);
  }
  if (typeof value.genre !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.genre))
    throw new Error(`Invalid sweep manifest '${file}': genre must be a lowercase slug.`);
  if (
    typeof value.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.date)
  )
    throw new Error(`Invalid sweep manifest '${file}': date must be an ISO timestamp.`);
  if (typeof value.sourceLines !== "number" || value.sourceLines < 0)
    throw new Error(`Invalid sweep manifest '${file}': sourceLines must be non-negative.`);
  return value as SweepManifest;
}

function sameRun(left: SweepManifest, right: SweepManifest): boolean {
  return (
    left.genre === right.genre && left.briefHash === right.briefHash && left.date === right.date
  );
}

export function isArchived(manifest: SweepManifest, repo = REPO): boolean {
  if (!isDirectory(path.join(repo, "docs", "benchmark", "sweeps"))) return false;
  for (const entry of fs.readdirSync(path.join(repo, "docs", "benchmark", "sweeps"), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const manifestFile = path.join(repo, "docs", "benchmark", "sweeps", entry.name, "sweep.json");
    if (!isFile(manifestFile)) continue;
    try {
      if (sameRun(readManifest(manifestFile), manifest)) return true;
    } catch {
      // An unrelated malformed archive cannot authorize wiping this run.
    }
  }
  return false;
}

function assertCanWipe(out: string, repo: string): void {
  if (!fs.existsSync(out)) return;
  if (!isDirectory(out)) throw new Error(`Sandbox target '${out}' is not a directory.`);
  const manifestFile = path.join(out, "sweep.json");
  if (!isFile(manifestFile)) return;
  let manifest: SweepManifest;
  try {
    manifest = readManifest(manifestFile);
  } catch (error) {
    throw new Error(
      `Refusing to wipe '${out}': it contains an invalid sweep.json. Archive it or remove it manually. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isArchived(manifest, repo))
    throw new Error(
      `Refusing to wipe unarchived sandbox '${out}'. Run pnpm sweep:archive before starting another sweep.`,
    );
}

function frameworkVersion(repo: string): string {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")) as {
    version?: unknown;
  };
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0)
    throw new Error("Root package.json has no framework version.");
  return packageJson.version;
}

/**
 * How much of the framework an agent in the sandbox can actually read. Not zero: tsup emits
 * sourcemaps with `sourcesContent`, so the original TypeScript rides along inside dist. A
 * published package leaks exactly the same way, so this reports reality rather than hiding it.
 */
export function sourceLines(root: string): number {
  const packages = path.join(root, "node_modules", "@threenative");
  if (!fs.existsSync(packages)) return 0;
  let total = 0;
  for (const pkg of fs.readdirSync(packages)) {
    const dist = path.join(packages, pkg, "dist");
    if (!fs.existsSync(dist)) continue;
    for (const file of fs.readdirSync(dist)) {
      if (!file.endsWith(".map")) continue;
      const map = JSON.parse(fs.readFileSync(path.join(dist, file), "utf8")) as {
        sourcesContent?: (string | null)[];
      };
      for (const content of map.sourcesContent ?? []) total += content?.split("\n").length ?? 0;
    }
  }
  return total;
}

export function makeSandbox(options: SandboxOptions): SandboxResult {
  const repo = path.resolve(options.repo ?? REPO);
  const out = path.resolve(repo, options.out ?? "../threenative-sandbox");
  const genre = options.genre;
  const template = options.template ?? "starter";
  const input = resolveGenre(repo, genre);

  if (out === repo || out.startsWith(`${repo}${path.sep}`)) {
    throw new Error(
      `Sandbox must live outside the repo, got ${out}. Inside it, the agent inherits every AGENTS.md up to the root plus the pnpm workspace — the bloat this removes.`,
    );
  }
  assertCanWipe(out, repo);
  // The scaffolder refuses a non-empty target, so the tarballs stage in a sibling.
  const staging = `${out}-packages`;
  for (const dir of [out, staging]) if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  fs.mkdirSync(staging, { recursive: true });

  const tarballs: Record<string, string> = {};
  if (options.prepare ?? true) {
    run("pnpm", ["--filter", "./packages/**", "build"], repo);
    for (const name of [...PACKAGES, "create-threenative"]) {
      run(
        "pnpm",
        ["--filter", `./packages/${name}`, "exec", "pnpm", "pack", "--pack-destination", staging],
        repo,
      );
    }
    for (const file of fs.readdirSync(staging)) {
      const owner = [...PACKAGES].find((name) => file.startsWith(`threenative-${name}-`));
      if (owner !== undefined) tarballs[owner] = path.join(staging, file);
    }
  } else {
    for (const name of PACKAGES) {
      tarballs[name] = options.packageTarballs?.[name] ?? path.join(staging, `${name}.tgz`);
    }
  }

  const missing = PACKAGES.filter((name) => tarballs[name] === undefined);
  if (missing.length > 0)
    throw new Error(`pnpm pack produced no tarball for: ${missing.join(", ")}`);

  const scaffold = [
    "node",
    path.join(repo, "packages/create-threenative/dist/index.js"),
    "<target>",
    "--template",
    template,
    ...PACKAGES.flatMap((name) => [`--${name}-package`, tarballs[name] as string]),
  ];

  // --bare leaves the scaffolding to the agent, so the run starts the way a user's does.
  const bare = options.bare ?? false;
  let next: string;
  if (bare) {
    fs.mkdirSync(out, { recursive: true });
    fs.copyFileSync(input.brief, path.join(out, "brief.md"));
    fs.copyFileSync(input.reference, path.join(out, "reference.png"));
    // The scaffold invocation is 400 characters of tarball paths. Nobody types that.
    const script = path.join(out, "scaffold.sh");
    fs.writeFileSync(
      script,
      [
        "#!/bin/sh",
        "set -e",
        scaffold.join(" ").replace("<target>", '"${1:-game}"'),
        'cp brief.md "${1:-game}/brief.md"',
        'cp reference.png "${1:-game}/reference.png"',
        'cp sweep.json "${1:-game}/sweep.json"',
        "",
      ].join("\n"),
    );
    fs.chmodSync(script, 0o755);
    next = "./scaffold.sh my-game";
  } else {
    run(scaffold[0] as string, [...scaffold.slice(1, 2), out, ...scaffold.slice(3)], repo);
    fs.copyFileSync(input.brief, path.join(out, "brief.md"));
    fs.copyFileSync(input.reference, path.join(out, "reference.png"));
    next = `cd ${out} && pnpm dev`;
  }

  const leaked = sourceLines(out);
  const manifest: SweepManifest = {
    genre,
    briefHash: input.briefHash,
    template,
    date: new Date().toISOString(),
    frameworkVersion: frameworkVersion(repo),
    sourceLines: leaked,
  };
  fs.writeFileSync(path.join(out, "sweep.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    [
      "",
      `${bare ? "bare sandbox ready" : "sandbox ready"}: ${out}`,
      "",
      leaked === 0
        ? "  framework source readable: 0 lines — dist is types plus bundled js"
        : `  framework source readable: ${leaked} lines, via .js.map sourcesContent (a real
    install leaks the same; set sourcemap: false in the tsup configs to close it)`,
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
  return { manifest, out };
}

function main(): void {
  const genre = readFlag("--genre");
  if (genre === undefined) throw new Error("Missing --genre. Use pnpm sandbox --genre <genre>.");
  makeSandbox({
    bare: process.argv.includes("--bare"),
    genre,
    out: readFlag("--out", "../threenative-sandbox"),
    template: readFlag("--template", "starter"),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
