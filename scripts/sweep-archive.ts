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
    copyPackageJson(packageFile, destination);
    fs.copyFileSync(manifestFile, path.join(destination, "sweep.json"));
    copyFrameworkTypes(source, destination);
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
