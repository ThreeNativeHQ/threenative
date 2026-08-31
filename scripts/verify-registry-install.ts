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

/** `link:` is pnpm's workspace link; `file:` is a local tarball or directory. Neither ships. */
const LOCAL_SPECIFIER = /(?:^|["'\s:])(?:file|link):/mu;

export const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"] as const;

export interface IRegistryInstallStep {
  readonly detail: string;
  readonly name: string;
  readonly ok: boolean;
}

export interface IRegistryInstallReport {
  readonly exitCode: 0 | 1;
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

function mcpRequests(serverName: string): string {
  const requests = [
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
    ...(serverName === "threenative-engine"
      ? [
          {
            id: 2,
            jsonrpc: "2.0",
            method: "tools/call",
            params: {
              arguments: { situation: "enemy walks around a wall" },
              name: "engine_search_capabilities",
            },
          },
        ]
      : []),
  ];
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

function assertMcpHandshake(serverName: string, output: string): string {
  const messages = jsonLines(output, serverName);
  requireMcpResponse(messages, serverName, 1);
  if (serverName !== "threenative-engine") return "initialize ok";
  const response = requireMcpResponse(messages, serverName, 2);
  const result = response.result as { content?: unknown };
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
    throw new Error(`MCP server '${serverName}' returned no text search result.`);
  let hits: unknown;
  try {
    hits = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `MCP server '${serverName}' returned malformed capability JSON: ${String(error)}.`,
    );
  }
  if (!Array.isArray(hits) || hits.length === 0)
    throw new Error(
      `MCP server '${serverName}' returned no capability hits for the plain-words query.`,
    );
  const malformedIndex = hits.findIndex((hit) => !isCapabilitySearchHit(hit));
  if (malformedIndex !== -1)
    throw new Error(
      `MCP server '${serverName}' returned malformed capability hit at index ${malformedIndex}; expected non-empty string symbol, importPath, summary, and example fields plus a string-only constraints array.`,
    );
  return `initialize ok; engine_search_capabilities returned ${hits.length} hit(s)`;
}

export function realMcpRunner(
  serverName: string,
  command: string,
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>> = {},
): string {
  return execFileSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    input: mcpRequests(serverName),
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 30_000,
  });
}

export interface IVerifyRegistryInstallOptions {
  /** Where the clean room is created. Must have no workspace above it. */
  readonly parent?: string;
  readonly mcp?: McpRunner;
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

function mcpStep(project: string, runner: McpRunner): string {
  const configPath = path.join(project, ".mcp.json");
  if (!fs.existsSync(configPath)) throw new Error(`MCP configuration is missing: ${configPath}.`);
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    mcpServers?: Record<string, { args?: unknown; command?: unknown; env?: unknown }>;
  };
  const servers = parsed.mcpServers;
  if (servers === undefined || Object.keys(servers).length === 0)
    throw new Error("MCP configuration declares no servers.");
  const results: string[] = [];
  for (const [name, server] of Object.entries(servers)) {
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
      results.push(
        `${name}: ${assertMcpHandshake(name, runner(name, server.command, server.args as string[], project, env))}`,
      );
    } catch (error) {
      throw new Error(
        `MCP server '${name}' handshake failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return results.join("; ");
}

export function verifyRegistryInstall(
  options: IVerifyRegistryInstallOptions = {},
): IRegistryInstallReport {
  const template = options.template ?? "starter";
  // A private cache and a private store, so a package cached from an earlier workspace install
  // cannot stand in for one the registry would have refused to serve.
  const parent = fs.mkdtempSync(
    path.join(options.parent ?? os.tmpdir(), "threenative-clean-room-"),
  );
  const cache = path.join(parent, "npm-cache");
  fs.mkdirSync(cache, { recursive: true });
  const project = path.join(parent, "my-game");
  const run =
    options.run ??
    realRunner({
      ...cleanRoomEnvironment(process.env),
      NPM_CONFIG_CACHE: cache,
      npm_config_cache: cache,
    });
  const mcp = options.mcp ?? realMcpRunner;
  const steps: IRegistryInstallStep[] = [];
  try {
    // `--no-install`, so the install step below is the one that installs.
    //
    // The scaffolder installs with pnpm when it is not told otherwise, and the next step runs
    // `npm install` — over pnpm's symlinked `node_modules`, which npm cannot read: it fails with
    // `Cannot read properties of null (reading 'matches')` and reports the registry path as broken
    // while a plain `npm install` into an empty project succeeds. Scaffolding without installing
    // makes the two steps mean what their names say, and makes `install` a real test of installing
    // these packages from the registry rather than of layering one package manager over another.
    steps.push(
      step("scaffold", () =>
        run(
          "npm",
          ["create", "threenative@latest", "my-game", "--", "--template", template, "--no-install"],
          parent,
        ),
      ),
    );
    if (steps[0]?.ok === true) {
      steps.push(step("install", () => run("npm", ["install"], project)));
      if (steps[1]?.ok === true) {
        steps.push(step("lockfile", () => `Checked ${checkLockfile(project)}; no file: or link:.`));
        steps.push(step("build", () => run("npm", ["run", "build"], project)));
        steps.push(step("test", () => run("pnpm", ["test"], project)));
        steps.push(
          step("doctor", () =>
            assertDoctorTargetCensus(run("npx", ["threenative", "doctor", "--text"], project)),
          ),
        );
        steps.push(
          step("native", () => {
            const output = run("npm", ["run", "build:desktop"], project);
            const executable = nativeOutput(project);
            const proof = verifyNativeFrames(project, run);
            return `${output}\nExecutable: ${executable}\n${proof}`;
          }),
        );
        steps.push(step("mcp", () => mcpStep(project, mcp)));
      } else {
        for (const name of ["lockfile", "build", "test", "doctor", "native", "mcp"])
          steps.push({
            detail: "Not run: the install step failed to produce an installed project.",
            name,
            ok: false,
          });
      }
    } else {
      for (const name of ["install", "lockfile", "build", "test", "doctor", "native", "mcp"])
        steps.push({
          detail: "Not run: the scaffold step never produced a project.",
          name,
          ok: false,
        });
    }
  } finally {
    fs.rmSync(parent, { force: true, recursive: true });
  }
  return { exitCode: steps.every((item) => item.ok) ? 0 : 1, steps };
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
