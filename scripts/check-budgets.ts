import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { checkCapabilityManifest } from "./build-capability-manifest.js";

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
const FRAMEWORK_LOC_ATTRIBUTION = path.join(
  "docs",
  "verification",
  "loc-attribution-2026-08-20.md",
);
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
  // Agent worktrees are checkouts of this repository, so every one of them carries its own
  // packages/runtime-native. Walking into them reports the same runtime tree several times over
  // and fails the hard native-runtime invariant for reasons that have nothing to do with the
  // change under test.
  ".claude",
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
  frameworkLocByPackage: FrameworkPackageLoc[];
  frameworkLocAttribution: FrameworkLocAttribution | null;
  nativeRuntimeLoc: number;
  prdFiles: number;
  templates: { name: string; loc: number }[];
  textureBytes: TextureByteBudget | null;
  vendoredExternalMcp: string[];
  vendoredNativeRuntime: string[];
  trackedNativeThirdParty: string[];
};

/**
 * Aggregate over the compiled manifests that happen to exist under the templates (they are
 * gitignored, so this is whatever the last local build produced). Reported, never fatal —
 * PRD-095's byte gate lives in the asset compile step's own printed report; here it only has
 * to stay visible.
 */
export type TextureByteBudget = {
  readonly after: number;
  readonly before: number;
  readonly textures: number;
};

export type FrameworkPackageLoc = {
  readonly loc: number;
  readonly name: string;
};

export type FrameworkLocAttribution = {
  readonly packages: readonly FrameworkPackageLoc[];
  readonly total: number;
};

function parseFrameworkLocPackages(
  markdown: string,
  tableStart: number,
  file: string,
): FrameworkPackageLoc[] {
  const packages: FrameworkPackageLoc[] = [];
  const tableLines = markdown.slice(tableStart).split(/\r?\n/u);
  for (const rawLine of tableLines.slice(2)) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) break;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^[-:]+$/u.test(cell))) continue;
    const name = cells[0]?.replaceAll("`", "");
    const loc = cells[1];
    if (name === "**Total**") break;
    if (name === undefined || name.length === 0 || loc === undefined || !/^[\d,]+$/u.test(loc))
      throw new Error(`framework LOC attribution has a malformed package row: ${file}`);
    packages.push({
      loc: Number(loc.replaceAll(",", "")),
      name,
    });
  }
  return packages;
}

/**
 * Read the active framework attribution without making historical movement fatal to normal
 * budget enforcement. The current file walk remains authoritative for the live counter.
 */
export async function readFrameworkLocAttribution(
  root: string,
): Promise<FrameworkLocAttribution | null> {
  const file = path.join(root, FRAMEWORK_LOC_ATTRIBUTION);
  if (!existsSync(file)) return null;
  const markdown = await readFile(file, "utf8");
  const totalMatch = markdown.match(/^Recorded framework LOC:\s*([\d,]+)\s*$/mu);
  if (totalMatch?.[1] === undefined)
    throw new Error(`framework LOC attribution is missing its recorded total: ${file}`);
  const tableMatch = markdown.match(/^\| Package \| [^|]+ \|/mu);
  if (tableMatch?.index === undefined)
    throw new Error(`framework LOC attribution is missing its package table: ${file}`);

  const packages = parseFrameworkLocPackages(markdown, tableMatch.index, file);
  if (packages.length === 0)
    throw new Error(`framework LOC attribution has no package rows: ${file}`);
  if (new Set(packages.map((item) => item.name)).size !== packages.length)
    throw new Error(`framework LOC attribution repeats a package row: ${file}`);

  const total = Number(totalMatch[1].replaceAll(",", ""));
  const packageTotal = packages.reduce((sum, item) => sum + item.loc, 0);
  if (packageTotal !== total) {
    throw new Error(
      `framework LOC attribution total does not equal its package rows: ${packageTotal} != ${total}`,
    );
  }
  return { packages, total };
}

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

