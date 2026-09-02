import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const VFX_NIAGARA_FIXTURE = path.join("scripts", "fixtures", "vfx-niagara-46-effects.json");

export const REQUIRED_GROUPS = Object.freeze({
  "webgpu-vfx": 21,
  Effekseer: 15,
  extras: 10,
});

export const EXPECTED_EFFECT_IDS = [
  "fire",
  "jet-flame",
  "burst-flash",
  "muzzle-flash",
  "smoke",
  "dust-cloud",
  "steam-plume",
  "ash-plume",
  "explosion-cloud",
  "impact-dust",
  "ground-mist",
  "poison-cloud",
  "rain",
  "snow",
  "spark-streaks",
  "impact-sparks",
  "ember-fountain",
  "magic-wisp",
  "magic-orb",
  "magic-beam",
  "healing-aura",
  "effekseer-fire01",
  "effekseer-fire02",
  "effekseer-fire03",
  "effekseer-lightning01",
  "effekseer-lightning02",
  "effekseer-lightning03",
  "effekseer-ice01",
  "effekseer-ice02",
  "effekseer-ice03",
  "effekseer-holy01",
  "effekseer-hit01",
  "effekseer-hit02",
  "effekseer-wind01",
  "effekseer-wind02",
  "effekseer-wind03",
  "kenney-slash-arc",
  "kenney-confetti-burst",
  "kenney-leaf-swirl",
  "pixi-bubble-stream",
  "pixi-cartoon-smoke-blast",
  "godot-fireflies",
  "godot-portal-vortex",
  "godot-blood-splash",
  "godot-shield-break",
  "godot-waterfall-mist",
] as const;

type CoverageRow = {
  readonly id?: unknown;
  readonly group?: unknown;
  readonly donorRepository?: unknown;
  readonly donorCommit?: unknown;
  readonly donorFile?: unknown;
  readonly license?: unknown;
  readonly adaptation?: unknown;
  readonly renderSource?: unknown;
  readonly caller?: unknown;
  readonly runtimeCodeCopied?: unknown;
  readonly binaryAssetCopied?: unknown;
};

export type VfxNiagaraCoverage = {
  readonly effects?: readonly CoverageRow[];
  readonly requiredGroups?: Readonly<Record<string, number>>;
};

export type CoverageValidationOptions = {
  readonly root?: string;
  readonly checkTargets?: boolean;
};

export function readCoverage(root = process.cwd()): VfxNiagaraCoverage {
  const file = path.join(root, VFX_NIAGARA_FIXTURE);
  return JSON.parse(readFileSync(file, "utf8")) as VfxNiagaraCoverage;
}

function unresolved(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "" || /TBD|→impl/u.test(value);
}

const PROVENANCE_FIELDS = [
  "donorRepository",
  "donorCommit",
  "donorFile",
  "license",
  "adaptation",
  "renderSource",
  "caller",
] as const;

function rowLabel(row: CoverageRow, index: number): string {
  return typeof row.id === "string" ? row.id : `row ${index}`;
}

function validateRow(
  row: CoverageRow,
  index: number,
  ids: Set<string>,
  groupCounts: Map<string, number>,
): string[] {
  const label = rowLabel(row, index);
  const errors: string[] = [];
  if (typeof row.id !== "string" || row.id.trim() === "") {
    errors.push(`${label}: id must be a non-empty string`);
  } else if (ids.has(row.id)) {
    errors.push(`${label}: duplicate effect id`);
  } else {
    ids.add(row.id);
  }
  if (typeof row.group !== "string" || !(row.group in REQUIRED_GROUPS)) {
    errors.push(`${label}: group must be webgpu-vfx, Effekseer, or extras`);
  } else {
    groupCounts.set(row.group, (groupCounts.get(row.group) ?? 0) + 1);
  }
  for (const field of PROVENANCE_FIELDS) {
    if (unresolved(row[field])) errors.push(`${label}: ${field} is missing or unresolved`);
  }
  if (typeof row.donorCommit !== "string" || !/^[0-9a-f]{40}$/u.test(row.donorCommit)) {
    errors.push(`${label}: donorCommit must be a 40-character pinned commit`);
  }
  if (row.runtimeCodeCopied !== false) errors.push(`${label}: runtimeCodeCopied must be false`);
  if (row.binaryAssetCopied !== false) errors.push(`${label}: binaryAssetCopied must be false`);
  return errors;
}

