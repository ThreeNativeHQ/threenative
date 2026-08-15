import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type SweepManifest, readManifest } from "./make-sandbox.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SANDBOX = path.resolve(REPO, "../threenative-sandbox");

function isDirectory(directory: string): boolean {
  return fs.existsSync(directory) && fs.statSync(directory).isDirectory();
}

function isFile(file: string): boolean {
  return fs.existsSync(file) && fs.statSync(file).isFile();
}

function archiveName(manifest: SweepManifest): string {
  const date = manifest.date.slice(0, 10);
  return `${manifest.genre}-${date}`;
}

function assertArchiveDestination(root: string, destination: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(destination));
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error(`Refusing archive destination outside '${path.resolve(root)}': ${destination}`);
}

function nextArchive(root: string, base: string): string {
  const first = path.join(root, base);
  if (!fs.existsSync(first)) return first;
  for (let index = 2; ; index += 1) {
    const candidate = path.join(root, `${base}-${index}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
}

function copyFrameworkTypes(sandbox: string, archive: string): void {
  const installed = path.join(sandbox, "node_modules", "@threenative");
  if (!isDirectory(installed)) return;
  const destination = path.join(archive, "framework-types", "@threenative");
  for (const packageEntry of fs.readdirSync(installed, { withFileTypes: true })) {
    const packageDirectory = path.join(installed, packageEntry.name);
    if (!isDirectory(packageDirectory)) continue;
    const sourceDist = path.join(packageDirectory, "dist");
    if (!isDirectory(sourceDist)) continue;
    for (const file of collectDeclarations(sourceDist)) {
      const relative = path.relative(sourceDist, file);
      const target = path.join(destination, packageEntry.name, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file, target);
    }
  }
}

function copyStarterBaseline(archive: string, manifest: SweepManifest, repo: string): void {
  if (manifest.arm !== "framework" || manifest.template === "none") return;
  const starter = path.join(
    repo,
    "packages",
    "create-threenative",
    "templates",
    manifest.template,
    "src",
  );
  if (!isDirectory(starter))
    throw new Error(`Cannot archive '${manifest.template}': missing starter template src/.`);
  fs.cpSync(starter, path.join(archive, "starter-baseline", "src"), { recursive: true });
  fs.writeFileSync(
    path.join(archive, "starter-baseline", "SOURCE.json"),
    `${JSON.stringify({ origin: "scaffold", template: manifest.template }, null, 2)}\n`,
  );
}

/** Root entries the archiver writes itself, or that no archive should carry. */
const SHELL_EXCLUDED = new Set(["node_modules", "dist", "artifacts", "package.json", "sweep.json"]);
/** Root directories a project needs in order to boot. */
const SHELL_DIRECTORIES = ["public", "assets"] as const;

// This used to allowlist index.html and vite.config.* only, which silently dropped
// threenative.config.ts -- a file the starter template's own src/game.ts imports as
// "../threenative.config.js". Every framework archive was therefore unbootable, its dev
// server 500'd on that import, and sweep:proof reported TN_PLAYTEST_BRIDGE_MISSING for a
// bridge the game never got far enough to install. Rounds 3, 4 and 5 all recorded 0/1 for
// both arms because of it. An allowlist of root files rots the moment a template gains one,
// so copy every root file instead and name only what must not travel.
function copyAppShell(sandbox: string, archive: string): void {
  for (const entry of fs.readdirSync(sandbox, { withFileTypes: true })) {
    if (SHELL_EXCLUDED.has(entry.name) || entry.name.startsWith(".")) continue;
    if (entry.isFile())
      fs.copyFileSync(path.join(sandbox, entry.name), path.join(archive, entry.name));
  }
  for (const name of SHELL_DIRECTORIES) {
    const directory = path.join(sandbox, name);
    if (isDirectory(directory)) fs.cpSync(directory, path.join(archive, name), { recursive: true });
  }
}

/**
 * Fails the archive when `src/` imports a sibling the archive does not carry.
 *
 * The allowlist bug above was invisible for three rounds because nothing checked that the
 * thing we archived could still resolve its own imports. An archive that cannot boot is not
 * a weaker archive, it is a fabricated measurement: every proof run against it reports a
 * failure the game never earned.
 */
function assertArchiveResolves(archive: string): void {
  const missing = new Set<string>();
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      const source = fs.readFileSync(full, "utf8");
      for (const match of source.matchAll(/from\s+"(\.\.\/[^"]+)"/gu)) {
        const specifier = match[1];
        if (specifier === undefined) continue;
        const resolved = path.resolve(path.dirname(full), specifier);
        if (path.relative(archive, resolved).startsWith("..")) continue;
        // The project is TypeScript; its ESM imports name the emitted .js.
        const candidates = [
          resolved,
          resolved.replace(/\.js$/, ".ts"),
          resolved.replace(/\.js$/, ".tsx"),
        ];
        if (!candidates.some((candidate) => fs.existsSync(candidate)))
          missing.add(`${path.relative(archive, full)} -> ${specifier}`);
      }
    }
  };
  walk(path.join(archive, "src"));
  if (missing.size > 0)
    throw new Error(
      `Refusing to archive an unbootable project; src/ imports files the archive does not carry:\n  ${[...missing].join("\n  ")}`,
    );
}

function packageNamePart(name: string): string {
  return name.replace(/^@/, "").replaceAll("/", "-");
}

function copyPackageJson(packageFile: string, archive: string): void {
  const packageJson = JSON.parse(fs.readFileSync(packageFile, "utf8")) as Record<string, unknown>;
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
    const rawDependencies = packageJson[section];
    if (
      typeof rawDependencies !== "object" ||
      rawDependencies === null ||
      Array.isArray(rawDependencies)
    )
      continue;
    const dependencies = rawDependencies as Record<string, unknown>;
    for (const [name, value] of Object.entries(dependencies)) {
      if (typeof value !== "string" || !value.startsWith("file:")) continue;
      const source = path.resolve(path.dirname(packageFile), value.slice("file:".length));
      if (!fs.existsSync(source))
        throw new Error(
          `Cannot archive local dependency '${name}': file does not exist: ${source}`,
        );
      const relative = path.posix.join("vendor", packageNamePart(name), path.basename(source));
      const destination = path.join(archive, ...relative.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.cpSync(source, destination, { recursive: true });
      dependencies[name] = `file:./${relative}`;
    }
  }
  fs.writeFileSync(path.join(archive, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
}

function collectDeclarations(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (isDirectory(file)) return collectDeclarations(file);
    return entry.name.endsWith(".d.ts") ? [file] : [];
  });
}

function resolveSandbox(source: string): string {
  if (isDirectory(path.join(source, "src"))) return source;
  if (!isDirectory(source)) return source;
  const children = fs.readdirSync(source, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(source, entry.name);
    return entry.isDirectory() &&
      isDirectory(path.join(child, "src")) &&
      isFile(path.join(child, "sweep.json"))
      ? [child]
      : [];
  });
  if (children.length === 1) return children[0] as string;
  if (children.length > 1)
    throw new Error(
      `Sandbox '${source}' contains multiple projects; pass the project path to sweep:archive.`,
    );
  return source;
}

export function archiveSandbox(sandbox = DEFAULT_SANDBOX, repo = REPO): string {
  const source = resolveSandbox(path.resolve(sandbox));
  if (!isDirectory(source)) throw new Error(`Sandbox does not exist: ${source}`);
  const sourceRoot = path.join(source, "src");
  if (!isDirectory(sourceRoot))
    throw new Error(`Cannot archive '${source}': missing src/; the sandbox was not built.`);
  const packageFile = path.join(source, "package.json");
  const manifestFile = path.join(source, "sweep.json");
  if (!isFile(packageFile)) throw new Error(`Cannot archive '${source}': missing package.json.`);
  if (!isFile(manifestFile)) throw new Error(`Cannot archive '${source}': missing sweep.json.`);
  const manifest = readManifest(manifestFile);
  const archiveRoot = path.join(repo, "docs", "benchmark", "sweeps");
  fs.mkdirSync(archiveRoot, { recursive: true });
  const destination = nextArchive(archiveRoot, archiveName(manifest));
  assertArchiveDestination(archiveRoot, destination);
  fs.mkdirSync(destination, { recursive: true });
  try {
    fs.cpSync(sourceRoot, path.join(destination, "src"), { recursive: true });
    const playtests = path.join(source, "playtests");
    if (isDirectory(playtests))
      fs.cpSync(playtests, path.join(destination, "playtests"), { recursive: true });
    copyAppShell(source, destination);
    copyPackageJson(packageFile, destination);
    fs.copyFileSync(manifestFile, path.join(destination, "sweep.json"));
    copyFrameworkTypes(source, destination);
    copyStarterBaseline(destination, manifest, repo);
    assertArchiveResolves(destination);
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  }
  process.stdout.write(`sweep archived: ${destination}\n`);
  return destination;
}

function main(): void {
  archiveSandbox(process.argv[2] ?? DEFAULT_SANDBOX);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
