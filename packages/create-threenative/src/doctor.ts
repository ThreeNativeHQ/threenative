import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * `threenative doctor` — check a generated project against the assumptions the build and the
 * native host make about it, before either of them fails in a way that reads as a game bug.
 *
 * Everything here is decided from a snapshot so the rules stay testable without a project on
 * disk; `readProject` is the only part that touches the filesystem.
 */

export type DoctorStatus = "ok" | "warn" | "fail";

export interface IDoctorCheck {
  readonly detail: string;
  readonly fix?: string;
  readonly name: string;
  readonly status: DoctorStatus;
}

export interface IDoctorReport {
  readonly checks: readonly IDoctorCheck[];
  readonly pass: boolean;
}

export interface IProjectSnapshot {
  /** Parsed `threenative.config.json`, or the `threenative` block of package.json. */
  readonly config: unknown;
  readonly files: ReadonlySet<string>;
  readonly installedVersions: ReadonlyMap<string, string>;
  readonly packageJson: unknown;
  readonly readText: (relative: string) => string | undefined;
}

const DEFAULT_NATIVE_ENTRY = "src/game.ts";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function declaredDependencies(packageJson: unknown): readonly string[] {
  const manifest = record(packageJson);
  if (manifest === undefined) return [];
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies"] as const) {
    for (const name of Object.keys(record(manifest[field]) ?? {})) {
      if (name.startsWith("@threenative/")) names.add(name);
    }
  }
  return [...names].sort();
}

function nativeEntryFrom(config: unknown): string {
  const configured = record(config)?.nativeEntry;
  return typeof configured === "string" && configured.length > 0
    ? configured
    : DEFAULT_NATIVE_ENTRY;
}

function dependencyChecks(snapshot: IProjectSnapshot): IDoctorCheck[] {
  const declared = declaredDependencies(snapshot.packageJson);
  const missing = declared.filter((name) => !snapshot.installedVersions.has(name));
  const installed = [...snapshot.installedVersions].sort(([a], [b]) => a.localeCompare(b));
  const versions = new Set(installed.map(([, version]) => version));
  return [
    missing.length > 0
      ? {
          detail: `declared but not installed: ${missing.join(", ")}`,
          fix: "Install dependencies: 'npm install' (or the package manager this project uses).",
          name: "dependencies",
          status: "fail",
        }
      : {
          detail:
            declared.length === 0
              ? "no @threenative packages declared"
              : `${declared.length} installed`,
          name: "dependencies",
          status: "ok",
        },
    versions.size > 1
      ? {
          detail: `@threenative packages disagree on version: ${installed
            .map(([name, version]) => `${name}@${version}`)
            .join(", ")}`,
          fix: "Install one version across all @threenative packages; mixed versions break at the package boundary.",
          name: "versions",
          status: "fail",
        }
      : {
          detail:
            versions.size === 0 ? "nothing installed to compare" : `all at ${[...versions][0]}`,
          name: "versions",
          status: "ok",
        },
  ];
}

function nativeEntryCheck(snapshot: IProjectSnapshot): IDoctorCheck {
  const entry = nativeEntryFrom(snapshot.config);
  if (!snapshot.files.has(entry)) {
    return {
      detail: `the portable entry ${entry} does not exist, so a native build has nothing to start`,
      fix: `Create ${entry} with a default game export, or point threenative.nativeEntry at the file that has one.`,
      name: "native entry",
      status: "fail",
    };
  }
  const source = snapshot.readText(entry) ?? "";
  if (!/export\s+default\b/u.test(source)) {
    return {
      detail: `${entry} has no default export; the native host rejects it with TN_NATIVE_ENTRY_NO_DEFAULT`,
      fix: `Add 'export default' to the game defined in ${entry}.`,
      name: "native entry",
      status: "fail",
    };
  }
  return { detail: `${entry} default-exports a game`, name: "native entry", status: "ok" };
}

export function diagnoseProject(snapshot: IProjectSnapshot): IDoctorReport {
  if (record(snapshot.packageJson) === undefined) {
    return {
      checks: [
        {
          detail: "no readable package.json in this directory",
          fix: "Run this inside a generated project, or scaffold one with 'npm create threenative@latest'.",
          name: "package.json",
          status: "fail",
        },
      ],
      pass: false,
    };
  }
  const hasPlaytests = [...snapshot.files].some((file) => file.endsWith(".playtest.json"));
  const checks: IDoctorCheck[] = [
    { detail: "readable", name: "package.json", status: "ok" },
    ...dependencyChecks(snapshot),
    nativeEntryCheck(snapshot),
    snapshot.files.has("src/main.ts")
      ? { detail: "src/main.ts is the web entry", name: "web entry", status: "ok" }
      : {
          detail: "no src/main.ts, so 'threenative build' has no web entry to bundle",
          fix: "Add src/main.ts, which mounts the game and any browser-only UI.",
          name: "web entry",
          status: "warn",
        },
    hasPlaytests
      ? { detail: "at least one scenario can prove this game", name: "playtests", status: "ok" }
      : {
          detail: "no *.playtest.json scenario, so nothing here proves the game runs",
          fix: "Create one: 'npx @threenative/playtest init'.",
          name: "playtests",
          status: "warn",
        },
    snapshot.files.has(".mcp.json")
      ? {
          detail: "capability search is wired for an authoring agent",
          name: "capability search",
          status: "ok",
        }
      : {
          detail:
            "no .mcp.json, so an agent here cannot search engine capabilities and will hand-write what exists",
          fix: "Restore the .mcp.json a scaffolded project ships, which wires threenative-engine-mcp.",
          name: "capability search",
          status: "warn",
        },
  ];
  return { checks, pass: checks.every(({ status }) => status !== "fail") };
}

async function collectFiles(root: string, relative = "", depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  const absolute = path.join(root, relative);
  if (!existsSync(absolute)) return [];
  const entries = await readdir(absolute, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".git")) continue;
    const next = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await collectFiles(root, next, depth + 1)));
    else files.push(next);
  }
  return files;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

export async function readProject(root: string): Promise<IProjectSnapshot> {
  const packageJson = await readJson(path.join(root, "package.json"));
  const configFile = await readJson(path.join(root, "threenative.config.json"));
  const config = configFile ?? record(packageJson)?.threenative;
  const files = new Set(await collectFiles(root));
  const installedVersions = new Map<string, string>();
  for (const name of declaredDependencies(packageJson)) {
    const manifest = await readJson(path.join(root, "node_modules", name, "package.json"));
    const version = record(manifest)?.version;
    if (typeof version === "string") installedVersions.set(name, version);
  }
  return {
    config,
    files,
    installedVersions,
    packageJson,
    readText: (relative) => {
      const file = path.join(root, relative);
      try {
        return existsSync(file) ? readFileSync(file, "utf8") : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

export function formatDoctorReport(report: IDoctorReport): string {
  const symbols: Record<DoctorStatus, string> = { fail: "✗", ok: "✓", warn: "!" };
  const lines = report.checks.map(
    ({ detail, fix, name, status }) =>
      `${symbols[status]} ${name}: ${detail}${fix === undefined || status === "ok" ? "" : `\n    fix: ${fix}`}`,
  );
  if (!report.pass) lines.push("\nAt least one check failed; fix it before trusting a build here.");
  return `${lines.join("\n")}\n`;
}
