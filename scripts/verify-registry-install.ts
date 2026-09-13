#!/usr/bin/env tsx
/**
 * The clean-room gate: install ThreeNative the way a stranger does, from the public registry.
 *
 * No other gate in this repository exercises that path. `scripts/verify-golden-path.ts` resolves
 * `file:` tarballs *by design* — that is what makes it a packed-artifact gate — and the sandbox,
 * the sweeps and every consumer proof to date do the same. So the repository's own harness has
 * never once noticed that `create-threenative` 404s for every person on earth.
 *
 * The assertion that separates this from the packed gate is the **lockfile**: zero `file:` and
 * zero `link:` specifiers. A run that silently resolved back to this workspace would otherwise
 * look identical to a run that worked, which is the manufactured-evidence failure this repository
 * fails builds over.
 *
 * Fail closed: a step that does not run is a failure, not a skip. There is no flag that turns one
 * into a pass.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MCP_SERVERS } from "../packages/core/mcp/servers.mjs";

/** `link:` is pnpm's workspace link; `file:` is a local tarball or directory. Neither ships. */
const LOCAL_SPECIFIER = /(?:^|["'\s:])(?:file|link):/mu;

export const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"] as const;

export const REGISTRY_PACKAGE_MANAGERS = ["npm", "pnpm"] as const;
export type RegistryPackageManager = (typeof REGISTRY_PACKAGE_MANAGERS)[number];

export interface IMcpRequest {
  readonly id?: number;
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface IRegistryInstallStep {
  readonly detail: string;
  readonly name: string;
  readonly ok: boolean;
}

export interface IRegistryInstallReport {
  readonly exitCode: 0 | 1;
  readonly managers: readonly RegistryPackageManager[];
  readonly steps: readonly IRegistryInstallStep[];
}

/**
 * A lockfile naming a local path means the install fell back to this machine. It is the one
 * observation that distinguishes "installed from the registry" from "looked like it did".
 */
export function assertNoLocalSpecifiers(lockfile: string, contents: string): void {
  const offenders = contents
    .split(/\r?\n/u)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter((entry) => LOCAL_SPECIFIER.test(entry.line));
  if (offenders.length > 0)
    throw new Error(
      `TN_REGISTRY_INSTALL_LOCAL_SPECIFIER: ${lockfile} resolves ${offenders.length} dependency(s) from this machine rather than the registry. First: line ${offenders[0]?.number}: ${offenders[0]?.line}`,
    );
}

/**
 * Refuses to report on a project with no lockfile. An install that produced none did not run, and
 * "no lockfile, no offenders, therefore pass" is exactly the vacuous green this gate exists to
 * prevent.
 */
export function checkLockfile(project: string): string {
  const found = LOCKFILES.map((name) => path.join(project, name)).filter((file) =>
    fs.existsSync(file),
  );
  if (found.length === 0)
    throw new Error(
      `TN_REGISTRY_INSTALL_NO_LOCKFILE: ${project} has none of ${LOCKFILES.join(", ")}, so the install cannot be shown to have come from the registry.`,
    );
  for (const file of found)
    assertNoLocalSpecifiers(path.basename(file), fs.readFileSync(file, "utf8"));
  return found.map((file) => path.basename(file)).join(", ");
}

export type CommandRunner = (command: string, args: readonly string[], cwd: string) => string;

export type McpRunner = (
  serverName: string,
  command: string,
  args: readonly string[],
  cwd: string,
  env?: Readonly<Record<string, string>>,
  requests?: string,
) => string;

/**
 * The invoking package manager's configuration, removed.
 *
 * This runs under pnpm, and pnpm exports its own settings as `npm_config_*` — `catalog`,
 * `patched-dependencies`, `verify-deps-before-run`, `_jsr-registry`. npm reads those as its own
 * config, warns "Unknown env config" about each, and then died on
 * `Cannot read properties of null (reading 'matches')`, which reported the published packages as
 * uninstallable when a plain `npm install` of the same project succeeds. A clean room that
 * inherits the caller's package-manager config is not a clean room.
 *
 * Everything else in the environment is kept: PATH, HOME and the rest are what make the run
 * possible at all.
 */
export function cleanRoomEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(base)) {
    if (/^npm_config_/iu.test(name)) continue;
    // `npm_package_*` and `npm_lifecycle_*` describe the script that launched this process, and
    // npm re-derives them for whatever it runs next.
    if (/^npm_(package|lifecycle|command)_?/iu.test(name)) continue;
    cleaned[name] = value;
  }
  return cleaned;
}

/** Build one package-manager environment without inheriting a caller's cache or pnpm store. */
export function registryEnvironment(
  base: NodeJS.ProcessEnv,
  manager: RegistryPackageManager,
  cache: string,
  store: string,
): NodeJS.ProcessEnv {
  return {
    ...cleanRoomEnvironment(base),
    NPM_CONFIG_CACHE: cache,
    npm_config_cache: cache,
    ...(manager === "pnpm" ? { npm_config_store_dir: store } : {}),
  };
}

/** Supported Node is a package contract, not a warning discovered halfway through installation. */
export function assertSupportedNodeVersion(version = process.versions.node): void {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
  const major = Number.parseInt(match?.[1] ?? "-1", 10);
  const minor = Number.parseInt(match?.[2] ?? "-1", 10);
  const patch = Number.parseInt(match?.[3] ?? "-1", 10);
  if (major < 20 || (major === 20 && (minor < 19 || (minor === 19 && patch < 0))))
    throw new Error(
      `TN_REGISTRY_INSTALL_NODE_UNSUPPORTED: Node ${version} is below the supported minimum 20.19.0. Install Node 20.19.0 or newer before qualifying a registry install.`,
    );
}

export function assertSupportedPackageManager(
  manager: string,
): asserts manager is RegistryPackageManager {
  if (!REGISTRY_PACKAGE_MANAGERS.includes(manager as RegistryPackageManager))
    throw new Error(
      `TN_REGISTRY_INSTALL_PACKAGE_MANAGER_UNSUPPORTED: '${manager}' is not supported; use npm or pnpm.`,
    );
}

export function realRunner(env: NodeJS.ProcessEnv): CommandRunner {
  return (command, args, cwd) =>
    execFileSync(command, [...args], {
      cwd,
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 900_000,
    });
}

interface IMcpFixturePaths {
  readonly source?: string;
  readonly out?: string;
}

const MCP_SAFE_TOOLS: Readonly<Record<string, string>> = {
  "threenative-assets": "asset_search_sources",
  "threenative-blender": "blender_status",
  "threenative-engine": "engine_search_capabilities",
  "threenative-sculpt": "sculpt_grimoire",
};

function safeOperation(
  serverName: string,
  fixture: IMcpFixturePaths,
): Readonly<Record<string, unknown>> {
  const name = MCP_SAFE_TOOLS[serverName];
  if (name === undefined)
    throw new Error(
      `TN_REGISTRY_INSTALL_MCP_OPERATION_UNDECLARED: server '${serverName}' is in the packed table but has no safe verification operation.`,
    );
  const argumentsValue: Record<string, unknown> =
    name === "asset_search_sources"
      ? { category: "all", query: "game" }
      : name === "sculpt_grimoire"
        ? { topic: "build/geometry_patterns" }
        : name === "engine_search_capabilities"
          ? { scope: "mechanic", situation: "enemy walks around a wall" }
          : {};
  return { arguments: argumentsValue, name };
}

export function mcpRequests(
  serverName: string,
  fixture: IMcpFixturePaths = {},
  operation: Readonly<Record<string, unknown>> = safeOperation(serverName, fixture),
): string {
  const requests: IMcpRequest[] = [
    {
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: { name: "threenative-registry-install", version: "1.0.0" },
        protocolVersion: "2025-06-18",
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { id: 2, jsonrpc: "2.0", method: "tools/list", params: {} },
    { id: 3, jsonrpc: "2.0", method: "tools/call", params: operation },
  ];
  if (serverName === "threenative-blender" && operation.name === "blender_convert") {
    const argumentsValue = operation.arguments as Record<string, unknown>;
    argumentsValue.source = fixture.source;
    argumentsValue.out = fixture.out;
  }
  return `${requests.map((request) => JSON.stringify(request)).join("\n")}\n`;
}

function jsonLines(output: string, serverName: string): readonly Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  for (const line of output.split(/\r?\n/u).filter((candidate) => candidate.trim().length > 0)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(
        `MCP server '${serverName}' emitted non-JSON stdout during initialize: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error(`MCP server '${serverName}' emitted a non-object JSON response.`);
    messages.push(parsed as Record<string, unknown>);
  }
  return messages;
}

function requireMcpResponse(
  messages: readonly Record<string, unknown>[],
  serverName: string,
  id: number,
): Record<string, unknown> {
  const response = messages.find((message) => message.id === id);
  if (response === undefined)
    throw new Error(`MCP server '${serverName}' never answered request ${id}.`);
  if (response.error !== undefined)
    throw new Error(
      `MCP server '${serverName}' request ${id} failed: ${JSON.stringify(response.error)}.`,
    );
  if (typeof response.result !== "object" || response.result === null)
    throw new Error(`MCP server '${serverName}' returned no result for request ${id}.`);
  return response;
}

interface ICapabilitySearchHit {
  readonly constraints: readonly string[];
  readonly example: string;
  readonly importPath: string;
  readonly summary: string;
  readonly symbol: string;
}

interface IMcpSession {
  readonly messages: readonly Record<string, unknown>[];
  readonly operation: Record<string, unknown>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCapabilitySearchHit(value: unknown): value is ICapabilitySearchHit {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const hit = value as Record<string, unknown>;
  return (
    isNonEmptyString(hit.symbol) &&
    isNonEmptyString(hit.importPath) &&
    isNonEmptyString(hit.summary) &&
    isNonEmptyString(hit.example) &&
    Array.isArray(hit.constraints) &&
    hit.constraints.every((constraint) => typeof constraint === "string")
  );
}

function toolText(response: Record<string, unknown>, serverName: string): string {
  const result = response.result as { content?: unknown; isError?: unknown };
  if (result.isError === true)
    throw new Error(`MCP server '${serverName}' returned an error from its safe operation.`);
  if (!Array.isArray(result.content))
    throw new Error(`MCP server '${serverName}' returned no tools/call content.`);
  const text = result.content.find(
    (entry): entry is { text: string } =>
      typeof entry === "object" &&
      entry !== null &&
      "text" in entry &&
      typeof entry.text === "string",
  )?.text;
  if (text === undefined)
    throw new Error(`MCP server '${serverName}' returned no text tool result.`);
  return text;
}

function parseToolPayload(response: Record<string, unknown>, serverName: string): unknown {
  const text = toolText(response, serverName);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `MCP server '${serverName}' returned malformed tool JSON: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
}

function assertMcpHandshake(serverName: string, output: string, expectedTool: string): IMcpSession {
  const messages = jsonLines(output, serverName);
  requireMcpResponse(messages, serverName, 1);
  const toolsResponse = requireMcpResponse(messages, serverName, 2);
  const tools = (toolsResponse.result as { tools?: unknown }).tools;
  if (!Array.isArray(tools))
    throw new Error(`MCP server '${serverName}' returned no tools/list array.`);
  const names = tools.flatMap((tool) =>
    typeof tool === "object" && tool !== null && "name" in tool && typeof tool.name === "string"
      ? [tool.name]
      : [],
  );
  if (!names.includes(expectedTool))
    throw new Error(`MCP server '${serverName}' tools/list does not advertise '${expectedTool}'.`);
  const operation = requireMcpResponse(messages, serverName, 3);
  return { messages, operation };
}

export function realMcpRunner(
  serverName: string,
  command: string,
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>> = {},
  requests?: string,
): string {
  return execFileSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    input: requests ?? mcpRequests(serverName),
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 30_000,
  });
}

/**
 * PRD-366 phase 1. A consumer proof is only real if the installed game is edited and then *played*,
 * with observable state transitions. These three helpers are the parts of that claim a clean-room
 * job can check mechanically; the playtest run itself is the fourth.
 */
export const GAMEPLAY_SCENARIO = "playtests/production-readiness.playtest.json";

/** A marker appended to the game's portable entry, so a game-only edit is provably the consumer's. */
export const GAME_ONLY_EDIT_MARKER = "TN_REGISTRY_GAME_ONLY_EDIT";

/**
 * Append the marker to the scaffolded game's portable entry.
 *
 * Idempotent, and deliberately game-owned: `src/game.ts` is the consumer's file, not package code,
 * so a build that carries the marker proves the installed consumer's own edit reached its artifact.
 */
export function applyGameOnlyEdit(project: string): string {
  const entry = path.join(project, "src", "game.ts");
  if (!fs.existsSync(entry))
    throw new Error(
      `TN_REGISTRY_INSTALL_GAMEPLAY_ENTRY_MISSING: ${entry} does not exist, so a game-only edit cannot be made.`,
    );
  const source = fs.readFileSync(entry, "utf8");
  if (!source.includes(GAME_ONLY_EDIT_MARKER))
    // A side-effecting assignment, not a comment: Vite's minifier strips non-legal comments from the
    // built bundle, so a `// marker` would never be observable in `dist/` and this gate would fail
    // for the wrong reason.
    fs.writeFileSync(
      entry,
      `${source}\n(globalThis as Record<string, unknown>).__tnRegistryGameOnlyEdit = "${GAME_ONLY_EDIT_MARKER}";\n`,
    );
  return entry;
}

/**
 * Require the production-readiness scenario to exist with at least one non-empty assertion family.
 *
 * A scenario that asserts nothing, or a project that shipped without it, is the vacuous green this
 * phase exists to prevent — an installed runner that exits 0 having proven nothing.
 */
export function assertGameplayScenario(project: string): string {
  const file = path.join(project, GAMEPLAY_SCENARIO);
  if (!fs.existsSync(file))
    throw new Error(
      `TN_REGISTRY_INSTALL_GAMEPLAY_SCENARIO_MISSING: ${file} is absent, so the installed starter cannot be proven playable.`,
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `TN_REGISTRY_INSTALL_GAMEPLAY_SCENARIO_INVALID: ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const assertion = objectRecord((parsed as { assert?: unknown } | undefined)?.assert);
  const families = (assertion === undefined ? [] : Object.keys(assertion)).filter((key) => {
    const value = assertion?.[key];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object" && value !== null) return Object.keys(value).length > 0;
    return value === true;
  });
  if (families.length === 0)
    throw new Error(
      `TN_REGISTRY_INSTALL_GAMEPLAY_NO_ASSERTIONS: ${file} declares no non-empty assertion family, so a passing run would prove nothing.`,
    );
  return families.join(", ");
}

/** Require the applied game-only edit to appear in the built output, not only in the source. */
export function assertEditedGameplayInBuild(
  project: string,
  marker = GAME_ONLY_EDIT_MARKER,
): string {
  const dist = path.join(project, "dist");
  const found = treeContains(dist, marker);
  if (found === undefined)
    throw new Error(
      `TN_REGISTRY_INSTALL_GAMEPLAY_EDIT_NOT_BUILT: the game-only edit '${marker}' is absent from ${dist}, so the consumer's edit did not reach the build.`,
    );
  return found;
}

function treeContains(root: string, needle: string): string | undefined {
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(file);
      else if (entry.isFile()) {
        try {
          if (fs.readFileSync(file, "utf8").includes(needle)) return file;
        } catch {
          // A binary asset is not the portable entry; keep looking.
        }
      }
    }
  }
  return undefined;
}

