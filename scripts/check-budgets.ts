import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const LIMITS = {
  packages: 8,
  frameworkLoc: 15_000,
  markdownLines: 5_000,
  prdFiles: 10,
} as const;

const SALVAGE_PACKAGES = new Set(["playtest", "asset-mcp", "shader-portable"]);

export type BudgetReport = {
  packages: number;
  frameworkLoc: number;
  markdownLines: number;
  prdFiles: number;
};

async function filesUnder(root: string, predicate: (file: string) => boolean): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(absolute, predicate)));
    else if (predicate(absolute)) files.push(absolute);
  }
  return files;
}

async function countLines(files: string[]): Promise<number> {
  let total = 0;
  for (const file of files) {
    const content = await readFile(file, "utf8");
    total += content.length === 0 ? 0 : content.split(/\r?\n/).length;
  }
  return total;
}

async function workspacePackageCount(root: string): Promise<number> {
  let count = 0;
  for (const group of ["packages", "examples"]) {
    const directory = path.join(root, group);
    if (!existsSync(directory)) continue;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && existsSync(path.join(directory, entry.name, "package.json")))
        count += 1;
    }
  }
  return count;
}

export async function collectBudgets(root: string): Promise<BudgetReport> {
  const packageEntries = await readdir(path.join(root, "packages"), { withFileTypes: true }).catch(
    () => [],
  );
  const sourceFiles: string[] = [];
  for (const entry of packageEntries) {
    if (!entry.isDirectory() || SALVAGE_PACKAGES.has(entry.name)) continue;
    sourceFiles.push(
      ...(await filesUnder(path.join(root, "packages", entry.name, "src"), (file) =>
        /\.(?:ts|tsx|js|jsx)$/.test(file),
      )),
    );
  }
  return {
    packages: await workspacePackageCount(root),
    frameworkLoc: await countLines(sourceFiles),
    markdownLines: await countLines(await filesUnder(root, (file) => file.endsWith(".md"))),
    prdFiles: (
      await readdir(path.join(root, "docs", "PRDs"), { withFileTypes: true }).catch(() => [])
    ).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).length,
  };
}

export function budgetErrors(report: BudgetReport): string[] {
  const errors: string[] = [];
  if (report.packages > LIMITS.packages) {
    errors.push(
      `workspace package cap exceeded: ${report.packages} packages (limit ${LIMITS.packages}, +${report.packages - LIMITS.packages})`,
    );
  }
  if (report.frameworkLoc > LIMITS.frameworkLoc) {
    errors.push(
      `framework LOC cap exceeded: ${report.frameworkLoc} lines (limit ${LIMITS.frameworkLoc}, +${report.frameworkLoc - LIMITS.frameworkLoc})`,
    );
  }
  if (report.markdownLines > LIMITS.markdownLines) {
    errors.push(
      `Markdown line cap exceeded: ${report.markdownLines} lines (limit ${LIMITS.markdownLines}, +${report.markdownLines - LIMITS.markdownLines})`,
    );
  }
  if (report.prdFiles > LIMITS.prdFiles) {
    errors.push(
      `DESIGN/PRD document cap exceeded: ${report.prdFiles} files (limit ${LIMITS.prdFiles}, +${report.prdFiles - LIMITS.prdFiles})`,
    );
  }
  return errors;
}

export async function enforceBudgets(root: string): Promise<BudgetReport> {
  const report = await collectBudgets(root);
  const errors = budgetErrors(report);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  enforceBudgets(process.cwd())
    .then((report) => {
      console.log(
        `budgets ok: ${report.packages} packages, ${report.frameworkLoc} framework LOC, ${report.markdownLines} markdown lines, ${report.prdFiles} PRD files`,
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
