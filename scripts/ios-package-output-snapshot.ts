import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function filesUnder(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return filesUnder(entryPath);
      return entry.isFile() ? [entryPath] : [];
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Return the files that belong to the package archives consumed by the iOS handoff.
 *
 * Only each workspace package's immediate `dist/` directory is public package output. Native
 * dependencies also contain nested `dist/` directories, but those are build inputs and must not
 * make a package-output identity check fail. The core MCP server is a published package resource
 * even though it lives outside core's dist tree.
 */
export function iosPackageOutputFiles(repositoryRoot: string): readonly string[] {
  const packagesDirectory = path.join(repositoryRoot, "packages");
  const packageDirectories = readdirSync(packagesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDirectory, entry.name, "dist"));
  return [
    ...new Set([
      ...packageDirectories.flatMap((directory) => filesUnder(directory)),
      ...filesUnder(path.join(packagesDirectory, "core", "mcp")),
    ]),
  ].sort();
}

export function snapshotIosPackageOutputs(repositoryRoot: string): string {
  const root = path.resolve(repositoryRoot);
  return `${iosPackageOutputFiles(root)
    .map((file) => {
      const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
      return `${digest}  ${path.relative(root, file).split(path.sep).join("/")}`;
    })
    .join("\n")}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(snapshotIosPackageOutputs(process.cwd()));
}
