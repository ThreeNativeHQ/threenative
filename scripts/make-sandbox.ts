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
const PACKAGES = ["core", "physics", "ui", "playtest", "studio"] as const;
const CLI_PACKAGE = "create-threenative";
const ARMS = ["framework", "vanilla"] as const;

type PackageTarball = (typeof PACKAGES)[number] | typeof CLI_PACKAGE;

export type SandboxArm = (typeof ARMS)[number];

export interface SweepManifest {
  readonly arm: SandboxArm;
  readonly genre: string;
  readonly briefHash: string;
  readonly proofHash: string;
  readonly template: string;
  readonly date: string;
  readonly frameworkVersion: string;
  readonly sourceLines: number;
}

interface GenreInput {
  readonly brief: string;
  readonly briefHash: string;
  readonly proofHash: string;
  readonly reference: string;
}

export interface ProofFile {
  readonly absolutePath: string;
  readonly relativePath: string;
}

export interface SandboxOptions {
  readonly arm?: SandboxArm;
  readonly bare?: boolean;
  readonly genre: string;
  readonly out?: string;
  readonly packageTarballs?: Partial<Record<PackageTarball, string>>;
  readonly prepare?: boolean;
  readonly repo?: string;
  readonly install?: boolean;
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

export function assertSandboxArm(arm: string): asserts arm is SandboxArm {
  if (!ARMS.includes(arm as SandboxArm))
    throw new Error(`Invalid sandbox arm '${arm}'; use framework or vanilla.`);
}

function proofDirectory(repo: string, genre: string): string {
  return path.join(repo, "docs", "benchmark", "genres", genre, "proof");
}

function collectProofFiles(directory: string, root = directory): ProofFile[] {
  if (!isDirectory(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectProofFiles(absolutePath, root);
      if (!entry.isFile() || !entry.name.endsWith(".playtest.json")) return [];
      return [
        {
          absolutePath,
          relativePath: path.relative(root, absolutePath).split(path.sep).join("/"),
        },
      ];
    });
}

export function sealedProofFiles(repo: string, genre: string): readonly ProofFile[] {
  assertGenreName(genre);
  const files = collectProofFiles(proofDirectory(repo, genre));
  if (files.length === 0) throw new Error(`Genre '${genre}' has no sealed proof scenarios.`);
  return files;
}

export function hashProofFiles(files: readonly ProofFile[]): string {
  if (files.length === 0) throw new Error("Cannot hash an empty sealed proof set.");
  const hash = createHash("sha256");
  for (const file of [...files].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  )) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(file.absolutePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function sealedProofHash(repo: string, genre: string): string {
  return hashProofFiles(sealedProofFiles(repo, genre));
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
  const proofHash = sealedProofHash(repo, genre);
  return { brief, briefHash, proofHash, reference };
}

export function readManifest(file: string): SweepManifest {
  const value = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<SweepManifest>;
  const required = [
    "arm",
    "genre",
    "briefHash",
    "proofHash",
    "template",
    "date",
    "frameworkVersion",
    "sourceLines",
  ] as const;
  for (const key of required) {
    if (value[key] === undefined || value[key] === "")
      throw new Error(`Invalid sweep manifest '${file}': missing ${key}.`);
  }
  for (const key of ["briefHash", "proofHash", "template", "frameworkVersion"] as const) {
    if (typeof value[key] !== "string" || value[key].trim() === "")
      throw new Error(`Invalid sweep manifest '${file}': ${key} must be a non-empty string.`);
  }
  if (typeof value.arm !== "string")
    throw new Error(`Invalid sweep manifest '${file}': arm must be framework or vanilla.`);
  assertSandboxArm(value.arm);
  if (typeof value.genre !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.genre))
    throw new Error(`Invalid sweep manifest '${file}': genre must be a lowercase slug.`);
  if (
    typeof value.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.date)
  )
    throw new Error(`Invalid sweep manifest '${file}': date must be an ISO timestamp.`);
  if (
    typeof value.sourceLines !== "number" ||
    !Number.isInteger(value.sourceLines) ||
    value.sourceLines < 0
  )
    throw new Error(
      `Invalid sweep manifest '${file}': sourceLines must be a non-negative integer.`,
    );
  return value as SweepManifest;
}

