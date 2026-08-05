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
  fs.mkdirSync(destination, { recursive: true });
  try {
    fs.cpSync(sourceRoot, path.join(destination, "src"), { recursive: true });
    const playtests = path.join(source, "playtests");
    if (isDirectory(playtests))
      fs.cpSync(playtests, path.join(destination, "playtests"), { recursive: true });
    fs.copyFileSync(packageFile, path.join(destination, "package.json"));
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