function validateTargetReference(
  row: CoverageRow,
  field: "renderSource" | "caller",
  root: string,
): string[] {
  const reference = row[field];
  if (typeof reference !== "string") return [];
  const label = typeof row.id === "string" ? row.id : "unknown effect";
  const [relativeFile, symbol] = reference.split("#", 2);
  const file = path.join(root, relativeFile ?? reference);
  if (!existsSync(file)) return [`${label}: ${field} file does not exist: ${reference}`];
  if (symbol !== undefined && !readFileSync(file, "utf8").includes(symbol)) {
    return [`${label}: ${field} symbol is not present: ${reference}`];
  }
  return [];
}

function validateEffectCollection(effects: readonly CoverageRow[]): string[] {
  const errors: string[] = [];
  if (effects.length !== 46) {
    errors.push(`expected exactly 46 effects; received ${effects.length}`);
    if (effects.length === 36) errors.push("stale archive report total 36 is rejected");
  }
  const ids = new Set<string>();
  const groupCounts = new Map<string, number>();
  for (const [index, row] of effects.entries())
    errors.push(...validateRow(row, index, ids, groupCounts));
  const missingIds = EXPECTED_EFFECT_IDS.filter((id) => !ids.has(id));
  const unexpectedIds = [...ids].filter(
    (id) => !(EXPECTED_EFFECT_IDS as readonly string[]).includes(id),
  );
  if (missingIds.length > 0) errors.push(`missing effect id(s): ${missingIds.join(",")}`);
  if (unexpectedIds.length > 0) errors.push(`unexpected effect id(s): ${unexpectedIds.join(",")}`);
  for (const [group, expected] of Object.entries(REQUIRED_GROUPS)) {
    const actual = groupCounts.get(group) ?? 0;
    if (actual !== expected) errors.push(`${group} requires ${expected} rows; received ${actual}`);
  }
  return errors;
}

function validateTargetReferences(effects: readonly CoverageRow[], root: string): string[] {
  return effects.flatMap((row) => [
    ...validateTargetReference(row, "renderSource", root),
    ...validateTargetReference(row, "caller", root),
  ]);
}

export function validateCoverage(
  coverage: VfxNiagaraCoverage,
  options: CoverageValidationOptions = {},
): readonly string[] {
  const errors: string[] = [];
  const effects = coverage.effects;
  if (!Array.isArray(effects)) return ["effects must be an array"];
  errors.push(...validateEffectCollection(effects));
  if (options.checkTargets !== false)
    errors.push(...validateTargetReferences(effects, options.root ?? process.cwd()));
  return errors;
}

export function formatCoverageSummary(coverage: VfxNiagaraCoverage): string {
  const effects = coverage.effects ?? [];
  const counts = new Map<string, number>();
  for (const row of effects) {
    if (typeof row.group === "string") counts.set(row.group, (counts.get(row.group) ?? 0) + 1);
  }
  return `vfx-niagara coverage: ${effects.length} accounted (${counts.get("webgpu-vfx") ?? 0} webgpu-vfx, ${counts.get("Effekseer") ?? 0} Effekseer, ${counts.get("extras") ?? 0} extras)`;
}

function main(): void {
  const coverage = readCoverage();
  const errors = validateCoverage(coverage);
  if (errors.length > 0) {
    console.error(
      `TN_VFX_NIAGARA_COVERAGE_FAILED:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `${formatCoverageSummary(coverage)}; provenance pinned; runtime and binary reuse disabled`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
)
  main();