export interface IVerifyRegistryInstallOptions {
  /** Where the clean room is created. Must have no workspace above it. */
  readonly parent?: string;
  readonly mcp?: McpRunner;
  readonly packageManagers?: readonly RegistryPackageManager[];
  readonly run?: CommandRunner;
  readonly template?: string;
}

function step(name: string, work: () => string): IRegistryInstallStep {
  try {
    return { detail: work().trim().slice(-400) || "(no output)", name, ok: true };
  } catch (error) {
    return { detail: error instanceof Error ? error.message : String(error), name, ok: false };
  }
}

function nativeOutput(project: string): string {
  const manifest = JSON.parse(fs.readFileSync(path.join(project, "package.json"), "utf8")) as {
    name?: unknown;
  };
  if (typeof manifest.name !== "string" || manifest.name.length === 0)
    throw new Error("Native build produced no project name to resolve its executable.");
  const name = manifest.name.replace(/^@[^/]+\//u, "").replace(/[^a-zA-Z0-9._-]/gu, "-");
  const executable = path.join(
    project,
    "dist-native",
    `${name}${process.platform === "win32" ? ".exe" : ""}`,
  );
  if (!fs.existsSync(executable))
    throw new Error(`Native build produced no executable at ${executable}.`);
  const mode = fs.statSync(executable).mode;
  if (process.platform !== "win32" && (mode & 0o111) === 0)
    throw new Error(`Native build output is not executable: ${executable}.`);
  return executable;
}

function assertDoctorTargetCensus(output: string): string {
  for (const target of ["web", "desktop", "android", "ios"] as const) {
    const line = new RegExp(`^[✓!✗] target ${target}: (?:available|unavailable)`, "imu");
    if (!line.test(output))
      throw new Error(`Doctor text did not report target ${target} as available or unavailable.`);
  }
  return output;
}

function verifyNativeFrames(project: string, runner: CommandRunner): string {
  const verifier = path.join(
    project,
    "node_modules",
    "@threenative",
    "runtime-native",
    "scripts",
    "verify-starter-desktop.mjs",
  );
  const output = runner("node", [verifier], project);
  const reportPath = path.join(project, "artifacts", "native", "starter-desktop-report.json");
  if (!fs.existsSync(reportPath))
    throw new Error(`Native verifier produced no 300 frames report at ${reportPath}.`);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
    frames?: unknown;
    pass?: unknown;
  };
  if (report.pass !== true || report.frames !== 300)
    throw new Error(
      `Native verifier did not prove 300 frames: pass=${String(report.pass)}, frames=${String(report.frames)}.`,
    );
  return `${output}\nVerified ${report.frames} rendered frames.`;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function mcpStep(project: string, runner: McpRunner): string {
  const configPath = path.join(project, ".mcp.json");
  if (!fs.existsSync(configPath)) throw new Error(`MCP configuration is missing: ${configPath}.`);
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    mcpServers?: Record<string, { args?: unknown; command?: unknown; env?: unknown }>;
  };
  const servers = parsed.mcpServers;
  if (servers === undefined || Object.keys(servers).length === 0)
    throw new Error("MCP configuration declares no servers.");
  const expected = Object.keys(MCP_SERVERS);
  for (const name of expected) {
    if (servers[name] === undefined)
      throw new Error(`MCP configuration is missing required server '${name}'.`);
  }
  const results: string[] = [];
  for (const name of expected) {
    const server = servers[name];
    if (server === undefined) continue;
    if (typeof server.command !== "string" || !Array.isArray(server.args))
      throw new Error(`MCP server '${name}' has no executable command and argument list.`);
    if (!server.args.every((arg) => typeof arg === "string"))
      throw new Error(`MCP server '${name}' has a non-string argument.`);
    const env =
      typeof server.env === "object" && server.env !== null && !Array.isArray(server.env)
        ? Object.fromEntries(
            Object.entries(server.env as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : {};
    try {
      const fixture: IMcpFixturePaths =
        name === "threenative-blender"
          ? {
              out: path.join(project, ".registry-mcp", "triangle.glb"),
              source: path.join(project, ".registry-mcp", "triangle.obj"),
            }
          : {};
      if (fixture.source !== undefined && fixture.out !== undefined) {
        fs.mkdirSync(path.dirname(fixture.source), { recursive: true });
        fs.writeFileSync(
          fixture.source,
          "o registry-triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
        );
      }
      const first = assertMcpHandshake(
        name,
        runner(
          name,
          server.command,
          server.args as string[],
          project,
          env,
          mcpRequests(name, fixture),
        ),
        MCP_SAFE_TOOLS[name] as string,
      );
      const payload = parseToolPayload(first.operation, name);
      const record = objectRecord(payload);
      if (name === "threenative-assets") {
        if (
          record === undefined ||
          !Array.isArray(record.sources) ||
          typeof record.total !== "number"
        )
          throw new Error(
            "asset_search_sources returned no source directory payload with sources and total.",
          );
        results.push(`${name}: initialize, tools/list and asset_search_sources ok`);
      } else if (name === "threenative-sculpt") {
        if (
          record === undefined ||
          !isNonEmptyString(record.topic) ||
          !isNonEmptyString(record.text)
        )
          throw new Error("sculpt_grimoire returned no technique-safe topic and text.");
        results.push(`${name}: initialize, tools/list and sculpt_grimoire ok`);
      } else if (name === "threenative-engine") {
        if (!Array.isArray(payload) || payload.length === 0)
          throw new Error(
            "engine_search_capabilities returned no capability hits for the plain-words query.",
          );
        const malformedIndex = payload.findIndex((hit) => !isCapabilitySearchHit(hit));
        if (malformedIndex !== -1)
          throw new Error(
            `engine_search_capabilities returned malformed capability hit at index ${malformedIndex}.`,
          );
        const hit = payload[0] as ICapabilitySearchHit;
        const detailOperation = {
          arguments: { symbol: hit.symbol },
          name: "engine_capability_detail",
        };
        const detail = assertMcpHandshake(
          name,
          runner(
            name,
            server.command,
            server.args as string[],
            project,
            env,
            mcpRequests(name, {}, detailOperation),
          ),
          "engine_capability_detail",
        );
        const detailPayload = objectRecord(parseToolPayload(detail.operation, name));
        if (
          detailPayload === undefined ||
          !isNonEmptyString(detailPayload.symbol) ||
          detailPayload.symbol !== hit.symbol
        )
          throw new Error(
            `engine_capability_detail did not return the searched capability '${hit.symbol}'.`,
          );
        results.push(
          `${name}: initialize, tools/list, search and detail ok (${hit.symbol}; ${payload.length} hit(s))`,
        );
      } else if (name === "threenative-blender") {
        if (record === undefined || record.available !== true) {
          const detail = isNonEmptyString(record?.detail)
            ? record.detail
            : "Blender is unavailable";
          const install = isNonEmptyString(record?.installCommand)
            ? ` Install it with: ${record.installCommand}`
            : "";
          throw new Error(`TN_REGISTRY_INSTALL_BLENDER_UNAVAILABLE: ${detail}.${install}`);
        }
        const conversion = assertMcpHandshake(
          name,
          runner(
            name,
            server.command,
            server.args as string[],
            project,
            env,
            mcpRequests(name, fixture, {
              arguments: { out: fixture.out, source: fixture.source },
              name: "blender_convert",
            }),
          ),
          "blender_convert",
        );
        const conversionPayload = objectRecord(parseToolPayload(conversion.operation, name));
        if (
          conversionPayload?.ok !== true ||
          fixture.out === undefined ||
          !fs.existsSync(fixture.out)
        )
          throw new Error("blender_convert did not produce a GLB from the owned OBJ fixture.");
        results.push(`${name}: initialize, tools/list, status and conversion ok`);
      }
    } catch (error) {
      throw new Error(
        `MCP server '${name}' verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  for (const [name, server] of Object.entries(servers)) {
    if (expected.includes(name)) continue;
    if (typeof server.command !== "string" || !Array.isArray(server.args))
      throw new Error(`MCP server '${name}' has no executable command and argument list.`);
    results.push(`${name}: preserved user server (not part of the ThreeNative table)`);
  }
  return results.join("; ");
}

export function verifyRegistryInstall(
  options: IVerifyRegistryInstallOptions = {},
): IRegistryInstallReport {
  const template = options.template ?? "starter";
  const managers = [...new Set(options.packageManagers ?? REGISTRY_PACKAGE_MANAGERS)];
  if (managers.length === 0)
    throw new Error(
      "TN_REGISTRY_INSTALL_NO_PACKAGE_MANAGERS: the clean-room matrix is empty; run npm and pnpm.",
    );
  for (const manager of managers) assertSupportedPackageManager(manager);
  assertSupportedNodeVersion();
  // A private cache and a private store per case, so a package cached from an earlier workspace
  // install cannot stand in for one the registry would have refused to serve.
  const parent = fs.mkdtempSync(
    path.join(options.parent ?? os.tmpdir(), "threenative-clean-room-"),
  );
  const mcp = options.mcp ?? realMcpRunner;
  const steps: IRegistryInstallStep[] = [];
  try {
    for (const manager of managers) {
      const caseRoot = path.join(parent, manager);
      const cache = path.join(caseRoot, "npm-cache");
      const store = path.join(caseRoot, "pnpm-store");
      const project = path.join(caseRoot, "my-game");
      fs.mkdirSync(caseRoot, { recursive: true });
      fs.mkdirSync(cache, { recursive: true });
      fs.mkdirSync(store, { recursive: true });
      const run =
        options.run ?? realRunner(registryEnvironment(process.env, manager, cache, store));
      const command = manager === "npm" ? "npm" : "pnpm";
      const scaffoldArgs =
        manager === "npm"
          ? [
              "create",
              "threenative@latest",
              "my-game",
              "--",
              "--template",
              template,
              "--no-install",
            ]
          : ["create", "threenative@latest", "my-game", "--template", template, "--no-install"];
      const installArgs =
        manager === "npm" ? ["install", "--cache", cache] : ["install", "--store-dir", store];
      const script = (name: string): readonly string[] =>
        manager === "npm" ? ["run", name] : ["run", name];
      const testCommand = manager === "npm" ? ["run", "test"] : ["test"];
      const doctorCommand =
        manager === "npm"
          ? ["npx", "--no-install", "threenative", "doctor", "--text"]
          : ["pnpm", "exec", "threenative", "doctor", "--text"];

      const prefix = (name: string): string => `${manager}:${name}`;
      const notRun = (name: string, reason: string): void => {
        steps.push({ detail: `Not run: ${reason}`, name: prefix(name), ok: false });
      };

      const scaffold = step(prefix("scaffold"), () => run(command, scaffoldArgs, caseRoot));
      steps.push(scaffold);
      if (!scaffold.ok) {
        for (const name of [
          "install",
          "lockfile",
          "edit",
          "build",
          "test",
          "gameplay",
          "doctor",
          "native",
          "mcp",
        ])
          notRun(name, "the scaffold step never produced a project.");
        continue;
      }
      const installed = step(prefix("install"), () => run(command, installArgs, project));
      steps.push(installed);
      if (!installed.ok) {
        for (const name of [
          "lockfile",
          "edit",
          "build",
          "test",
          "gameplay",
          "doctor",
          "native",
          "mcp",
        ])
          notRun(
            name,
            "the install step failed to produce an installed project; no script-policy bypass was used.",
          );
        continue;
      }
      steps.push(
        step(prefix("lockfile"), () => `Checked ${checkLockfile(project)}; no file: or link:.`),
      );
      steps.push(
        step(prefix("edit"), () => `Applied the game-only edit to ${applyGameOnlyEdit(project)}.`),
      );
      steps.push(step(prefix("build"), () => run(command, script("build"), project)));
      steps.push(step(prefix("test"), () => run(command, testCommand, project)));
      steps.push(
        step(prefix("gameplay"), () => {
          const families = assertGameplayScenario(project);
          const built = assertEditedGameplayInBuild(project);
          // The runner defaults to an already-running `http://127.0.0.1:5173`; nothing here starts
          // one, so the scenario must bring its own dev server the way the template's own test
          // script does. `--browser-recipe webgpu` is required so a SwiftShader run is not mistaken
          // for evidence.
          const serverCommand =
            manager === "npm"
              ? "npm run dev -- --host 127.0.0.1 --port $PORT --strictPort"
              : "pnpm dev --host 127.0.0.1 --port $PORT --strictPort";
          const playtestArgs =
            manager === "npm"
              ? [
                  "exec",
                  "--no-install",
                  "threenative-playtest",
                  GAMEPLAY_SCENARIO,
                  "--browser-recipe",
                  "webgpu",
                  "--server-command",
                  serverCommand,
                ]
              : [
                  "exec",
                  "threenative-playtest",
                  GAMEPLAY_SCENARIO,
                  "--browser-recipe",
                  "webgpu",
                  "--server-command",
                  serverCommand,
                ];
          const output = run(command, playtestArgs, project);
          return `Ran ${GAMEPLAY_SCENARIO} (assertions: ${families}); edit present in ${built}. ${output}`;
        }),
      );
      steps.push(
        step(prefix("doctor"), () =>
          assertDoctorTargetCensus(
            run(doctorCommand[0] as string, doctorCommand.slice(1), project),
          ),
        ),
      );
      steps.push(
        step(prefix("native"), () => {
          const output = run(command, script("build:desktop"), project);
          const executable = nativeOutput(project);
          const proof = verifyNativeFrames(project, run);
          return `${output}\nExecutable: ${executable}\n${proof}`;
        }),
      );
      steps.push(step(prefix("mcp"), () => mcpStep(project, mcp)));
    }
  } finally {
    fs.rmSync(parent, { force: true, recursive: true });
  }
  return { exitCode: steps.every((item) => item.ok) ? 0 : 1, managers, steps };
}

function main(): void {
  const report = verifyRegistryInstall();
  for (const item of report.steps)
    process.stdout.write(`${item.ok ? "pass" : "FAIL"}  ${item.name}\n      ${item.detail}\n`);
  process.stdout.write(
    report.exitCode === 0
      ? "A stranger can install ThreeNative from the registry and build a game.\n"
      : "The registry install path is broken. This is alpha row A1.\n",
  );
  process.exitCode = report.exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
