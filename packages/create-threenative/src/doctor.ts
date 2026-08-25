import { existsSync, readFileSync, realpathSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  /** Resolved package root and readers for the optional native runtime package. */
  readonly readRuntimeText?: (relative: string) => string | undefined;
  readonly runtimeFileExists?: (relative: string) => boolean;
  readonly runtimeManifestUrl?: string;
  readonly runtimeRoot?: string;
}

const DEFAULT_NATIVE_ENTRY = "src/game.ts";
const RUNTIME_PACKAGE = "@threenative/runtime-native";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function declaredDependencies(packageJson: unknown): readonly string[] {
  const manifest = record(packageJson);
  if (manifest === undefined) return [];
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
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

interface IInstallStatus {
  readonly key?: unknown;
  readonly ok?: unknown;
  readonly reason?: unknown;
  readonly url?: unknown;
  readonly version?: unknown;
}

function nativeRuntimeKey(): string {
  return `${process.platform}-${process.arch}`;
}

function nativeRuntimeFilename(): string {
  return process.platform === "win32" ? "threenative-runtime.exe" : "threenative-runtime";
}

export function nativeRuntimeCheck(snapshot: IProjectSnapshot): IDoctorCheck {
  const key = nativeRuntimeKey();
  if (snapshot.runtimeRoot === undefined || snapshot.readRuntimeText === undefined) {
    return snapshot.installedVersions.has(RUNTIME_PACKAGE)
      ? {
          detail: `unavailable — ${RUNTIME_PACKAGE} is installed but its package root could not be resolved`,
          fix: "Reinstall dependencies so the native runtime package resolves from node_modules.",
          name: "native runtime",
          status: "fail",
        }
      : {
          detail: "unknown — no install status recorded",
          fix: "Install @threenative/runtime-native before building a native target.",
          name: "native runtime",
          status: "warn",
        };
  }

  const statusText = snapshot.readRuntimeText("prebuilt/install-status.json");
  if (statusText === undefined) {
    return {
      detail: "unknown — no install status recorded",
      fix: "Run npm install so the runtime install hook can record its result.",
      name: "native runtime",
      status: "warn",
    };
  }

  let status: IInstallStatus;
  try {
    const parsed: unknown = JSON.parse(statusText);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error("status is not an object");
    status = parsed as IInstallStatus;
  } catch (error) {
    return {
      detail: `unavailable — install status is malformed: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Remove node_modules/@threenative/runtime-native and run npm install again.",
      name: "native runtime",
      status: "fail",
    };
  }

  if (status.ok !== true) {
    const reason =
      typeof status.reason === "string" ? status.reason : "the install hook recorded no reason";
    return {
      detail: `unavailable — ${key}: ${reason}`,
      fix: "Fix the recorded prebuilt download failure, then run npm install again.",
      name: "native runtime",
      status: "fail",
    };
  }
  if (status.key !== key) {
    return {
      detail: `unavailable — install status is for ${String(status.key ?? "an unknown target")}, not ${key}`,
      fix: "Remove the runtime package and run npm install on this platform.",
      name: "native runtime",
      status: "fail",
    };
  }
  const installedVersion = snapshot.installedVersions.get(RUNTIME_PACKAGE);
  if (status.version !== installedVersion) {
    return {
      detail: `unavailable — install status version ${String(status.version ?? "is missing")} does not match installed runtime ${String(installedVersion ?? "with no version")}`,
      fix: "Remove the runtime package and run npm install to refresh its prebuilt status.",
      name: "native runtime",
      status: "fail",
    };
  }
  if (snapshot.runtimeManifestUrl === undefined) {
    return {
      detail: "unavailable — the installed runtime release URL contract could not be loaded",
      fix: "Reinstall @threenative/runtime-native so scripts/install-prebuilt.mjs is present.",
      name: "native runtime",
      status: "fail",
    };
  }
  if (status.url !== snapshot.runtimeManifestUrl) {
    return {
      detail: `unavailable — install status release URL ${String(status.url ?? "is missing")} does not match ${snapshot.runtimeManifestUrl}`,
      fix: "Remove the runtime package and run npm install to fetch the current release manifest.",
      name: "native runtime",
      status: "fail",
    };
  }

  const binary = `prebuilt/${key}/${nativeRuntimeFilename()}`;
  const exists =
    snapshot.runtimeFileExists?.(binary) ?? existsSync(path.join(snapshot.runtimeRoot, binary));
  if (!exists) {
    return {
      detail: `unavailable — ${key} prebuilt binary is missing`,
      fix: "Run npm install again to restore the native runtime prebuilt.",
      name: "native runtime",
      status: "fail",
    };
  }
  return { detail: `available (${key})`, name: "native runtime", status: "ok" };
}

function runtimeFileAvailable(snapshot: IProjectSnapshot, relative: string): boolean {
  if (snapshot.runtimeRoot === undefined) return false;
  return (
    snapshot.runtimeFileExists?.(relative) ?? existsSync(path.join(snapshot.runtimeRoot, relative))
  );
}

function targetChecks(
  snapshot: IProjectSnapshot,
  nativeRuntime: IDoctorCheck,
): readonly IDoctorCheck[] {
  const webAvailable = snapshot.files.has("src/main.ts");
  const desktopDetail =
    nativeRuntime.status === "ok"
      ? nativeRuntime.detail
      : `unavailable — ${nativeRuntime.detail.replace(/^(?:unavailable|unknown) — /u, "")}`;
  const androidPackager = runtimeFileAvailable(snapshot, "scripts/package-android.mjs");
  const iosPackager = runtimeFileAvailable(snapshot, "scripts/package-ios.mjs");
  const iosHost = process.platform === "darwin" && process.arch === "arm64";
  return [
    webAvailable
      ? { detail: "available — src/main.ts", name: "target web", status: "ok" }
      : {
          detail: "unavailable — src/main.ts is missing",
          name: "target web",
          status: "warn",
        },
    {
      detail: desktopDetail,
      name: "target desktop",
      status: nativeRuntime.status,
    },
    androidPackager
      ? {
          detail:
            "available — runtime packager installed; Android SDK and JDK are checked by build",
          name: "target android",
          status: "ok",
        }
      : {
          detail: "unavailable — @threenative/runtime-native has no Android packager",
          name: "target android",
          status: snapshot.runtimeRoot === undefined ? "warn" : "fail",
        },
    iosHost && iosPackager
      ? {
          detail: "available — darwin-arm64 simulator packager installed",
          name: "target ios",
          status: "ok",
        }
      : {
          detail: iosHost
            ? "unavailable — @threenative/runtime-native has no iOS packager"
            : `unavailable — iOS simulator packaging requires darwin-arm64; received ${process.platform}-${process.arch}`,
          name: "target ios",
          status: iosHost ? "fail" : "warn",
        },
  ];
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
  const nativeRuntime = nativeRuntimeCheck(snapshot);
  const checks: IDoctorCheck[] = [
    { detail: "readable", name: "package.json", status: "ok" },
    ...dependencyChecks(snapshot),
    nativeEntryCheck(snapshot),
    nativeRuntime,
    ...targetChecks(snapshot, nativeRuntime),
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

async function runtimeReleaseManifestUrl(
  runtimeRoot: string,
  version: string,
): Promise<string | undefined> {
  try {
    const module: unknown = await import(
      pathToFileURL(path.join(runtimeRoot, "scripts", "install-prebuilt.mjs")).href
    );
    const releaseUrl = record(module)?.releaseManifestUrl;
    if (typeof releaseUrl !== "function") return undefined;
    const result: unknown = releaseUrl(version);
    return typeof result === "string" ? result : undefined;
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
  const runtimeRoot = installedVersions.has(RUNTIME_PACKAGE)
    ? (() => {
        const candidate = path.join(root, "node_modules", RUNTIME_PACKAGE);
        try {
          return realpathSync(candidate);
        } catch {
          return undefined;
        }
      })()
    : undefined;
  const runtimeVersion = installedVersions.get(RUNTIME_PACKAGE);
  const runtimeManifestUrl =
    runtimeRoot === undefined || runtimeVersion === undefined
      ? undefined
      : await runtimeReleaseManifestUrl(runtimeRoot, runtimeVersion);
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
    ...(runtimeRoot === undefined
      ? {}
      : {
          readRuntimeText: (relative: string) => {
            try {
              return readFileSync(path.join(runtimeRoot, relative), "utf8");
            } catch {
              return undefined;
            }
          },
          runtimeFileExists: (relative: string) => existsSync(path.join(runtimeRoot, relative)),
          ...(runtimeManifestUrl === undefined ? {} : { runtimeManifestUrl }),
          runtimeRoot,
        }),
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
