import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PROJECT_ROOTS = ["examples", "packages/create-threenative/templates"];
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git", "public", "assets"]);
const OVERLAY_SELECTOR = '[data-threenative-debug-overlay="true"]';

async function listFiles(root: string, extensions: readonly string[]): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      found.push(...(await listFiles(full, extensions)));
      continue;
    }
    if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(full);
  }
  return found;
}

async function listProjects(): Promise<string[]> {
  const projects: string[] = [];
  for (const root of PROJECT_ROOTS) {
    const absolute = path.resolve(root);
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const project = path.join(absolute, entry.name);
      const manifest = await stat(path.join(project, "package.json")).catch(() => undefined);
      if (manifest?.isFile()) projects.push(project);
    }
  }
  return projects;
}

async function mountsOverlay(project: string): Promise<boolean> {
  const sources = await listFiles(project, [".tsx"]);
  for (const source of sources) {
    if ((await readFile(source, "utf8")).includes("<DebugOverlay")) return true;
  }
  return false;
}

async function stylesOverlay(project: string): Promise<boolean> {
  const stylesheets = await listFiles(project, [".css"]);
  for (const stylesheet of stylesheets) {
    if ((await readFile(stylesheet, "utf8")).includes(OVERLAY_SELECTOR)) return true;
  }
  return false;
}

describe("DebugOverlay presentation is game-owned", () => {
  it("should give every project that mounts the overlay its own overlay CSS", async () => {
    const unstyled: string[] = [];
    for (const project of await listProjects()) {
      if (!(await mountsOverlay(project))) continue;
      if (!(await stylesOverlay(project))) unstyled.push(path.relative(process.cwd(), project));
    }

    expect(unstyled).toEqual([]);
  });
});
