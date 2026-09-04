import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  closeSync,
  existsSync,
  constants as fsConstants,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Bundled into the CLI at build time, exactly like the MCP server table: `detect.ts` uses only
// node builtins, so inlining it adds no runtime dependency to the published `create-threenative`.
import { installCommandFor, resolveBlender } from "threenative-blender-mcp/bridge";

import { loadConfig } from "./config.js";
import {
  type IMcpPackage,
  MCP_PACKAGES,
  MCP_SERVERS,
  serverEntryPath,
  serverPackageKey,
} from "./mcp-servers.js";

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
  /** Resolved TypeScript config, or the single sanctioned package.json `nativeEntry`
   *  fallback when TypeScript is absent — the same surfaces the build path reads. */
  readonly config: unknown;
  readonly files: ReadonlySet<string>;
  readonly installedVersions: ReadonlyMap<string, string>;
  readonly packageJson: unknown;
  /** Absolute project root, available to checks that validate recorded build evidence. */
  readonly projectRoot?: string;
  readonly readText: (relative: string) => string | undefined;
  /** Resolved package root and readers for the optional native runtime package. */
  readonly readRuntimeText?: (relative: string) => string | undefined;
  readonly runtimeFileExists?: (relative: string) => boolean;
  readonly runtimeManifestUrl?: string;
  readonly runtimeRoot?: string;
  /** Desktop UI overlay preflight, when the machine exposes a display to probe. */
  readonly desktopOverlay?: IDesktopOverlayProbe;
  /** Optional seams used by the diagnostic checks and by deterministic unit fixtures. */
  readonly androidToolchain?: IAndroidToolchainProbe;
  /** Blender discovery, injected so the check is testable on a machine either way. */
  readonly blender?: IBlenderProbe;
  readonly directoryWritable?: (relative: string) => boolean | undefined;
  readonly mcpServerHealth?: ReadonlyMap<string, IMcpServerHealth>;
  readonly playtestRunnerPath?: string;
  readonly resolvePackageDirectory?: (name: string) => string | undefined;
  readonly runPlaytestDoctor?: () => string;
}

/** What `resolveBlender` answers, narrowed to what doctor reports. */
export interface IBlenderProbe {
  readonly available: boolean;
  readonly detail: string;
  readonly installCommand: string;
  readonly version?: string;
}

export interface IMcpServerHealth {
  readonly detail: string;
  readonly status: "fail" | "ok";
}

export interface IDesktopOverlayProbe {
  readonly detail: string;
  readonly fix: string;
  readonly status: DoctorStatus;
}

export interface IAndroidToolchainProbe {
  readonly jdkMajor?: number;
  readonly jdkVersion?: string;
  readonly sdkVersion?: string;
  readonly status?: DoctorStatus;
}

const DEFAULT_NATIVE_ENTRY = "src/game.ts";
const RUNTIME_PACKAGE = "@threenative/runtime-native";
const PLAYTEST_BINARY = "threenative-playtest";
const ANDROID_JDK_MAJOR = 17;
const ANDROID_COMPILE_SDK = 35;

interface IMcpServerSpec {
  readonly configName: string;
  readonly expectedArgs: string;
  readonly packageName: string;
  readonly version: string;
}

/** The engine server resolves to `@threenative/core` itself, not to the package `MCP_PACKAGES`
 * names: core bundles engine discovery and only falls back to `threenative-engine-mcp` over npx in
 * a development checkout whose bundle has not been built. Doctor probes what the project actually
 * resolves, so it must name core — and core's own version, which `doctor.spec.ts` holds equal to
 * `packages/core/package.json`. */
const CORE_PACKAGE_NAME = "@threenative/core";
const CORE_PACKAGE_VERSION = "0.3.0";
const CORE_RESOLVED_SERVERS: ReadonlySet<string> = new Set([
  "threenative-engine",
  "threenative-blender",
]);

export const MCP_SERVER_SPECS: readonly IMcpServerSpec[] = Object.entries(MCP_SERVERS).map(
  ([configName, server]) => {
    const resolvesToCore = CORE_RESOLVED_SERVERS.has(configName);
    const key = serverPackageKey(server);
    const declared = MCP_PACKAGES[key];
    if (!resolvesToCore && declared === undefined) {
      throw new Error(
        `TN_DOCTOR_MCP_TABLE: MCP server '${configName}' launches '${key}.mjs', which MCP_PACKAGES does not declare.`,
      );
    }
    return {
      configName,
      expectedArgs: serverEntryPath(server),
      packageName: resolvesToCore ? CORE_PACKAGE_NAME : (declared as IMcpPackage).name,
      version: resolvesToCore ? CORE_PACKAGE_VERSION : (declared as IMcpPackage).version,
    };
  },
);

const ASSET_DOWNLOAD_DIRECTORIES = ["public/assets", "public/audio"] as const;
/** The model sources `blenderImportPass` owns; kept equal to `BLENDER_SOURCE_EXTENSIONS`. */
const BLENDER_SOURCE_SUFFIXES = [".fbx", ".blend", ".obj", ".dae"] as const;

type CompositorProbe = (environment: NodeJS.ProcessEnv) => boolean | undefined;

