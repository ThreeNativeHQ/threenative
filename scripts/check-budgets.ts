import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * `CHARTER.md` §10b splits these in two, and this file is the enforcement of that split.
 *
 * HARD limits fail CI: they are invariants of the native absorption (§7), and crossing one
 * means the C++ runtime has leaked into the TypeScript framework.
 *
 * TRIGGER limits do not fail CI. They are reported on every run so growth stays visible,
 * and crossing one obliges a justification in the owning PRD plus a kill-switch (§3) pass
 * over what was added. A number that fails the build invites being routed around; a number
 * that is merely loud does not.
 */
const LIMITS = {
  frameworkLoc: 15_000,
  nativeRuntimeLoc: 50_000,
  /**
   * A sweep charges the framework arm only for what it authors above its starter, so every
   * line inside a template is a line the benchmark stops counting. Capped per template so the
   * exemption cannot quietly become a place to hide gameplay.
   */
  templateLoc: 1_200,
} as const;

const SALVAGE_PACKAGES = new Set(["playtest", "asset-mcp", "shader-portable"]);

/**
 * Authoring MCPs are npm dependencies of the *generated* project, never of this workspace.
 * Vendoring them would consume framework LOC and add packages that carry no runtime dependency
 * boundary.
 * Salvage already exempts an `asset-mcp` directory from the LOC count, so nothing else here
 * would notice it arriving.
 */
const EXTERNAL_MCPS: ReadonlySet<string> = new Set([
  "threenative-asset-mcp",
  "threenative-sculpt-mcp",
]);
const NATIVE_RUNTIME_PACKAGE = path.join("packages", "runtime-native");
const NATIVE_SOURCE_PATTERN =
  /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|m|mm|rs|swift|java|kt|kts|cmake|gradle)$/;
const NATIVE_RUNTIME_SOURCE_PATTERN =
  /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|m|mm|rs|swift|java|kt|kts|cmake|gradle|js|mjs|ts|json|xml)$/;
const GENERATED_ANDROID_BUNDLE = path.join(
  "android",
  "app",
  "src",
  "main",
  "assets",
  "scripts",
  "main.js",
);
const GENERATED_ANDROID_BUNDLE_FILES = [
  GENERATED_ANDROID_BUNDLE,
  `${GENERATED_ANDROID_BUNDLE}.meta.json`,
] as const;
const NATIVE_RUNTIME_DIRECTORY_NAMES = new Set([
  "mystralnative",
  "threejsmystral",
  "mystralruntime",
  "nativeruntime",
]);
const WALK_EXCLUSIONS = new Set([
  ".cache",
  ".git",
  ".worktrees",
  "artifacts",
  "coverage",
  "dist",
  "docs",
  "node_modules",
]);

export type BudgetReport = {
  frameworkPackages: number;
  exampleWorkspaces: number;
  frameworkLoc: number;
  nativeRuntimeLoc: number;
  prdFiles: number;
  templates: { name: string; loc: number }[];
  vendoredExternalMcp: string[];
  vendoredNativeRuntime: string[];
  trackedNativeThirdParty: string[];
};

async function filesUnder(
  root: string,
  predicate: (file: string) => boolean,
  excludedDirectories = new Set<string>(),
): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".git" ||
      entry.name === "dist" ||
      excludedDirectories.has(entry.name)
    )
      continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory())
      files.push(...(await filesUnder(absolute, predicate, excludedDirectories)));
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

async function packageCount(root: string, group: "examples" | "packages"): Promise<number> {
  let count = 0;
  const directory = path.join(root, group);
  if (!existsSync(directory)) return count;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && existsSync(path.join(directory, entry.name, "package.json")))
      count += 1;
  }
  return count;
}

function normalizedDirectoryName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function vendoredNativeRuntime(root: string): Promise<string[]> {
  const offenders = new Set<string>();

  async function walk(directory: string, relative: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const names = new Set(entries.map((entry) => entry.name));
    const runtimeSignature =
      existsSync(path.join(directory, "include", "mystral")) ||
      existsSync(path.join(directory, "src", "js", "quickjs_engine.cpp")) ||
      (names.has("CMakeLists.txt") &&
        existsSync(path.join(directory, "src", "runtime.cpp")) &&
        existsSync(path.join(directory, "third_party")));
    if (runtimeSignature) {
      if (relative !== NATIVE_RUNTIME_PACKAGE) offenders.add(relative || ".");
      return;
    }

    if (
      path.basename(directory) === "third_party" &&
      names.has("dawn") &&
      (names.has("quickjs") || names.has("sdl3") || names.has("v8"))
    ) {
      offenders.add(path.dirname(relative));
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || WALK_EXCLUSIONS.has(entry.name)) continue;
      const childRelative = relative ? path.join(relative, entry.name) : entry.name;
      if (NATIVE_RUNTIME_DIRECTORY_NAMES.has(normalizedDirectoryName(entry.name))) {
        if (childRelative !== NATIVE_RUNTIME_PACKAGE) offenders.add(childRelative);
        continue;
      }
      await walk(path.join(directory, entry.name), childRelative);
    }
  }

  await walk(root, "");
  return [...offenders].sort();
}

