import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const LIMITS = {
  packages: 8,
  frameworkLoc: 15_000,
  prdFiles: 10,
  /**
   * A sweep charges the framework arm only for what it authors above its starter, so every
   * line inside a template is a line the benchmark stops counting. Capped per template so the
   * exemption cannot quietly become a place to hide gameplay.
   */
  templateLoc: 1_200,
} as const;

const SALVAGE_PACKAGES = new Set(["playtest", "asset-mcp", "shader-portable"]);

/**
 * The asset MCP is an npm dependency of the *generated* project, never of this workspace:
 * vendoring its ~10.8k lines would take 72% of the LOC cap and a ninth package slot at once.
 * Salvage already exempts an `asset-mcp` directory from the LOC count, so nothing else here
 * would notice it arriving.
 */
const EXTERNAL_ASSET_MCP = "threenative-asset-mcp";

export type BudgetReport = {
  packages: number;
  frameworkLoc: number;
  prdFiles: number;
  templates: { name: string; loc: number }[];
  vendoredAssetMcp: string[];
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

async function vendoredAssetMcp(root: string): Promise<string[]> {
  const directory = path.join(root, "packages");
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const offenders: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(directory, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      name?: string;
      peerDependencies?: Record<string, string>;
    };
    const dependencies = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ];
    if (manifest.name === EXTERNAL_ASSET_MCP || dependencies.includes(EXTERNAL_ASSET_MCP))
      offenders.push(entry.name);
  }
  return offenders;
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
  const templateRoot = path.join(root, "packages", "create-threenative", "templates");
  const templates: { name: string; loc: number }[] = [];
  for (const entry of await readdir(templateRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    templates.push({
      name: entry.name,
      loc: await countLines(
        await filesUnder(path.join(templateRoot, entry.name), (file) =>
          /\.(?:ts|tsx|js|jsx|css)$/.test(file),
        ),
      ),
    });
  }
  return {
    packages: await workspacePackageCount(root),
    frameworkLoc: await countLines(sourceFiles),
    templates,
    vendoredAssetMcp: await vendoredAssetMcp(root),
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
  for (const template of report.templates) {
    if (template.loc > LIMITS.templateLoc) {
      errors.push(
        `template LOC cap exceeded: ${template.name} is ${template.loc} lines (limit ${LIMITS.templateLoc}, +${template.loc - LIMITS.templateLoc}). Template lines are exempt from the sweep's authored cost, so this cap is what keeps that exemption honest.`,
      );
    }
  }
  if (report.vendoredAssetMcp.length > 0) {
    errors.push(
      `${EXTERNAL_ASSET_MCP} must stay external: ${report.vendoredAssetMcp.join(", ")} claims it. It is a dependency of the generated project, and vendoring it breaks both the LOC and package caps at once.`,
    );
  }
  if (report.prdFiles > LIMITS.prdFiles) {
    errors.push(
      `CHARTER/PRD document cap exceeded: ${report.prdFiles} files (limit ${LIMITS.prdFiles}, +${report.prdFiles - LIMITS.prdFiles})`,
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
        `budgets ok: ${report.packages} packages, ${report.frameworkLoc} framework LOC, ${report.prdFiles} PRD files, largest template ${Math.max(0, ...report.templates.map((template) => template.loc))} LOC`,
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