async function templateTextureBytes(root: string): Promise<TextureByteBudget | null> {
  const templateRoot = path.join(root, "packages", "create-threenative", "templates");
  let before = 0;
  let after = 0;
  let textures = 0;
  for (const template of await readdir(templateRoot, { withFileTypes: true }).catch(() => [])) {
    if (!template.isDirectory()) continue;
    const manifestPath = path.join(templateRoot, template.name, "public", "assets.manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      entries?: Record<string, { bytes?: number; bytesBefore?: number }>;
    };
    for (const entry of Object.values(manifest.entries ?? {})) {
      if (entry.bytesBefore === undefined || entry.bytes === undefined) continue;
      before += entry.bytesBefore;
      after += entry.bytes;
      textures += 1;
    }
  }
  return textures === 0 ? null : { after, before, textures };
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

/**
 * The native census counts whole top-level entries of `packages/runtime-native/`, so a counted
 * area is a directory with a trailing slash or a root file by name (`CMakeLists.txt` is prefixed
 * with "Root"). Names are plain text — the census table adds its own markdown backticks. The
 * census record's Lines column and this measurement are produced by the same walk; nothing
 * retypes them.
 */
export type INativeCensusMeasurement = {
  readonly areas: ReadonlyMap<string, number>;
  readonly total: number;
};

function nativeCensusAreaName(entryName: string, isDirectory: boolean): string {
  if (isDirectory) return `${entryName}/`;
  if (entryName === "CMakeLists.txt") return `Root ${entryName}`;
  return entryName;
}

const NATIVE_RUNTIME_WALK_EXCLUSIONS = new Set([
  "third_party",
  "build",
  ".runtime",
  "artifacts",
  ".cxx",
  ".gradle",
  ".test-tmp",
  "target",
]);

function isNativeRuntimeSource(candidate: string): boolean {
  return (
    !GENERATED_ANDROID_BUNDLE_FILES.some((generated) => candidate.endsWith(generated)) &&
    (NATIVE_RUNTIME_SOURCE_PATTERN.test(candidate) || path.basename(candidate) === "CMakeLists.txt")
  );
}

export async function measureNativeCensusAreas(root: string): Promise<INativeCensusMeasurement> {
  const nativeRuntimeRoot = path.join(root, NATIVE_RUNTIME_PACKAGE);
  const files = await filesUnder(
    nativeRuntimeRoot,
    isNativeRuntimeSource,
    new Set([...NATIVE_RUNTIME_WALK_EXCLUSIONS]),
  );
  const areas = new Map<string, number>();
  for (const file of files) {
    const segments = path.relative(nativeRuntimeRoot, file).split(path.sep);
    const top = segments[0];
    if (top === undefined) continue;
    const name = nativeCensusAreaName(top, segments.length > 1);
    areas.set(name, (areas.get(name) ?? 0) + (await countLines([file])));
  }
  return {
    areas,
    total: [...areas.values()].reduce((sum, lines) => sum + lines, 0),
  };
}

export async function collectBudgets(root: string): Promise<BudgetReport> {
  const packageEntries = await readdir(path.join(root, "packages"), { withFileTypes: true }).catch(
    () => [],
  );
  const sourceFiles = new Set<string>();
  const frameworkLocByPackage: FrameworkPackageLoc[] = [];
  for (const entry of packageEntries) {
    if (!entry.isDirectory() || SALVAGE_PACKAGES.has(entry.name) || entry.name === "runtime-native")
      continue;
    const packageSourceFiles = new Set<string>();
    const packageRoot = path.join(root, "packages", entry.name);
    for (const file of await filesUnder(
      path.join(packageRoot, "src"),
      (candidate) =>
        /\.(?:ts|tsx|js|jsx)$/.test(candidate) || NATIVE_SOURCE_PATTERN.test(candidate),
    )) {
      packageSourceFiles.add(file);
      sourceFiles.add(file);
    }
    for (const file of await filesUnder(packageRoot, (candidate) => {
      const basename = path.basename(candidate);
      return NATIVE_SOURCE_PATTERN.test(candidate) || basename === "CMakeLists.txt";
    })) {
      packageSourceFiles.add(file);
      sourceFiles.add(file);
    }
    frameworkLocByPackage.push({
      loc: await countLines([...packageSourceFiles]),
      name: entry.name,
    });
  }
  const nativeRuntimeRoot = path.join(root, NATIVE_RUNTIME_PACKAGE);
  const nativeRuntimeFiles = await filesUnder(
    nativeRuntimeRoot,
    isNativeRuntimeSource,
    new Set(NATIVE_RUNTIME_WALK_EXCLUSIONS),
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
    frameworkLocByPackage: frameworkLocByPackage.sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    frameworkLocAttribution: await readFrameworkLocAttribution(root),
    nativeRuntimeLoc: await countLines(nativeRuntimeFiles),
    templates,
    textureBytes: await templateTextureBytes(root),
    vendoredExternalMcp: await vendoredExternalMcp(root),
    vendoredNativeRuntime: await vendoredNativeRuntime(root),
    trackedNativeThirdParty: await trackedNativeThirdParty(root),
    prdFiles: (
      await readdir(path.join(root, "docs", "PRDs"), { withFileTypes: true }).catch(() => [])
    ).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).length,
  };
}