function sameRun(left: SweepManifest, right: SweepManifest): boolean {
  return (
    left.arm === right.arm &&
    left.genre === right.genre &&
    left.briefHash === right.briefHash &&
    left.proofHash === right.proofHash &&
    left.date === right.date
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

/** Mirrors `resolveSandbox` in sweep-archive.ts: the sandbox root, or one game per folder. */
function containsBuiltProject(out: string): boolean {
  if (isDirectory(path.join(out, "src"))) return true;
  return fs
    .readdirSync(out, { withFileTypes: true })
    .some((entry) => entry.isDirectory() && isDirectory(path.join(out, entry.name, "src")));
}

function assertCanWipe(out: string, repo: string): void {
  if (!fs.existsSync(out)) return;
  if (!isDirectory(out)) throw new Error(`Sandbox target '${out}' is not a directory.`);
  const manifestFile = path.join(out, "sweep.json");
  if (!isFile(manifestFile)) return;
  // archiveSandbox refuses a sandbox with no src/ as "not built", so demanding an archive here
  // would strand a sandbox that was created and never scaffolded: neither command could clear
  // it and the next sweep could not start. There is no build to preserve, so nothing is lost.
  //
  // "Built" must be decided the same way archiveSandbox decides it. A sandbox holds one game per
  // folder, so the source is at <sandbox>/<game>/src, not <sandbox>/src. Checking only the root
  // would call every real build "not built" and wipe unarchived game data.
  if (!containsBuiltProject(out)) return;
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

/** Maps a dependency a template declares onto the tarball key that would replace it. */
function tarballKey(dependency: string): PackageTarball | undefined {
  if (dependency === CLI_PACKAGE) return CLI_PACKAGE;
  const scoped = dependency.startsWith("@threenative/")
    ? dependency.slice("@threenative/".length)
    : undefined;
  return ([...PACKAGES] as string[]).includes(scoped ?? "")
    ? (scoped as (typeof PACKAGES)[number])
    : undefined;
}

/**
 * A workspace package the template depends on but the sandbox never packed falls through to the
 * registry at install time. Two of them did, and both 404 there, so `./scaffold.sh` died before
 * the run started. Fail here — with the names — rather than in someone else's `pnpm install`.
 */
export function assertTemplateSourcesCovered(
  repo: string,
  template: string,
  tarballs: Partial<Record<PackageTarball, string>>,
): void {
  const manifestPath = path.join(
    repo,
    "packages/create-threenative/templates",
    template,
    "package.json",
  );
  if (!fs.existsSync(manifestPath)) throw new Error(`Unknown template '${template}'.`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  // optionalDependencies are excluded on purpose: the native runtime is allowed to be absent,
  // and pnpm drops it rather than failing the install.
  const declared = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ];
  const uncovered = declared.filter((dependency) => {
    const key = tarballKey(dependency);
    return key !== undefined && tarballs[key] === undefined;
  });
  if (uncovered.length > 0)
    throw new Error(
      `Template '${template}' depends on workspace packages the sandbox did not pack: ${uncovered.join(", ")}. They are not on the registry, so the scaffold would fail at install.`,
    );
}

function vanillaPackageJson(projectName: string, playtestTarball: string): string {
  return `${JSON.stringify(
    {
      name: projectName,
      private: true,
      type: "module",
      scripts: {
        dev: "vite",
        build: "vite build",
        typecheck: "tsc --noEmit -p tsconfig.json",
      },
      dependencies: {
        "@threenative/playtest": `file:${playtestTarball}`,
        three: "0.185.1",
      },
      devDependencies: {
        "@types/three": "0.185.3",
        playwright: "1.62.1",
        typescript: "5.9.3",
        vite: "8.2.0",
      },
    },
    null,
    2,
  )}\n`;
}

function writeVanillaScaffold(out: string, playtestTarball: string): void {
  const projectName = path
    .basename(out)
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-");
  fs.mkdirSync(path.join(out, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(out, "package.json"),
    vanillaPackageJson(projectName, playtestTarball),
  );
  fs.writeFileSync(
    path.join(out, "index.html"),
    `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${projectName}</title>\n  </head>\n  <body>\n    <main id="app"></main>\n    <script type="module" src="/src/main.ts"></script>\n  </body>\n</html>\n`,
  );
  fs.writeFileSync(
    path.join(out, "vite.config.ts"),
    'import { defineConfig } from "vite";\n\nexport default defineConfig({});\n',
  );
  fs.writeFileSync(
    path.join(out, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: "ESNext",
          moduleResolution: "bundler",
          types: ["vite/client"],
          strict: true,
          noUncheckedIndexedAccess: true,
          noEmit: true,
          skipLibCheck: true,
          verbatimModuleSyntax: true,
          isolatedModules: true,
        },
        include: ["src/**/*.ts", "tests/**/*.ts", "*.ts"],
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(out, "AGENTS.md"),
    `# AGENTS.md — ${projectName}\n\nThis is the vanilla arm of the benchmark. Build the game described in \`brief.md\` and match \`reference.png\`. Use plain Three.js for rendering and gameplay. You may install any npm package you choose, including a physics engine.\n\nThe only ThreeNative package available is the observation bridge. Install it after your scene, camera, renderer, and entities exist. Tick-driven proof scenarios require all five provider hooks:\n\n\`\`\`ts\nimport { installThreePlaytestBridge } from "@threenative/playtest/three";\n\ninstallThreePlaytestBridge({\n  camera,\n  diagnostics: () => [{ label: \"FPS\", value: fps }],\n  entities,\n  fixedStep: (ticks) => {\n    for (let index = 0; index < ticks; index += 1) tick();\n  },\n  tick: () => frame,\n  gameplay: () => ({\n    animation: { player: { clip: "idle", advancedFrames: 1 } },\n    states: { player: "idle", mission: "playing" },\n  }),\n  renderer,\n  resources: { read: () => ({ state: { ...state } }) },\n  scene,\n});\n\`\`\`\n\n\`fixedStep\` advances the simulation once per requested tick, and \`tick\` must be installed with it — installing \`fixedStep\` alone throws at module scope and takes your whole entry file down with it. \`diagnostics\` publishes runtime diagnostics: an entry shaped \`{ label, value }\` with a string, number or boolean value is a readout and never fails a proof, while anything else counts as a runtime error. \`gameplay\` must return both \`animation\` and \`states\` records when the proof asks for runtime animation or state assertions. \`resources.read()\` must expose the generic resource id \`state\` with the current serializable game state. Do not edit or copy the sealed proof scenarios; the sweep runner supplies them at test time.\n`,
  );
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
  const arm = options.arm ?? "framework";
  assertSandboxArm(arm);
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

  const tarballs: Partial<Record<PackageTarball, string>> = {};
  const requiredPackages: readonly PackageTarball[] =
    arm === "vanilla" ? (["playtest"] as const) : [...PACKAGES, CLI_PACKAGE];
  if (options.prepare ?? true) {
    run("pnpm", ["--filter", "./packages/**", "build"], repo);
    for (const name of [...PACKAGES, CLI_PACKAGE]) {
      run(
        "pnpm",
        ["--filter", `./packages/${name}`, "exec", "pnpm", "pack", "--pack-destination", staging],
        repo,
      );
    }
    for (const file of fs.readdirSync(staging)) {
      const owner = [...PACKAGES].find((name) => file.startsWith(`threenative-${name}-`));
      if (owner !== undefined) tarballs[owner] = path.join(staging, file);
      else if (file.startsWith(`${CLI_PACKAGE}-`)) tarballs[CLI_PACKAGE] = path.join(staging, file);
    }
  } else {
    for (const name of requiredPackages) {
      tarballs[name] = options.packageTarballs?.[name] ?? path.join(staging, `${name}.tgz`);
    }
  }

  const missing = requiredPackages.filter((name) => tarballs[name] === undefined);
  if (missing.length > 0)
    throw new Error(`pnpm pack produced no tarball for: ${missing.join(", ")}`);
  if (arm !== "vanilla") assertTemplateSourcesCovered(repo, template, tarballs);

  const scaffold = [
    "node",
    path.join(repo, "packages/create-threenative/dist/index.js"),
    "<target>",
    "--template",
    template,
    ...PACKAGES.flatMap((name) => [`--${name}-package`, tarballs[name] as string]),
    "--cli-package",
    tarballs[CLI_PACKAGE] as string,
  ];

  // --bare leaves the scaffolding to the agent, so the run starts the way a user's does.
  const bare = options.bare ?? false;
  const install = options.install ?? true;
  let next: string;
  if (arm === "vanilla") {
    fs.mkdirSync(out, { recursive: true });
    fs.copyFileSync(input.brief, path.join(out, "brief.md"));
    fs.copyFileSync(input.reference, path.join(out, "reference.png"));
    writeVanillaScaffold(out, tarballs.playtest as string);
    if (install && !bare)
      run("pnpm", ["install", "--store-dir", path.join(out, ".pnpm-store")], out);
    next = bare ? `cd ${out} && pnpm install && pnpm dev` : `cd ${out} && pnpm dev`;
  } else if (bare) {
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
    const scaffoldArgs = [...scaffold.slice(1, 2), out, ...scaffold.slice(3)];
    if (!install) scaffoldArgs.push("--no-install");
    run(scaffold[0] as string, scaffoldArgs, repo);
    fs.copyFileSync(input.brief, path.join(out, "brief.md"));
    fs.copyFileSync(input.reference, path.join(out, "reference.png"));
    next = `cd ${out} && pnpm dev`;
  }

  const leaked = sourceLines(out);
  const manifest: SweepManifest = {
    arm,
    genre,
    briefHash: input.briefHash,
    proofHash: input.proofHash,
    template,
    date: new Date().toISOString(),
    frameworkVersion: frameworkVersion(repo),
    sourceLines: leaked,
  };
  fs.writeFileSync(path.join(out, "sweep.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    [
      "",
      `${bare ? "bare sandbox ready" : "sandbox ready"} (${arm} arm): ${out}`,
      "",
      leaked === 0
        ? "  framework source readable: 0 lines — dist is types plus bundled js"
        : `  framework source readable: ${leaked} lines, via .js.map sourcesContent (a real
    install leaks the same; set sourcemap: false in the tsup configs to close it)`,
      "  CHARTER.md, docs/, PRDs, budgets, LOC classifier: not present",
      `  AGENTS.md in scope: ${bare ? "0 until it scaffolds" : "1 (the generated one)"}`,
      `  sealed proof SHA-256: ${input.proofHash}`,
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
    arm: readFlag("--arm", "framework") as SandboxArm,
    bare: process.argv.includes("--bare"),
    genre,
    out: readFlag("--out", "../threenative-sandbox"),
    template: readFlag("--template", "starter"),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