async function trackedNativeThirdParty(root: string): Promise<string[]> {
  if (!existsSync(path.join(root, ".git"))) return [];
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", root, "ls-files", "--", path.join(NATIVE_RUNTIME_PACKAGE, "third_party")],
      { encoding: "utf8" },
    );
    return stdout
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter(Boolean)
      .sort();
  } catch (error) {
    throw new Error(
      `could not inspect tracked native dependencies: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function vendoredExternalMcp(root: string): Promise<string[]> {
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
    if (
      (manifest.name !== undefined && EXTERNAL_MCPS.has(manifest.name)) ||
      dependencies.some((dependency) => EXTERNAL_MCPS.has(dependency))
    )
      offenders.push(entry.name);
  }
  return offenders;
}

export async function collectBudgets(root: string): Promise<BudgetReport> {
  const packageEntries = await readdir(path.join(root, "packages"), { withFileTypes: true }).catch(
    () => [],
  );
  const sourceFiles = new Set<string>();
  for (const entry of packageEntries) {
    if (!entry.isDirectory() || SALVAGE_PACKAGES.has(entry.name) || entry.name === "runtime-native")
      continue;
    const packageRoot = path.join(root, "packages", entry.name);
    for (const file of await filesUnder(
      path.join(packageRoot, "src"),
      (candidate) =>
        /\.(?:ts|tsx|js|jsx)$/.test(candidate) || NATIVE_SOURCE_PATTERN.test(candidate),
    ))
      sourceFiles.add(file);
    for (const file of await filesUnder(packageRoot, (candidate) => {
      const basename = path.basename(candidate);
      return NATIVE_SOURCE_PATTERN.test(candidate) || basename === "CMakeLists.txt";
    }))
      sourceFiles.add(file);
  }
  const nativeRuntimeRoot = path.join(root, NATIVE_RUNTIME_PACKAGE);
  const nativeRuntimeFiles = await filesUnder(
    nativeRuntimeRoot,
    (candidate) =>
      !GENERATED_ANDROID_BUNDLE_FILES.some((generated) => candidate.endsWith(generated)) &&
      (NATIVE_RUNTIME_SOURCE_PATTERN.test(candidate) ||
        path.basename(candidate) === "CMakeLists.txt"),
    new Set([
      "third_party",
      "build",
      ".runtime",
      "artifacts",
      ".cxx",
      ".gradle",
      ".test-tmp",
      "target",
    ]),
  );
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
    frameworkPackages: await packageCount(root, "packages"),
    exampleWorkspaces: await packageCount(root, "examples"),
    frameworkLoc: await countLines([...sourceFiles]),
    nativeRuntimeLoc: await countLines(nativeRuntimeFiles),
    templates,
    vendoredExternalMcp: await vendoredExternalMcp(root),
    vendoredNativeRuntime: await vendoredNativeRuntime(root),
    trackedNativeThirdParty: await trackedNativeThirdParty(root),
    prdFiles: (
      await readdir(path.join(root, "docs", "PRDs"), { withFileTypes: true }).catch(() => [])
    ).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).length,
  };
}

/**
 * Review triggers, per `CHARTER.md` §10b. Reported, never fatal — the PRD that crosses one
 * owes the justification, and the kill switch (§3) decides whether the lines were earned.
 */
export function budgetTriggers(report: BudgetReport): string[] {
  const triggers: string[] = [];
  if (report.frameworkLoc > LIMITS.frameworkLoc) {
    triggers.push(
      `framework LOC review trigger: ${report.frameworkLoc} lines (trigger ${LIMITS.frameworkLoc}, +${report.frameworkLoc - LIMITS.frameworkLoc}). Justify in the owning PRD and run the kill switch over what was added.`,
    );
  }
  if (report.nativeRuntimeLoc > LIMITS.nativeRuntimeLoc) {
    triggers.push(
      `native runtime LOC review trigger: ${report.nativeRuntimeLoc} lines (trigger ${LIMITS.nativeRuntimeLoc}, +${report.nativeRuntimeLoc - LIMITS.nativeRuntimeLoc}). Justify in the owning PRD and run the kill switch over what was added.`,
    );
  }
  return triggers;
}

export function budgetErrors(report: BudgetReport): string[] {
  const errors: string[] = [];
  for (const template of report.templates) {
    if (template.loc > LIMITS.templateLoc) {
      errors.push(
        `template LOC cap exceeded: ${template.name} is ${template.loc} lines (limit ${LIMITS.templateLoc}, +${template.loc - LIMITS.templateLoc}). Template lines are exempt from the sweep's authored cost, so this cap is what keeps that exemption honest.`,
      );
    }
  }
  if (report.vendoredExternalMcp.length > 0) {
    errors.push(
      `External MCPs (${[...EXTERNAL_MCPS].join(", ")}) must stay external: ${report.vendoredExternalMcp.join(", ")} claims one. They are dependencies of generated projects, and vendoring them consumes framework LOC while adding packages with no runtime dependency boundary.`,
    );
  }
  if (report.vendoredNativeRuntime.length > 0) {
    errors.push(
      `Mystral native runtime is allowed only at ${NATIVE_RUNTIME_PACKAGE}: ${report.vendoredNativeRuntime.join(", ")} contains another runtime tree.`,
    );
  }
  if (report.trackedNativeThirdParty.length > 0) {
    errors.push(
      `native runtime third_party must stay untracked: ${report.trackedNativeThirdParty.join(", ")}`,
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
      for (const trigger of budgetTriggers(report)) console.warn(`budgets trigger: ${trigger}`);
      console.log(
        `budgets ok: ${report.frameworkPackages} framework packages, ${report.exampleWorkspaces} example workspaces, ${report.frameworkLoc}/${LIMITS.frameworkLoc} framework LOC, ${report.nativeRuntimeLoc}/${LIMITS.nativeRuntimeLoc} native runtime LOC, ${report.prdFiles} PRD files, largest template ${Math.max(0, ...report.templates.map((template) => template.loc))} LOC`,
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
