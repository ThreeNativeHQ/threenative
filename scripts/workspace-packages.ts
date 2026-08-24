import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");

export interface IWorkspacePackage {
  readonly dependencies: readonly string[];
  readonly directory: string;
  readonly name: string;
  readonly private: boolean;
  readonly scripts: Readonly<Record<string, string>>;
  readonly version: string;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function dependencyNames(manifest: Record<string, unknown>): readonly string[] {
  return ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap(
    (field) => {
      const block = record(manifest[field]);
      return Object.keys(block);
    },
  );
}

/** Reads the package manifests that are the source of truth for every pipeline package list. */
export function workspacePackages(repo = REPO): readonly IWorkspacePackage[] {
  const root = path.join(repo, "packages");
  if (!fs.existsSync(root))
    throw new Error(`TN_WORKSPACE_PACKAGES_MISSING: ${root} does not exist.`);
  const packages: IWorkspacePackage[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, entry.name);
    const manifestPath = path.join(directory, "package.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = record(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
    const name = manifest.name;
    const version = manifest.version;
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      typeof version !== "string" ||
      version.length === 0
    ) {
      throw new Error(`TN_WORKSPACE_PACKAGE_INVALID: ${manifestPath} needs a name and version.`);
    }
    const scripts = record(manifest.scripts);
    packages.push({
      dependencies: dependencyNames(manifest),
      directory,
      name,
      private: manifest.private === true,
      scripts: Object.fromEntries(
        Object.entries(scripts).flatMap(([key, value]) =>
          typeof value === "string" ? [[key, value]] : [],
        ),
      ),
      version,
    });
  }
  if (packages.length === 0)
    throw new Error("TN_WORKSPACE_PACKAGES_EMPTY: no package manifests were found.");
  const names = new Set<string>();
  for (const item of packages) {
    if (names.has(item.name)) throw new Error(`TN_WORKSPACE_PACKAGE_DUPLICATE: ${item.name}.`);
    names.add(item.name);
  }
  return packages.sort((left, right) => left.name.localeCompare(right.name));
}

export function publicWorkspacePackages(repo = REPO): readonly IWorkspacePackage[] {
  return workspacePackages(repo).filter(({ private: isPrivate }) => !isPrivate);
}

/** Returns packages in deterministic dependency order, with dependencies before dependents. */
export function workspaceBuildOrder(
  repo = REPO,
  packages: readonly IWorkspacePackage[] = publicWorkspacePackages(repo),
): readonly IWorkspacePackage[] {
  const byName = new Map(packages.map((item) => [item.name, item]));
  const ordered: IWorkspacePackage[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (item: IWorkspacePackage): void => {
    if (visited.has(item.name)) return;
    if (visiting.has(item.name)) {
      throw new Error(`TN_WORKSPACE_PACKAGE_CYCLE: dependency cycle reaches ${item.name}.`);
    }
    visiting.add(item.name);
    for (const dependency of [...new Set(item.dependencies)].sort((left, right) =>
      left.localeCompare(right),
    )) {
      const internal = byName.get(dependency);
      if (internal !== undefined) visit(internal);
    }
    visiting.delete(item.name);
    visited.add(item.name);
    ordered.push(item);
  };
  for (const item of [...packages].sort((left, right) => left.name.localeCompare(right.name)))
    visit(item);
  return ordered;
}

export function packageArchivePrefix(name: string): string {
  return `${name.replace(/^@/u, "").replace("/", "-")}-`;
}

export function localPackageEntries(
  repo = REPO,
): readonly (readonly [name: string, prefix: string])[] {
  return workspaceBuildOrder(repo).map(({ name }) => [name, packageArchivePrefix(name)] as const);
}

export function publishSetComment(repo = REPO): string {
  return publicWorkspacePackages(repo)
    .map(({ name }) => `#   ${name}`)
    .join("\n");
}

function buildWorkspacePackages(repo: string): void {
  for (const item of workspaceBuildOrder(repo)) {
    if (item.scripts.build === undefined || item.scripts.build.trim().length === 0) continue;
    execFileSync("pnpm", ["--filter", item.name, "run", "build"], {
      cwd: repo,
      stdio: "inherit",
    });
  }
}

function packWorkspacePackages(repo: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  buildWorkspacePackages(repo);
  for (const item of workspaceBuildOrder(repo)) {
    execFileSync("pnpm", ["--filter", item.name, "pack", "--pack-destination", destination], {
      cwd: repo,
      stdio: "inherit",
    });
  }
}

if (process.argv[1]?.endsWith("workspace-packages.ts") === true) {
  const command = process.argv[2];
  if (command === "build") buildWorkspacePackages(REPO);
  else if (command === "pack") {
    const destination = process.argv[3];
    if (destination === undefined || destination.length === 0) {
      throw new Error("usage: workspace-packages.ts pack <destination>");
    }
    packWorkspacePackages(REPO, destination);
  } else throw new Error("usage: workspace-packages.ts <build|pack> [destination]");
}