export function detectX11Compositor(
  environment: NodeJS.ProcessEnv = process.env,
): boolean | undefined {
  if (environment.DISPLAY === undefined) return undefined;
  try {
    const output = execFileSync("xprop", ["-root", "_NET_WM_CM_S0"], {
      encoding: "utf8",
      env: { ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return /window id\s*#/u.test(output);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : false;
  }
}

export function probeDesktopOverlay(
  environment: NodeJS.ProcessEnv = process.env,
  compositor: CompositorProbe = detectX11Compositor,
): IDesktopOverlayProbe {
  const wayland =
    environment.WAYLAND_DISPLAY !== undefined || environment.XDG_SESSION_TYPE === "wayland";
  if (wayland) {
    return {
      detail: "the transparent container could not be created on this Wayland/Xwayland session",
      fix: "Run the desktop target under an X11 session (for example SDL_VIDEODRIVER=x11) or use the web UI target.",
      status: "fail",
    };
  }
  if (environment.DISPLAY === undefined) {
    return {
      detail: "no display is available, so the desktop overlay could not be probed",
      fix: "Run doctor in the display session that will host the desktop target.",
      status: "warn",
    };
  }
  const present = compositor(environment);
  if (present === true) {
    return {
      detail: "an X11 compositing manager owns _NET_WM_CM_S0; transparent overlay alpha can blend",
      fix: "",
      status: "ok",
    };
  }
  if (present === false) {
    return {
      detail: "no compositing manager is running, so nothing would blend the overlay",
      fix: "Start a compositing manager or run the desktop target under a composited X11 session.",
      status: "fail",
    };
  }
  return {
    detail: "the X11 compositor probe could not run, so overlay transparency is unknown",
    fix: "Install xprop and rerun doctor in the desktop display session.",
    status: "warn",
  };
}

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

function usesDesktopOverlay(config: unknown): boolean {
  return record(record(config)?.ui)?.renderer === "web";
}

/** Builds resolve only the TypeScript config plus the single sanctioned package.json
 *  `nativeEntry` fallback, so doctor reports no other legacy surface as the config. */
function nativeEntryCompat(value: unknown): { nativeEntry: string } | undefined {
  const entry = record(value)?.nativeEntry;
  return typeof entry === "string" && entry.length > 0 ? { nativeEntry: entry } : undefined;
}

function resolvePackageDirectoryFrom(start: string, name: string): string | undefined {
  let directory = path.resolve(start);
  while (true) {
    const candidate = path.join(directory, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function resolvePackageDirectory(snapshot: IProjectSnapshot, name: string): string | undefined {
  if (snapshot.resolvePackageDirectory !== undefined) {
    return snapshot.resolvePackageDirectory(name);
  }
  if (snapshot.projectRoot === undefined) return undefined;
  const direct = resolvePackageDirectoryFrom(snapshot.projectRoot, name);
  if (direct !== undefined) return direct;
  const core = resolvePackageDirectoryFrom(snapshot.projectRoot, "@threenative/core");
  if (core === undefined) return undefined;
  try {
    return resolvePackageDirectoryFrom(realpathSync(core), name);
  } catch {
    return undefined;
  }
}

function resolveBinaryFrom(start: string, name: string): string | undefined {
  let directory = path.resolve(start);
  while (true) {
    const binDirectory = path.join(directory, "node_modules", ".bin");
    const candidates =
      process.platform === "win32"
        ? [path.join(binDirectory, `${name}.cmd`), path.join(binDirectory, name)]
        : [path.join(binDirectory, name)];
    const found = candidates.find((candidate) => existsSync(candidate));
    if (found !== undefined) return found;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function expectedMcpServer(spec: IMcpServerSpec): Record<string, unknown> {
  return {
    command: "node",
    args: [spec.expectedArgs],
    ...(spec.configName === "threenative-assets"
      ? {
          env: Object.fromEntries([
            ["ASSET_DOWNLOAD_DIR", "./public/assets"],
            ["AUDIO_DOWNLOAD_DIR", "./public/audio"],
          ]),
        }
      : {}),
  };
}

function mcpServerMatches(spec: IMcpServerSpec, value: unknown): boolean {
  const server = record(value);
  if (server === undefined || server.command !== "node") return false;
  if (
    !Array.isArray(server.args) ||
    server.args.length !== 1 ||
    server.args[0] !== spec.expectedArgs
  )
    return false;
  if (spec.configName !== "threenative-assets") return true;
  const env = record(server.env);
  return (
    env?.ASSET_DOWNLOAD_DIR === "./public/assets" && env.AUDIO_DOWNLOAD_DIR === "./public/audio"
  );
}

function mcpConfig(
  snapshot: IProjectSnapshot,
):
  | { readonly kind: "missing" }
  | { readonly kind: "malformed"; readonly detail: string }
  | { readonly kind: "ready"; readonly servers: Record<string, unknown> } {
  if (!snapshot.files.has(".mcp.json")) return { kind: "missing" };
  const source = snapshot.readText(".mcp.json");
  if (source === undefined) return { detail: ".mcp.json could not be read", kind: "malformed" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    return {
      detail: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      kind: "malformed",
    };
  }
  const root = record(parsed);
  const servers = record(root?.mcpServers);
  return servers === undefined
    ? { detail: "missing an object-valued mcpServers property", kind: "malformed" }
    : { kind: "ready", servers };
}

function mcpServerCheck(
  snapshot: IProjectSnapshot,
  spec: IMcpServerSpec,
  value: unknown,
): IDoctorCheck {
  const name = `capability search: ${spec.packageName}`;
  if (value === undefined) {
    return {
      detail: `${spec.configName} is missing from .mcp.json; expected ${spec.packageName}@${spec.version}`,
      fix: "Restore the server entry from the generated .mcp.json.",
      name,
      status: "fail",
    };
  }
  if (!mcpServerMatches(spec, value)) {
    return {
      detail: `${spec.configName} is hand-edited or malformed; expected ${JSON.stringify(expectedMcpServer(spec))}`,
      fix: "Restore the generated .mcp.json entry so the ThreeNative shim and asset directories remain wired.",
      name,
      status: "fail",
    };
  }
  if (
    snapshot.projectRoot !== undefined &&
    !existsSync(path.resolve(snapshot.projectRoot, spec.expectedArgs))
  ) {
    return {
      detail: `${spec.configName} points at missing ${spec.expectedArgs}; @threenative/core is not providing the configured server shim`,
      fix: "Install @threenative/core again so the generated MCP server entry exists.",
      name,
      status: "fail",
    };
  }
  const health = snapshot.mcpServerHealth?.get(spec.configName);
  if (health?.status === "fail") {
    return {
      detail: `${spec.configName} is configured, but ${health.detail}`,
      fix: `Reinstall @threenative/core and ${spec.packageName}, then rerun doctor.`,
      name,
      status: "fail",
    };
  }
  const packageDirectory = resolvePackageDirectory(snapshot, spec.packageName);
  if (packageDirectory === undefined) {
    return {
      detail: `${spec.configName} is reachable by npx only: ${spec.packageName}@${spec.version} is not installed (npx --yes ${spec.packageName}@${spec.version})`,
      fix: `Install ${spec.packageName}@${spec.version} when this server is needed, or use the npx fallback named above.`,
      name,
      status: "warn",
    };
  }
  const manifest = readJsonSync(path.join(packageDirectory, "package.json"));
  const installedVersion = record(manifest)?.version;
  if (typeof installedVersion !== "string") {
    return {
      detail: `${spec.configName} resolves ${spec.packageName}, but its package.json has no version`,
      fix: `Reinstall ${spec.packageName}@${spec.version}.`,
      name,
      status: "fail",
    };
  }
  if (installedVersion !== spec.version) {
    return {
      detail: `${spec.configName} resolves ${spec.packageName}@${installedVersion}; the .mcp.json fallback is ${spec.packageName}@${spec.version}`,
      fix: `Install ${spec.packageName}@${spec.version} so the capability contract is version-matched.`,
      name,
      status: "warn",
    };
  }
  return {
    detail: `${spec.configName} resolves ${spec.packageName}@${installedVersion}${health === undefined ? "" : `; ${health.detail}`}`,
    name,
    status: "ok",
  };
}

function probeMcpServer(projectRoot: string, spec: IMcpServerSpec): IMcpServerHealth {
  const initialize = JSON.stringify({
    id: 1,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "threenative-doctor", version: "0.3.0" },
      protocolVersion: "2025-06-18",
    },
  });
  const initialized = JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  const list = JSON.stringify({ id: 2, jsonrpc: "2.0", method: "tools/list", params: {} });
  const result = spawnSync("node", [spec.expectedArgs], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...(spec.configName === "threenative-assets"
        ? Object.fromEntries([
            ["ASSET_DOWNLOAD_DIR", "./public/assets"],
            ["AUDIO_DOWNLOAD_DIR", "./public/audio"],
          ])
        : {}),
    },
    input: `${initialize}\n${initialized}\n${list}\n`,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 5_000,
  });
  if (result.error !== undefined || result.status !== 0) {
    const stderr = result.stderr.trim();
    const reason =
      result.error?.message ?? (stderr.length > 0 ? stderr : `exited ${result.status}`);
    return { detail: `its MCP transport failed to start: ${reason}`, status: "fail" };
  }
  const responses = result.stdout
    .split(/\r?\n/u)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    })
    .map(record)
    .filter((value): value is Record<string, unknown> => value !== undefined);
  const initializeResponse = responses.find(({ id }) => id === 1);
  const listResponse = responses.find(({ id }) => id === 2);
  const tools = record(listResponse?.result)?.tools;
  if (
    record(initializeResponse?.result) === undefined ||
    !Array.isArray(tools) ||
    tools.length === 0
  ) {
    return {
      detail: "its MCP transport did not complete initialize and advertise tools",
      status: "fail",
    };
  }
  return { detail: `transport initialized and advertised ${tools.length} tool(s)`, status: "ok" };
}

function mcpSummary(serverChecks: readonly IDoctorCheck[]): IDoctorCheck {
  const failed = serverChecks.filter(({ status }) => status === "fail").length;
  const warned = serverChecks.filter(({ status }) => status === "warn").length;
  const status: DoctorStatus = failed > 0 ? "fail" : warned > 0 ? "warn" : "ok";
  return {
    detail:
      status === "ok"
        ? "all three configured MCP servers resolve"
        : `${serverChecks.length - failed - warned} server(s) resolve; ${warned} reachable by npx only; ${failed} malformed or missing`,
    fix: status === "ok" ? undefined : "Inspect the per-server capability search checks below.",
    name: "capability search",
    status,
  };
}

function capabilitySearchChecks(snapshot: IProjectSnapshot): readonly IDoctorCheck[] {
  const config = mcpConfig(snapshot);
  if (config.kind === "missing") {
    return [
      {
        detail:
          "no .mcp.json, so an agent here cannot search engine capabilities and will hand-write what exists",
        fix: "Restore the .mcp.json a scaffolded project ships, which wires the ThreeNative MCP servers.",
        name: "capability search",
        status: "fail",
      },
    ];
  }
  if (config.kind === "malformed") {
    return [
      {
        detail: `.mcp.json is malformed: ${config.detail}`,
        fix: "Restore a valid generated .mcp.json, preserving any unrelated servers.",
        name: "capability search",
        status: "fail",
      },
    ];
  }
  const serverChecks = MCP_SERVER_SPECS.map((spec) =>
    mcpServerCheck(snapshot, spec, config.servers[spec.configName]),
  );
  return [mcpSummary(serverChecks), ...serverChecks];
}

function readJsonSync(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function addCommandTargets(targets: Set<string>, value: unknown): void {
  if (typeof value !== "string") return;
  for (const match of value.matchAll(/--target(?:=|\s+)(web|desktop|android|ios)\b/gu)) {
    const target = match[1];
    if (target !== undefined) targets.add(target);
  }
}

function addConfiguredTargets(targets: Set<string>, value: unknown): void {
  if (Array.isArray(value)) {
    for (const target of value) if (typeof target === "string") targets.add(target);
  } else if (typeof value === "string") {
    targets.add(value);
  }
}

function configuredTargets(snapshot: IProjectSnapshot): readonly string[] {
  const targets = new Set<string>();
  const packageScripts = record(record(snapshot.packageJson)?.scripts);
  for (const value of Object.values(packageScripts ?? {})) addCommandTargets(targets, value);
  const configRecord = record(snapshot.config);
  for (const key of ["targets", "nativeTargets"] as const)
    addConfiguredTargets(targets, configRecord?.[key]);
  return [...targets];
}

function directoryCanBeWritten(snapshot: IProjectSnapshot, relative: string): boolean | undefined {
  if (snapshot.directoryWritable !== undefined) return snapshot.directoryWritable(relative);
  if (snapshot.projectRoot === undefined) return undefined;
  const root = path.resolve(snapshot.projectRoot);
  let candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return false;
  while (candidate !== root && !existsSync(candidate)) candidate = path.dirname(candidate);
  if (!existsSync(candidate)) return false;
  try {
    if (!statSync(candidate).isDirectory()) return false;
    accessSync(candidate, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function assetPipelineCheck(snapshot: IProjectSnapshot): IDoctorCheck {
  const details: string[] = [];
  let status: DoctorStatus = "ok";
  for (const directory of ASSET_DOWNLOAD_DIRECTORIES) {
    const writable = directoryCanBeWritten(snapshot, directory);
    if (writable === false) {
      details.push(`${directory} is not writable and cannot receive MCP downloads`);
      status = "warn";
    } else if (writable === true) {
      details.push(`${directory} exists or can be created`);
    } else {
      details.push(`${directory} was not probed in this in-memory snapshot`);
    }
  }

  const assets = record(record(snapshot.config)?.assets) ?? {};
  const mobileTargets = configuredTargets(snapshot).filter(
    (target) => target === "android" || target === "ios",
  );
  if (mobileTargets.length > 0) {
    const textures = assets.textures;
    if (textures !== "none") {
      details.push(
        `TN_NATIVE_KTX2_UNSUPPORTED: assets.textures compiles textures for ${mobileTargets.join("/")}; mobile native targets require assets.textures to be "none"`,
      );
      status = "warn";
    }
    const models = assets.models;
    if (models !== "none") {
      details.push(
        `TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED: assets.models compiles model geometry for ${mobileTargets.join("/")}; mobile native targets require assets.models to be "none"`,
      );
      status = "warn";
    }
  }
  return {
    detail: details.join("; "),
    ...(status === "ok"
      ? {}
      : {
          fix: "Make public/assets and public/audio writable, and disable compiled assets for Android/iOS native builds.",
        }),
    name: "asset pipeline",
    status,
  };
}

function androidToolchainStatus(probe: IAndroidToolchainProbe): IDoctorCheck {
  const details: string[] = [];
  let status: DoctorStatus = probe.status ?? "ok";
  if (probe.jdkVersion === undefined || probe.jdkMajor === undefined) {
    details.push(`JDK not found; Android builds require JDK ${ANDROID_JDK_MAJOR}`);
    status = "warn";
  } else if (probe.jdkMajor !== ANDROID_JDK_MAJOR) {
    details.push(
      `JDK ${probe.jdkVersion} found; Android builds support JDK ${ANDROID_JDK_MAJOR} only`,
    );
    status = "warn";
  } else {
    details.push(`JDK ${probe.jdkVersion} found (supported JDK ${ANDROID_JDK_MAJOR})`);
  }
  if (probe.sdkVersion === undefined) {
    details.push(`Android SDK platform android-${ANDROID_COMPILE_SDK} not found`);
    status = "warn";
  } else {
    details.push(`Android SDK platform android-${ANDROID_COMPILE_SDK} ${probe.sdkVersion} found`);
  }
  return {
    detail: details.join("; "),
    fix:
      status === "ok"
        ? undefined
        : `Install Android SDK platform android-${ANDROID_COMPILE_SDK} and JDK ${ANDROID_JDK_MAJOR}, or set ANDROID_HOME or ANDROID_SDK_ROOT and JAVA_HOME (or put JDK ${ANDROID_JDK_MAJOR} on PATH).`,
    name: "android toolchain",
    status,
  };
}

function playtestRunner(snapshot: IProjectSnapshot): string | undefined {
  if (snapshot.playtestRunnerPath !== undefined) return snapshot.playtestRunnerPath;
  return snapshot.projectRoot === undefined
    ? undefined
    : resolveBinaryFrom(snapshot.projectRoot, PLAYTEST_BINARY);
}

function missingPlaytestCheck(snapshot: IProjectSnapshot): IDoctorCheck {
  return {
    detail:
      snapshot.projectRoot === undefined
        ? "runner was not probed in this in-memory snapshot"
        : "threenative-playtest is missing from node_modules/.bin",
    fix: "Install the test runner: npm install -D @threenative/playtest, then rerun doctor.",
    name: "playtest",
    status: snapshot.projectRoot === undefined ? "warn" : "fail",
  };
}

function childOutput(value: unknown): string | undefined {
  const text =
    typeof value === "string" ? value : Buffer.isBuffer(value) ? value.toString("utf8") : undefined;
  const trimmed = text?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function playtestFailureDetail(error: unknown): string {
  const fields = record(error);
  const output = [childOutput(fields?.stderr), childOutput(fields?.stdout)]
    .filter((value): value is string => value !== undefined)
    .join("\n");
  return output.length > 0 ? output : error instanceof Error ? error.message : String(error);
}

function playtestInvocation(runner: string): {
  readonly args: readonly string[];
  readonly command: string;
} {
  if (process.platform !== "win32" || !/\.cmd$/iu.test(runner)) {
    return { args: ["doctor", "--text"], command: runner };
  }
  const command = process.env.ComSpec ?? process.env.COMSPEC ?? "cmd.exe";
  return {
    args: ["/d", "/s", "/c", `"${runner}" doctor --text`],
    command,
  };
}

function executePlaytestDoctor(runner: string, projectRoot: string | undefined): string {
  const invocation = playtestInvocation(runner);
  return execFileSync(invocation.command, invocation.args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
}

function playtestCheck(snapshot: IProjectSnapshot): IDoctorCheck {
  const runner = playtestRunner(snapshot);
  if (runner === undefined) return missingPlaytestCheck(snapshot);
  try {
    const output =
      snapshot.runPlaytestDoctor?.() ?? executePlaytestDoctor(runner, snapshot.projectRoot);
    const detail = output.trim();
    return {
      detail:
        detail.length === 0
          ? "threenative-playtest doctor completed"
          : `threenative-playtest doctor completed:\n${detail}`,
      name: "playtest",
      status: "ok",
    };
  } catch (error) {
    return {
      detail: `threenative-playtest doctor failed: ${playtestFailureDetail(error)}`,
      fix: "Run npx @threenative/playtest doctor --text directly and fix the first reported machine or browser blocker.",
      name: "playtest",
      status: "fail",
    };
  }
}

const APK_SIZE_RECORD = /^docs\/verification\/apk-size-(\d{4}-\d{2}-\d{2})\.md$/u;

interface IApkSizeRecord {
  readonly artifact: string;
  readonly buildDirectory: string;
  readonly bytes: number;
  readonly sha256: string;
}

function parseApkSizeRecord(source: string): IApkSizeRecord | undefined {
  const bytesMatch = source.match(/^\s*-\s*Rebuilt APK bytes:\s*\*\*(\d[\d,]*)\*\*\s*$/mu);
  const artifactMatch = source.match(/^\s*-\s*APK artifact:\s*`([^`]+)`\s*$/mu);
  const buildDirectoryMatch = source.match(/^\s*-\s*Build directory:\s*`([^`]+)`\s*$/mu);
  const sha256Match = source.match(/^\s*-\s*APK SHA-256:\s*`([0-9a-f]{64})`\s*$/imu);
  if (
    bytesMatch === null ||
    artifactMatch === null ||
    buildDirectoryMatch === null ||
    sha256Match === null
  )
    return undefined;
  const bytesText = bytesMatch[1];
  const artifact = artifactMatch[1];
  const buildDirectory = buildDirectoryMatch[1];
  const sha256 = sha256Match[1];
  if (
    bytesText === undefined ||
    artifact === undefined ||
    buildDirectory === undefined ||
    sha256 === undefined
  )
    return undefined;
  const bytes = Number(bytesText.replaceAll(",", ""));
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return undefined;
  if (artifact.length === 0 || buildDirectory.length === 0) return undefined;
  return { artifact, buildDirectory, bytes, sha256: sha256.toLowerCase() };
}

function sha256File(file: string): string {
  const hash = createHash("sha256");
  const descriptor = openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    return hash.digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

function evidencePath(snapshot: IProjectSnapshot, relative: string): string | undefined {
  if (snapshot.projectRoot === undefined || path.isAbsolute(relative)) return undefined;
  const root = path.resolve(snapshot.projectRoot);
  const resolved = path.resolve(root, relative);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : undefined;
}

function evidenceExists(snapshot: IProjectSnapshot, relative: string, directory: boolean): boolean {
  const absolute = evidencePath(snapshot, relative);
  if (absolute !== undefined) {
    try {
      const stats = statSync(absolute);
      return directory ? stats.isDirectory() : stats.isFile();
    } catch {
      return false;
    }
  }
  return snapshot.files.has(relative);
}

function apkSizeCheck(snapshot: IProjectSnapshot): IDoctorCheck | undefined {
  const recordPath = [...snapshot.files]
    .filter((file) => APK_SIZE_RECORD.test(file))
    .sort()
    .at(-1);
  if (recordPath === undefined) return undefined;
  const source = snapshot.readText(recordPath);
  const record = source === undefined ? undefined : parseApkSizeRecord(source);
  if (record === undefined) {
    return {
      detail: `attribution record ${recordPath} is malformed; no APK total was trusted`,
      fix: "Regenerate the record with the APK artifact, SHA-256, build directory, and rebuilt byte total.",
      name: "APK size",
      status: "warn",
    };
  }
  if (!evidenceExists(snapshot, record.buildDirectory, true)) {
    return {
      detail: `missing evidence — attribution record ${recordPath} names build directory ${record.buildDirectory}, which is missing`,
      fix: "Rebuild the recorded Android variant before using its attribution total.",
      name: "APK size",
      status: "warn",
    };
  }
  const artifact = evidencePath(snapshot, record.artifact);
  if (!evidenceExists(snapshot, record.artifact, false) || artifact === undefined) {
    return {
      detail: `missing evidence — attribution record ${recordPath} names APK artifact ${record.artifact}, which is missing`,
      fix: "Rebuild the recorded Android variant before using its attribution total.",
      name: "APK size",
      status: "warn",
    };
  }
  let actualBytes: number;
  let actualSha256: string;
  try {
    actualBytes = statSync(artifact).size;
    actualSha256 = sha256File(artifact);
  } catch {
    return {
      detail: `missing evidence — APK artifact ${record.artifact} could not be read`,
      fix: "Rebuild the recorded Android variant before using its attribution total.",
      name: "APK size",
      status: "warn",
    };
  }
  if (actualBytes !== record.bytes) {
    return {
      detail: `evidence differs — ${record.artifact} is ${actualBytes.toLocaleString("en-US")} bytes, but ${recordPath} records a different total`,
      fix: "Regenerate the attribution record from this APK before trusting its rows.",
      name: "APK size",
      status: "warn",
    };
  }
  if (actualSha256 !== record.sha256) {
    return {
      detail: `evidence differs — ${record.artifact} has SHA-256 ${actualSha256}, but ${recordPath} records ${record.sha256}`,
      fix: "Regenerate the attribution record from this APK before trusting its rows.",
      name: "APK size",
      status: "warn",
    };
  }
  return {
    detail: `last attributed APK: ${record.bytes.toLocaleString("en-US")} bytes (${recordPath})`,
    name: "APK size",
    status: "ok",
  };
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

function javaVersion(
  output: string,
): { readonly major: number; readonly version: string } | undefined {
  const match = output.match(/version\s+["']([^"']+)["']/iu);
  const version = match?.[1];
  if (version === undefined) return undefined;
  const majorMatch = version.startsWith("1.")
    ? version.match(/^1\.(\d+)/u)
    : version.match(/^(\d+)/u);
  const majorText = majorMatch?.[1];
  const major = majorText === undefined ? Number.NaN : Number(majorText);
  return Number.isSafeInteger(major) ? { major, version } : undefined;
}

function androidSdkVersion(root: string): string | undefined {
  const sourceProperties = path.join(
    root,
    "platforms",
    `android-${ANDROID_COMPILE_SDK}`,
    "source.properties",
  );
  try {
    const source = readFileSync(sourceProperties, "utf8");
    const match = source.match(/^Pkg\.Revision\s*=\s*(\S+)/mu);
    return match?.[1];
  } catch {
    return undefined;
  }
}

export function probeAndroidToolchain(
  environment: NodeJS.ProcessEnv = process.env,
): IAndroidToolchainProbe {
  const javaHome = environment.JAVA_HOME?.trim() || undefined;
  const java =
    javaHome === undefined
      ? "java"
      : path.join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java");
  let jdkMajor: number | undefined;
  let jdkVersion: string | undefined;
  try {
    const result = spawnSync(java, ["-version"], {
      encoding: "utf8",
      env: { ...environment },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
    });
    const parsed = javaVersion(`${result.stdout ?? ""}${result.stderr ?? ""}`);
    jdkMajor = parsed?.major;
    jdkVersion = parsed?.version;
  } catch {
    // The doctor reports the missing version below; probing must not turn an absent toolchain into
    // an opaque process exception.
  }

  const sdkCandidates = [
    environment.ANDROID_HOME,
    environment.ANDROID_SDK_ROOT,
    path.join(homedir(), "Android", "Sdk"),
  ]
    .map((candidate) => candidate?.trim())
    .filter((candidate): candidate is string => candidate !== undefined && candidate.length > 0);
  const sdkRoot = sdkCandidates.find((candidate) => existsSync(candidate));
  return {
    ...(jdkMajor === undefined ? {} : { jdkMajor }),
    ...(jdkVersion === undefined ? {} : { jdkVersion }),
    ...(sdkRoot === undefined ? {} : { sdkVersion: androidSdkVersion(sdkRoot) }),
  };
}

function runtimeFileAvailable(snapshot: IProjectSnapshot, relative: string): boolean {
  if (snapshot.runtimeRoot === undefined) return false;
  return (
    snapshot.runtimeFileExists?.(relative) ?? existsSync(path.join(snapshot.runtimeRoot, relative))
  );
}

function androidTargetCheck(snapshot: IProjectSnapshot): IDoctorCheck {
  if (!runtimeFileAvailable(snapshot, "scripts/package-android.mjs")) {
    return {
      detail: "unavailable — @threenative/runtime-native has no Android packager",
      name: "target android",
      status: snapshot.runtimeRoot === undefined ? "warn" : "fail",
    };
  }
  const androidToolchain =
    snapshot.androidToolchain ??
    (snapshot.projectRoot === undefined ? undefined : probeAndroidToolchain());
  const toolchain =
    androidToolchain === undefined ? undefined : androidToolchainStatus(androidToolchain);
  return {
    detail:
      toolchain === undefined
        ? "available — runtime packager installed; Android toolchain was not probed in this in-memory snapshot"
        : `available — runtime packager installed; ${toolchain.detail}`,
    ...(toolchain?.fix === undefined ? {} : { fix: toolchain.fix }),
    name: "target android",
    status: toolchain?.status ?? "ok",
  };
}

function iosTargetCheck(snapshot: IProjectSnapshot): IDoctorCheck {
  const iosPackager = runtimeFileAvailable(snapshot, "scripts/package-ios.mjs");
  const iosHost = process.platform === "darwin" && process.arch === "arm64";
  if (iosHost && iosPackager) {
    return {
      detail: "available — darwin-arm64 simulator packager installed",
      name: "target ios",
      status: "ok",
    };
  }
  return {
    detail: iosHost
      ? "unavailable — @threenative/runtime-native has no iOS packager"
      : `unavailable — iOS simulator packaging requires darwin-arm64; received ${process.platform}-${process.arch}`,
    name: "target ios",
    status: iosHost ? "fail" : "warn",
  };
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
    androidTargetCheck(snapshot),
    iosTargetCheck(snapshot),
  ];
}

function desktopOverlayCheck(probe: IDesktopOverlayProbe): IDoctorCheck {
  return {
    detail: probe.detail,
    fix: probe.fix,
    name: "desktop overlay",
    status: probe.status,
  };
}

/**
 * Blender, for the four model formats the asset pipeline converts.
 *
 * **`warn`, never `fail`.** A game with no `.fbx`, `.blend`, `.obj` or `.dae` in it needs no
 * Blender and must stay green — a doctor that failed on a 350 MB dependency the project does not
 * use would be a doctor people stop running. A game that *does* carry one of those sources gets a
 * hard failure where it belongs: in the build, from `blenderImportPass`, naming the same command.
 */
function blenderCheck(snapshot: IProjectSnapshot): IDoctorCheck | undefined {
  const probe = snapshot.blender;
  if (probe === undefined) return undefined;
  const sources = [...snapshot.files].filter((file) =>
    BLENDER_SOURCE_SUFFIXES.some((suffix) => file.toLowerCase().endsWith(suffix)),
  );
  if (probe.available) {
    return {
      detail:
        probe.version === undefined
          ? probe.detail
          : `Blender ${probe.version} converts .fbx, .blend, .obj and .dae on this machine`,
      name: "blender",
      status: "ok",
    };
  }
  const carried =
    sources.length === 0
      ? "no .fbx, .blend, .obj or .dae in this project, so nothing needs it yet"
      : `${sources.length} source(s) in this project need it: ${sources.slice(0, 3).join(", ")}`;
  return {
    detail: `${probe.detail} — ${carried}`,
    fix: `Install Blender when you want to convert those formats: ${probe.installCommand}`,
    name: "blender",
    status: "warn",
  };
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
  const blender = blenderCheck(snapshot);
  const nativeRuntime = nativeRuntimeCheck(snapshot);
  const apkSize = apkSizeCheck(snapshot);
  const playtest = playtestCheck(snapshot);
  const checks: IDoctorCheck[] = [
    { detail: "readable", name: "package.json", status: "ok" },
    ...dependencyChecks(snapshot),
    nativeEntryCheck(snapshot),
    nativeRuntime,
    assetPipelineCheck(snapshot),
    ...(apkSize === undefined ? [] : [apkSize]),
    ...(!usesDesktopOverlay(snapshot.config) || snapshot.desktopOverlay === undefined
      ? []
      : [desktopOverlayCheck(snapshot.desktopOverlay)]),
    ...targetChecks(snapshot, nativeRuntime),
    snapshot.files.has("src/main.ts")
      ? { detail: "src/main.ts is the web entry", name: "web entry", status: "ok" }
      : {
          detail: "no src/main.ts, so 'threenative build' has no web entry to bundle",
          fix: "Add src/main.ts, which mounts the game and any browser-only UI.",
          name: "web entry",
          status: "warn",
        },
    playtest,
    hasPlaytests
      ? { detail: "at least one scenario can prove this game", name: "playtests", status: "ok" }
      : {
          detail: "no *.playtest.json scenario, so nothing here proves the game runs",
          fix: "Create one: 'npx @threenative/playtest init'.",
          name: "playtests",
          status: "warn",
        },
    ...capabilitySearchChecks(snapshot),
    ...(blender === undefined ? [] : [blender]),
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
  const projectRoot = path.resolve(root);
  const packageJson = await readJson(path.join(projectRoot, "package.json"));
  const typeScriptConfig = path.join(projectRoot, "threenative.config.ts");
  const config = existsSync(typeScriptConfig)
    ? await readTypeScriptConfig(projectRoot)
    : nativeEntryCompat(record(packageJson)?.threenative);
  const files = new Set(await collectFiles(projectRoot));
  const installedVersions = new Map<string, string>();
  for (const name of declaredDependencies(packageJson)) {
    const manifest = await readJson(path.join(projectRoot, "node_modules", name, "package.json"));
    const version = record(manifest)?.version;
    if (typeof version === "string") installedVersions.set(name, version);
  }
  const runtimeRoot = installedVersions.has(RUNTIME_PACKAGE)
    ? (() => {
        const candidate = path.join(projectRoot, "node_modules", RUNTIME_PACKAGE);
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
  const playtestRunnerPath = resolveBinaryFrom(projectRoot, PLAYTEST_BINARY);
  const mcpServerHealth = new Map<string, IMcpServerHealth>();
  if (files.has(".mcp.json")) {
    for (const spec of MCP_SERVER_SPECS) {
      if (existsSync(path.resolve(projectRoot, spec.expectedArgs))) {
        mcpServerHealth.set(spec.configName, probeMcpServer(projectRoot, spec));
      }
    }
  }
  return {
    config,
    files,
    installedVersions,
    mcpServerHealth,
    packageJson,
    projectRoot,
    readText: (relative) => {
      const file = path.join(projectRoot, relative);
      try {
        return existsSync(file) ? readFileSync(file, "utf8") : undefined;
      } catch {
        return undefined;
      }
    },
    androidToolchain: probeAndroidToolchain(),
    blender: (() => {
      const status = resolveBlender();
      return {
        available: status.available,
        detail: status.detail,
        installCommand: installCommandFor(),
        ...(status.version === undefined ? {} : { version: status.version }),
      };
    })(),
    ...(usesDesktopOverlay(config) ? { desktopOverlay: probeDesktopOverlay() } : {}),
    ...(playtestRunnerPath === undefined
      ? {}
      : {
          playtestRunnerPath,
          runPlaytestDoctor: () => executePlaytestDoctor(playtestRunnerPath, projectRoot),
        }),
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

async function readTypeScriptConfig(root: string): Promise<unknown> {
  try {
    return await loadConfig(root);
  } catch {
    // Doctor still reports the independent package, entry, and runtime checks when config
    // validation is already failing; the build path owns the detailed config error.
    return undefined;
  }
}

export function formatDoctorReport(report: IDoctorReport): string {
  const symbols: Record<DoctorStatus, string> = { fail: "✗", ok: "✓", warn: "!" };
  const isBaseline = (name: string): boolean =>
    ["package.json", "dependencies", "versions"].includes(name);
  const isCraft = (name: string): boolean => name.startsWith("capability search");
  const isTest = (name: string): boolean => name === "playtest" || name === "playtests";
  const groups: readonly [string, (name: string) => boolean][] = [
    ["Baseline", isBaseline],
    ["Craft", isCraft],
    ["Test", isTest],
    ["Ship", (name) => !isBaseline(name) && !isCraft(name) && !isTest(name)],
  ];
  const lines: string[] = [];
  for (const [group, belongs] of groups) {
    const checks = report.checks.filter(({ name }) => belongs(name));
    if (checks.length === 0) continue;
    lines.push(`${group}:`);
    lines.push(
      ...checks.map(
        ({ detail, fix, name, status }) =>
          `${symbols[status]} ${name}: ${detail}${fix === undefined || status === "ok" ? "" : `\n    fix: ${fix}`}`,
      ),
    );
  }
  if (!report.pass) lines.push("\nAt least one check failed; fix it before trusting a build here.");
  return `${lines.join("\n")}\n`;
}