function frameworkPackageDeltaSummary(report: BudgetReport): string {
  const current = new Map(report.frameworkLocByPackage.map((item) => [item.name, item.loc]));
  const previous = new Map(
    report.frameworkLocAttribution?.packages.map((item) => [item.name, item.loc]) ?? [],
  );
  if (report.frameworkLocAttribution === null) {
    const names = [...current.keys()].sort();
    return names.length === 0
      ? "none (no counted packages)"
      : names.map((name) => `${name} (no prior attribution)`).join(", ");
  }

  const names = [...new Set([...current.keys(), ...previous.keys()])].sort();
  const changed = names
    .map((name) => ({
      delta: (current.get(name) ?? 0) - (previous.get(name) ?? 0),
      name,
    }))
    .filter((item) => item.delta !== 0);
  if (changed.length === 0) return "none";
  return changed
    .map((item) => `${item.name} (${item.delta > 0 ? "+" : ""}${item.delta})`)
    .join(", ");
}

/**
 * Review triggers, per `CHARTER.md` §10b. Reported, never fatal — the PRD that crosses one
 * owes the justification, and the kill switch (§3) decides whether the lines were earned.
 */
export function budgetTriggers(report: BudgetReport): string[] {
  const triggers: string[] = [];
  if (report.frameworkLoc > LIMITS.frameworkLoc) {
    triggers.push(
      `framework LOC review trigger: ${report.frameworkLoc} lines (trigger ${LIMITS.frameworkLoc}, +${report.frameworkLoc - LIMITS.frameworkLoc}). Packages moved since last recorded attribution: ${frameworkPackageDeltaSummary(report)}. Justify in the owning PRD and run the kill switch over what was added.`,
    );
  }
  if (report.nativeRuntimeLoc > LIMITS.nativeRuntimeLoc) {
    triggers.push(
      `native runtime LOC review trigger: ${report.nativeRuntimeLoc} lines (trigger ${LIMITS.nativeRuntimeLoc}, +${report.nativeRuntimeLoc - LIMITS.nativeRuntimeLoc}). Justify in the owning PRD and run the kill switch over what was added.`,
    );
  }
  if (report.textureBytes !== null && report.textureBytes.after > report.textureBytes.before) {
    triggers.push(
      `texture bytes review trigger: compiled textures are larger than their sources (${report.textureBytes.before} -> ${report.textureBytes.after} across ${report.textureBytes.textures}). The KTX2 pass is supposed to shrink them; justify or fix in the owning PRD.`,
    );
  }
  return triggers;
}

function frameworkPackageDifferences(report: BudgetReport): string[] {
  const current = new Map(report.frameworkLocByPackage.map((item) => [item.name, item.loc]));
  const previous = new Map(
    report.frameworkLocAttribution?.packages.map((item) => [item.name, item.loc]) ?? [],
  );
  return [...new Set([...current.keys(), ...previous.keys()])]
    .sort()
    .filter((name) => current.get(name) !== previous.get(name))
    .map(
      (name) => `${name}: recorded ${previous.get(name) ?? 0}, measured ${current.get(name) ?? 0}`,
    );
}

