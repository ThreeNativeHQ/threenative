import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = path.resolve(SITE_ROOT, "..");
export const CLIENT_DIR = path.join(SITE_ROOT, "dist", "client");

/** The built page for a route, read from the artefact the deploy would upload. */
export async function prerenderedPage(routePath: string): Promise<string> {
  const file =
    routePath === "/"
      ? path.join(CLIENT_DIR, "index.html")
      : path.join(CLIENT_DIR, routePath.replace(/^\//u, ""), "index.html");
  return readFile(file, "utf8");
}

export async function sourceFilesUnder(
  directory: string,
  extensions: readonly string[] = [".ts", ".tsx"],
): Promise<readonly string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!extensions.includes(path.extname(entry.name))) continue;
    files.push(path.join(entry.parentPath, entry.name));
  }
  return files.sort();
}

export async function readSources(files: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const sources = new Map<string, string>();
  for (const file of files) sources.set(file, await readFile(file, "utf8"));
  return sources;
}