export function budgetErrors(report: BudgetReport): string[] {
  const errors: string[] = [];
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

export async function capabilityManifestErrors(root: string): Promise<string[]> {
  // Small budget fixtures intentionally contain no engine package. The real tree has core, and
  // its presence is the unambiguous signal that the manifest freshness gate applies.
  if (!existsSync(path.join(root, "packages", "core", "package.json"))) return [];
  try {
    await checkCapabilityManifest(root);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

/**
 * One-shot verification for the active framework attribution. Normal budget enforcement keeps
 * historical records non-fatal so budget movement remains visible in the trigger.
 */
export async function verifyFrameworkLocAttribution(root: string): Promise<BudgetReport> {
  const report = await collectBudgets(root);
  if (report.frameworkLocAttribution === null) {
    throw new Error(
      `framework LOC attribution is missing: ${path.join(root, FRAMEWORK_LOC_ATTRIBUTION)}`,
    );
  }
  if (report.frameworkLocAttribution.total !== report.frameworkLoc) {
    throw new Error(
      `recorded framework LOC attribution total disagrees with measured framework LOC: recorded ${report.frameworkLocAttribution.total}, measured ${report.frameworkLoc}`,
    );
  }
  const differences = frameworkPackageDifferences(report);
  if (differences.length > 0)
    throw new Error(`framework LOC attribution package rows disagree:\n${differences.join("\n")}`);
  return report;
}

export async function enforceBudgets(root: string): Promise<BudgetReport> {
  const report = await collectBudgets(root);
  const errors = [
    ...budgetErrors(report),
    ...(await capabilityManifestErrors(root)),
    ...(await nativeCensusErrors(root)),
  ];
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return report;
}

/**
 * The census exists to force a KEEP/DELETE judgement per counted area, so that is what the gate
 * enforces: every measured area must have a row whose owner, live proof or caller, considered
 * alternative, and verdict are all present. The Lines column is generated from the same walk this
 * file already does (`pnpm census`), and arithmetic drift against it is reported as a trigger,
 * not failed — a hand-retyped sum was the single most expensive recurring gate failure.
 */
export async function nativeCensusErrors(root: string): Promise<string[]> {
  const recordPath = path.join(root, "docs", "verification", "native-runtime-census-2026-08-16.md");
  if (!existsSync(recordPath)) {
    // Small budget fixtures carry no census record. The real tree — signalled the same way the
    // capability-manifest gate signals it — must not be able to silence the verdict gate by
    // deleting the file.
    if (!existsSync(path.join(root, "packages", "core", "package.json"))) return [];
    return [
      "native census record is missing: the counted-area verdict gate has nothing to enforce",
    ];
  }

  const record = await readFile(recordPath, "utf8");
  if (!record.includes("| Counted area | Lines | Owner |")) {
    return ["native census record is missing its counted-area table"];
  }
  const parsed = parseNativeCensusTable(record);
  const errors: string[] = [];

  for (const row of parsed.rows) {
    if (row.owner.length === 0 || row.liveProof.length === 0 || row.alternative.length === 0) {
      errors.push(
        `native census row ${row.area} is missing its owner, live proof or caller, or alternative considered`,
      );
    }
    if (!/^\*\*(?:KEEP|DELETE)\b/u.test(row.verdict)) {
      errors.push(
        `native census row ${row.area} has no KEEP/DELETE verdict: the cell must start with **KEEP** or **DELETE**`,
      );
    }
  }

  const measurement = await measureNativeCensusAreas(root);
  const recordedAreas = new Set(parsed.rows.map((row) => row.area));
  for (const [area] of measurement.areas) {
    if (!recordedAreas.has(area)) {
      errors.push(
        `native census record has no row for counted area ${area}: add one with its owner, live proof or caller, alternative considered, and KEEP/DELETE verdict`,
      );
    }
  }
  const knownAreas = new Set(measurement.areas.keys());
  for (const area of recordedAreas) {
    if (!knownAreas.has(area)) {
      errors.push(
        `native census row ${area} counts an area the runtime tree no longer has: record the deletion in the doc's changelog, then remove the row`,
      );
    }
  }

  const areaSum = parsed.rows.reduce((sum, row) => sum + row.lines, 0);
  if (parsed.total === null) {
    errors.push("native census record contains a malformed total row");
  } else if (areaSum !== parsed.total) {
    errors.push(
      `native census total disagrees with its own area rows: rows sum to ${areaSum}, total row says ${parsed.total}`,
    );
  }
  return errors;
}

type INativeCensusRow = {
  readonly area: string;
  readonly lines: number;
  readonly owner: string;
  readonly liveProof: string;
  readonly alternative: string;
  readonly verdict: string;
};

function parseNativeCensusTable(record: string): {
  rows: INativeCensusRow[];
  total: number | null;
} {
  const rows: INativeCensusRow[] = [];
  let total: number | null = null;
  let inTable = false;
  for (const line of record.split(/\r?\n/u)) {
    if (line.startsWith("| Counted area | Lines | Owner |")) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (!line.startsWith("|")) break;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^[-:]+$/u.test(cell))) continue;
    if (line.startsWith("| **Total** |")) {
      const lines = cells[1]?.replaceAll("*", "").replaceAll(",", "");
      if (lines !== undefined && /^\d+$/u.test(lines)) total = Number(lines);
      continue;
    }
    const area = cells[0]?.replaceAll("`", "").trim();
    const lines = cells[1]?.replaceAll(",", "");
    if (area === undefined || area.length === 0 || lines === undefined || !/^\d+$/u.test(lines)) {
      throw new Error(`native census record contains a malformed row: ${line}`);
    }
    rows.push({
      alternative: cells[4] ?? "",
      area,
      lines: Number(lines),
      liveProof: cells[3] ?? "",
      owner: cells[2] ?? "",
      verdict: cells[5] ?? "",
    });
  }
  return { rows, total };
}

/**
 * Reported, never fatal: the generated Lines column can trail the tree between a native edit and
 * the next `pnpm census`, and that lag must be loud without blocking on retyped arithmetic.
 */
export async function nativeCensusDrift(root: string): Promise<string[]> {
  const recordPath = path.join(root, "docs", "verification", "native-runtime-census-2026-08-16.md");
  if (!existsSync(recordPath)) return [];
  const record = await readFile(recordPath, "utf8");
  if (!record.includes("| Counted area | Lines | Owner |")) return [];

  let parsed: ReturnType<typeof parseNativeCensusTable>;
  try {
    parsed = parseNativeCensusTable(record);
  } catch {
    return ["native census record has a malformed row; run `pnpm census` after fixing it"];
  }
  const measurement = await measureNativeCensusAreas(root);
  const drift: string[] = [];
  for (const row of parsed.rows) {
    const measured = measurement.areas.get(row.area);
    if (measured !== undefined && measured !== row.lines) {
      drift.push(
        `native census drift: ${row.area} recorded ${row.lines.toLocaleString("en-US")}, measured ${measured.toLocaleString("en-US")} — run \`pnpm census\` to regenerate the Lines column`,
      );
    }
  }
  return drift;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  const verifyAttribution = process.argv.includes("--verify-framework-loc-attribution");
  const verification = verifyAttribution
    ? verifyFrameworkLocAttribution(process.cwd())
    : enforceBudgets(process.cwd());
  verification
    .then(async (report) => {
      if (verifyAttribution) {
        console.log(`framework LOC attribution verified: ${report.frameworkLoc} lines`);
        for (const drift of await nativeCensusDrift(process.cwd())) console.warn(drift);
      } else {
        for (const trigger of budgetTriggers(report)) console.warn(`budgets trigger: ${trigger}`);
        for (const drift of await nativeCensusDrift(process.cwd())) console.warn(drift);
        const textureLine =
          report.textureBytes === null
            ? "no compiled texture manifests found"
            : `texture bytes ${report.textureBytes.before} -> ${report.textureBytes.after} across ${report.textureBytes.textures} texture(s)`;
        console.log(
          `budgets ok: ${report.frameworkPackages} framework packages, ${report.exampleWorkspaces} example workspaces, ${report.frameworkLoc}/${LIMITS.frameworkLoc} framework LOC, ${report.nativeRuntimeLoc}/${LIMITS.nativeRuntimeLoc} native runtime LOC, ${report.prdFiles} PRD files, largest template ${Math.max(0, ...report.templates.map((template) => template.loc))} LOC, ${textureLine}`,
        );
      }
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
