import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverKitManifests, templateRoot } from "../packages/create-threenative/src/index.js";
import { workspacePackageSourceFlag } from "./workspace-packages.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_FILE = "package.json";
const REQUIRED_DEPENDENCIES = ["vite", "create-threenative"] as const;
const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_REQUEST_TIMEOUT_MS = 30_000;
const SCULPT_RESOURCE_UNSAFE_BLOCK =
  /```(?:glsl|wgsl|(?:java|type)script|[jt]s)\b[\s\S]*?(?:ShaderMaterial|onBeforeCompile|diffuseColor|gl_FragColor|new\s+Mesh(?:Standard|Physical|Phong|Basic|Lambert|Toon)Material)/u;

const MCP_SURFACES = [
  { name: "threenative-assets", file: "asset-mcp-tools.json" },
  { name: "threenative-sculpt", file: "sculpt-mcp-tools.json" },
] as const;

export const GOLDEN_PATH_STEPS = [
  "pack",
  "scaffold",
  "install",
  "mcp",
  "dev",
  "test",
  "build web",
  "assert artifact",
] as const;

export type GoldenPathStep = (typeof GOLDEN_PATH_STEPS)[number];
export type TemplateStep = Exclude<GoldenPathStep, "pack">;

interface IPackageManifest {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly name?: string;
  readonly optionalDependencies?: Record<string, string>;
  readonly version?: string;
}

interface IWorkspacePackage {
  readonly directory: string;
  readonly manifest: IPackageManifest & { readonly name: string };
}

export type PackageSources = Readonly<Record<string, string>>;

export interface ICorrectiveCommand {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd: string;
}

export interface IMcpServerConfig {
  readonly args: readonly string[];
  readonly command: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface IMcpSurface {
  readonly tools: readonly string[];
  readonly version: string;
}

export interface IGoldenPathTemplateActions {
  readonly assertArtifact: () => Promise<void>;
  readonly buildWeb: () => Promise<void>;
  readonly dev: () => Promise<void>;
  readonly install: () => Promise<void>;
  readonly mcp: () => Promise<void>;
  readonly scaffold: () => Promise<void>;
  readonly test: () => Promise<void>;
}

interface IMcpPendingRequest {
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface IMcpOutputState {
  buffer: string;
}

export function assertGoldenPathSteps(steps: readonly string[]): void {
  const expected = JSON.stringify(GOLDEN_PATH_STEPS);
  const actual = JSON.stringify(steps);
  if (actual !== expected) {
    const missing = GOLDEN_PATH_STEPS.filter((step) => !steps.includes(step));
    throw new Error(
      `TN_GOLDEN_PATH_PLAN_INVALID: expected ${expected}; received ${actual}; missing ${
        missing.join(", ") || "none"
      }.`,
    );
  }
}

export function discoverGoldenPathTemplates(root = templateRoot()): readonly string[] {
  const templates = discoverKitManifests(root).map(({ name }) => name);
  if (templates.length === 0) {
    throw new Error("TN_GOLDEN_PATH_TEMPLATES_EMPTY: no templates found.");
  }
  return templates;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandLine(command: string, args: readonly string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

export function formatCorrectiveCommand(command: ICorrectiveCommand): string {
  return `(cd ${shellQuote(command.cwd)} && ${commandLine(command.command, command.args)})`;
}

export function goldenPathCorrectiveCommands(
  project: string,
  devPort = 4173,
): Readonly<Record<TemplateStep, ICorrectiveCommand>> {
  const target = path.resolve(project);
  return {
    scaffold: {
      args: [path.basename(target)],
      command: "./scaffold.sh",
      cwd: path.dirname(target),
    },
    install: {
      args: ["install", "--reporter", "append-only"],
      command: "pnpm",
      cwd: target,
    },
    mcp: {
      args: ["install", "--reporter", "append-only"],
      command: "pnpm",
      cwd: target,
    },
    dev: {
      args: ["dev", "--host", "127.0.0.1", "--port", String(devPort), "--strictPort"],
      command: "pnpm",
      cwd: target,
    },
    test: {
      args: ["test"],
      command: "pnpm",
      cwd: target,
    },
    "build web": {
      args: ["exec", "threenative", "build", "--target", "web"],
      command: "pnpm",
      cwd: target,
    },
    "assert artifact": {
      args: ["exec", "threenative", "build", "--target", "web"],
      command: "pnpm",
      cwd: target,
    },
  };
}

export async function runGoldenPathTemplate(
  template: string,
  actions: IGoldenPathTemplateActions,
  project = template,
  commands?: Readonly<Record<TemplateStep, ICorrectiveCommand>>,
): Promise<readonly TemplateStep[]> {
  const executed: TemplateStep[] = [];
  const correctiveCommands = commands ?? goldenPathCorrectiveCommands(project);
  const runStep = async (step: TemplateStep, action: () => Promise<void>): Promise<void> => {
    executed.push(step);
    process.stdout.write(`golden-path ${template}: ${step}\n`);
    try {
      await action();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `TN_GOLDEN_PATH_FAILED: template '${template}' at layer '${step}' in project '${project}'. Searched: project '${project}'. Corrective command: ${formatCorrectiveCommand(correctiveCommands[step])}. ${detail}`,
      );
    }
  };

  await runStep("scaffold", actions.scaffold);
  await runStep("install", actions.install);
  await runStep("mcp", actions.mcp);
  await runStep("dev", actions.dev);
  await runStep("test", actions.test);
  await runStep("build web", actions.buildWeb);
  await runStep("assert artifact", actions.assertArtifact);
  assertGoldenPathSteps(["pack", ...executed]);
  return executed;
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(file: string): Promise<IPackageManifest> {
  return JSON.parse(await readFile(file, "utf8")) as IPackageManifest;
}

export async function workspacePackages(
  packagesRoot = path.join(REPO_ROOT, "packages"),
): Promise<readonly IWorkspacePackage[]> {
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const packages: IWorkspacePackage[] = [];
  const skipped: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(packagesRoot, entry.name);
    const manifestPath = path.join(directory, PACKAGE_FILE);
    // A directory under packages/ with no manifest is not a workspace package. Anyone with a
    // leftover build directory from another branch has one, and this used to fail the whole gate
    // with a raw ENOENT naming a file rather than the directory that caused it.
    if (!(await pathExists(manifestPath))) {
      skipped.push(entry.name);
      continue;
    }
    const manifest = await readManifest(manifestPath);
    if (typeof manifest.name !== "string" || manifest.name.length === 0) {
      throw new Error(`TN_GOLDEN_PATH_PACKAGE_INVALID: ${directory} has no package name.`);
    }
    packages.push({ directory, manifest: { ...manifest, name: manifest.name } });
  }
  if (skipped.length > 0) {
    process.stdout.write(
      `TN_GOLDEN_PATH_PACKAGE_SKIPPED: no ${PACKAGE_FILE} under packages/${skipped.join(", packages/")}; not a workspace package, skipping.\n`,
    );
  }
  if (packages.length === 0) {
    throw new Error("TN_GOLDEN_PATH_PACKAGES_EMPTY: no packages found.");
  }
  return packages.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

async function readMcpSurface(file: string): Promise<IMcpSurface> {
  const value = JSON.parse(await readFile(file, "utf8")) as unknown;
  if (
    !isRecord(value) ||
    typeof value.version !== "string" ||
    !Array.isArray(value.tools) ||
    value.tools.some((tool) => typeof tool !== "string")
  ) {
    throw new Error(`TN_GOLDEN_PATH_MCP_SURFACE_INVALID: ${file}`);
  }
  return { tools: value.tools, version: value.version };
}

export function assertMcpToolSurface(
  serverName: string,
  expected: readonly string[],
  response: unknown,
): void {
  if (!isRecord(response) || !Array.isArray(response.tools)) {
    throw new Error(`TN_GOLDEN_PATH_MCP_TOOLS_INVALID: ${serverName} returned no tools list.`);
  }
  const actual = response.tools.map((tool) => {
    if (!isRecord(tool) || typeof tool.name !== "string") {
      throw new Error(`TN_GOLDEN_PATH_MCP_TOOL_INVALID: ${serverName} returned a nameless tool.`);
    }
    return tool.name;
  });
  const expectedNames = [...expected].sort();
  const actualNames = [...actual].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `${serverName} surface drifted.\nexpected ${expectedNames.length}: ${expectedNames.join(
        ", ",
      )}\nactual ${actualNames.length}: ${actualNames.join(", ")}`,
    );
  }
}

async function assertSculptResources(
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): Promise<void> {
  const listed = await request("resources/list");
  if (!isRecord(listed) || !Array.isArray(listed.resources) || listed.resources.length === 0) {
    throw new Error("threenative-sculpt listed no technique resources.");
  }
  for (const resource of listed.resources) {
    if (!isRecord(resource) || typeof resource.uri !== "string") {
      throw new Error("threenative-sculpt returned a resource without a URI.");
    }
    const read = await request("resources/read", { uri: resource.uri });
    if (!isRecord(read) || !Array.isArray(read.contents)) {
      throw new Error(`threenative-sculpt resource '${resource.uri}' could not be read.`);
    }
    const text = read.contents
      .map((content) => (isRecord(content) && typeof content.text === "string" ? content.text : ""))
      .join("\n");
    if (text.trim().length === 0) {
      throw new Error(`threenative-sculpt resource '${resource.uri}' was empty.`);
    }
    if (SCULPT_RESOURCE_UNSAFE_BLOCK.test(text)) {
      throw new Error(`Sculpt grimoire resource owns the look: ${resource.uri}`);
    }
  }
}

function resolveMcpMessage(value: unknown, pending: Map<number, IMcpPendingRequest>): void {
  if (!isRecord(value) || typeof value.id !== "number") return;
  const waiter = pending.get(value.id);
  if (waiter === undefined) return;
  pending.delete(value.id);
  clearTimeout(waiter.timer);
  if (value.error !== undefined) waiter.reject(new Error(JSON.stringify(value.error)));
  else waiter.resolve(value.result);
}

function consumeMcpOutput(
  chunk: Buffer | string,
  state: IMcpOutputState,
  pending: Map<number, IMcpPendingRequest>,
): void {
  state.buffer += chunk.toString();
  const lines = state.buffer.split(/\r?\n/u);
  state.buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim().startsWith("{")) continue;
    try {
      resolveMcpMessage(JSON.parse(line) as unknown, pending);
    } catch {
      // MCP servers may log non-JSON lines to stdout; pending requests still time out.
    }
  }
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode === null) {
    if (process.platform === "win32" || child.pid === undefined) child.kill("SIGTERM");
    else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
  }
  const exited = child.exitCode === null ? once(child, "exit") : Promise.resolve();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

export async function probeMcpServer(
  serverName: string,
  server: IMcpServerConfig,
  surface: IMcpSurface,
  cwd: string,
): Promise<void> {
  const child = spawn(server.command, [...server.args], {
    cwd,
    env: { ...process.env, ...server.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output: IMcpOutputState = { buffer: "" };
  let stderr = "";
  let terminalError: Error | undefined;
  const pending = new Map<number, IMcpPendingRequest>();
  const failPending = (error: Error): void => {
    terminalError = error;
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  };
  child.stdout?.on("data", (chunk: Buffer | string) => consumeMcpOutput(chunk, output, pending));
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });
  child.once("error", (error) => {
    failPending(error instanceof Error ? error : new Error(String(error)));
  });
  child.once("exit", (code, signal) => {
    const detail = stderr.trim().slice(-500);
    failPending(
      new Error(
        `${serverName} exited before completing MCP requests (${code ?? `signal ${signal ?? "unknown"}`})${detail.length > 0 ? `: ${detail}` : ""}.`,
      ),
    );
  });

  let nextId = 1;
  const request = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    if (terminalError !== undefined) return Promise.reject(terminalError);
    const id = nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        const detail = stderr.trim().slice(-500);
        reject(
          new Error(
            `${serverName} ${method} timed out after ${MCP_REQUEST_TIMEOUT_MS}ms${detail.length > 0 ? `: ${detail}` : ""}.`,
          ),
        );
      }, MCP_REQUEST_TIMEOUT_MS);
      pending.set(id, { reject, resolve, timer });
      try {
        child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  };

  try {
    await request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "threenative-golden-path", version: "0" },
    });
    child.stdin?.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    const listed = await request("tools/list");
    assertMcpToolSurface(serverName, surface.tools, listed);
    if (serverName === "threenative-sculpt") await assertSculptResources(request);
    process.stdout.write(
      `${serverName} ok: ${surface.tools.length} tools from ${surface.version}\n`,
    );
  } finally {
    await stopProcess(child);
  }
}

export async function assertMcpServers(target: string): Promise<void> {
  const configPath = path.join(target, ".mcp.json");
  const parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
    throw new Error(`TN_GOLDEN_PATH_MCP_CONFIG_INVALID: ${configPath} has no mcpServers.`);
  }
  for (const { file, name } of MCP_SURFACES) {
    const rawServer = parsed.mcpServers[name];
    if (!isRecord(rawServer) || typeof rawServer.command !== "string") {
      throw new Error(`TN_GOLDEN_PATH_MCP_SERVER_MISSING: ${configPath} lacks '${name}'.`);
    }
    const args = rawServer.args;
    if (
      !Array.isArray(args) ||
      !args.every((argument): argument is string => typeof argument === "string")
    ) {
      throw new Error(`TN_GOLDEN_PATH_MCP_ARGS_INVALID: ${configPath} has invalid '${name}' args.`);
    }
    const env = rawServer.env;
    if (env !== undefined && !isStringRecord(env)) {
      throw new Error(`TN_GOLDEN_PATH_MCP_ENV_INVALID: ${configPath} has invalid '${name}' env.`);
    }
    await probeMcpServer(
      name,
      {
        args,
        command: rawServer.command,
        ...(env === undefined ? {} : { env }),
      },
      await readMcpSurface(path.join(REPO_ROOT, "packages/create-threenative", file)),
      target,
    );
  }
}

export async function runCommand(
  layer: GoldenPathStep,
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<void> {
  const printable = commandLine(command, args);
  const correctiveCommand: ICorrectiveCommand = { args, command, cwd };
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: "inherit" });
    child.once("error", (error) => {
      reject(
        new Error(
          `TN_GOLDEN_PATH_COMMAND_FAILED: layer '${layer}' failed in project '${cwd}'. Searched: project '${cwd}' and PATH for '${command}'. Corrective command: ${formatCorrectiveCommand(correctiveCommand)}. ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    });
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `TN_GOLDEN_PATH_COMMAND_FAILED: layer '${layer}' failed in project '${cwd}'. Searched: project '${cwd}' and PATH for '${command}'. Corrective command: ${formatCorrectiveCommand(correctiveCommand)}. ${printable} exited ${code ?? `by ${signal ?? "unknown"}`}.`,
          ),
        );
      }
    });
  });
}

async function runRecordedGlobalStep(
  step: "pack",
  executed: GoldenPathStep[],
  action: () => Promise<void>,
): Promise<void> {
  executed.push(step);
  process.stdout.write(`golden-path all templates: ${step}\n`);
  try {
    await action();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `TN_GOLDEN_PATH_FAILED: all templates at layer '${step}' in project '${REPO_ROOT}'. Searched: repository '${REPO_ROOT}' and temporary package staging. Corrective command: ${formatCorrectiveCommand({ args: ["verify:golden-path"], command: "pnpm", cwd: REPO_ROOT })}. ${detail}`,
    );
  }
}

export async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

async function packTarball(
  workspacePackage: IWorkspacePackage,
  staging: string,
  fromWorkspace: boolean,
): Promise<string> {
  await runCommand(
    "pack",
    "pnpm",
    fromWorkspace
      ? ["--filter", workspacePackage.manifest.name, "pack", "--pack-destination", staging]
      : ["pack", "--pack-destination", staging],
    fromWorkspace ? REPO_ROOT : workspacePackage.directory,
  );
  const prefix = workspacePackage.manifest.name.startsWith("@")
    ? workspacePackage.manifest.name.slice(1).replace("/", "-")
    : workspacePackage.manifest.name;
  const files = (await readdir(staging)).filter(
    (file) => file.startsWith(`${prefix}-`) && file.endsWith(".tgz"),
  );
  const tarball = files.sort().at(-1);
  if (tarball === undefined) {
    throw new Error(
      `TN_GOLDEN_PATH_PACK_MISSING: pnpm pack produced no tarball for ${workspacePackage.manifest.name}.`,
    );
  }
  const result = path.join(staging, tarball);
  process.stdout.write(
    `golden-path packed ${workspacePackage.manifest.name}: source '${workspacePackage.directory}' -> tarball '${result}' sha256:${await sha256(result)}\n`,
  );
  return result;
}

export async function packPackageSource(packageRoot: string, staging: string): Promise<string> {
  const manifest = await readManifest(path.join(packageRoot, PACKAGE_FILE));
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    throw new Error(`TN_GOLDEN_PATH_PACKAGE_INVALID: ${packageRoot} has no package name.`);
  }
  return packTarball(
    { directory: packageRoot, manifest: { ...manifest, name: manifest.name } },
    staging,
    false,
  );
}

export async function packWorkspace(staging: string, build = true): Promise<PackageSources> {
  if (build) {
    await runCommand("pack", "pnpm", ["--filter", "./packages/**", "build"], REPO_ROOT);
  }
  const packages = await workspacePackages();
  const sources: Record<string, string> = {};
  for (const workspacePackage of packages) {
    sources[workspacePackage.manifest.name] = await packTarball(workspacePackage, staging, true);
  }
  return sources;
}

function declaredDependencies(manifest: IPackageManifest): Set<string> {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
}

export function assertTemplateDependencies(
  template: string,
  manifest: IPackageManifest,
  sources: PackageSources,
): Set<string> {
  const declared = declaredDependencies(manifest);
  for (const dependency of REQUIRED_DEPENDENCIES) {
    if (declared.has(dependency)) continue;
    throw new Error(
      `TN_GOLDEN_PATH_DEPENDENCY_MISSING: template '${template}' is missing dependency '${dependency}'. Add '${dependency}' to package.json and rerun pnpm verify:golden-path.`,
    );
  }
  for (const dependency of declared) {
    if (!dependency.startsWith("@threenative/") && dependency !== "create-threenative") continue;
    if (sources[dependency] !== undefined) continue;
    throw new Error(
      `TN_GOLDEN_PATH_PACK_MISSING: template '${template}' declares packed dependency '${dependency}', but no tarball was produced.`,
    );
  }
  return declared;
}

export async function writeScaffoldScript(
  directory: string,
  template: string,
  cliSource: string,
  packageArgs: readonly string[],
  options: {
    readonly cliRuntimePackages?: readonly string[];
    readonly ignoreInstallScripts?: boolean;
  } = {},
): Promise<string> {
  const script = path.join(directory, "scaffold.sh");
  const target = '"${1:-game}"';
  const invocation = [
    ...(options.ignoreInstallScripts ? ["npm_config_ignore_scripts=true"] : []),
    "pnpm",
    "dlx",
    "--silent",
    "--package",
    cliSource,
    ...(options.cliRuntimePackages ?? []).flatMap((source) => ["--package", source]),
    "create-threenative",
    target,
    "--template",
    template,
    ...packageArgs,
  ]
    .map((argument) => (argument === target ? argument : shellQuote(argument)))
    .join(" ");
  await writeFile(script, `#!/bin/sh\nset -eu\n${invocation}\n`);
  await chmod(script, 0o755);
  return script;
}

export async function scaffold(
  template: string,
  target: string,
  sources: PackageSources,
  templatesRoot: string,
  options: { readonly ignoreInstallScripts?: boolean } = {},
): Promise<void> {
  const templateManifest = await readManifest(path.join(templatesRoot, template, PACKAGE_FILE));
  const declared = declaredDependencies(templateManifest);
  const packageArgs: string[] = [];
  for (const dependency of declared) {
    const source = sources[dependency];
    if (source === undefined) continue;
    packageArgs.push(workspacePackageSourceFlag(dependency), source);
  }
  const cliSource = sources["create-threenative"];
  if (cliSource === undefined) {
    throw new Error("TN_GOLDEN_PATH_CLI_PACK_MISSING: create-threenative was not packed.");
  }
  const directory = path.dirname(target);
  const project = path.basename(target);
  const assetSource = sources["@threenative/assets"];
  await writeScaffoldScript(directory, template, cliSource, packageArgs, {
    ...options,
    ...(assetSource === undefined ? {} : { cliRuntimePackages: [assetSource] }),
  });
  assertTemplateDependencies(template, templateManifest, sources);
  process.stdout.write(`golden-path ${template}: ./scaffold.sh ${project}\n`);
  await runCommand("scaffold", "./scaffold.sh", [project], directory);
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (address === null || typeof address === "string") {
    throw new Error("TN_GOLDEN_PATH_PORT_INVALID");
  }
  return address.port;
}

async function waitForDevServer(
  child: ChildProcess,
  url: string,
  template: string,
  project: string,
  port: number,
): Promise<void> {
  const correctiveCommand = formatCorrectiveCommand(
    goldenPathCorrectiveCommands(project, port).dev,
  );
  const deadline = Date.now() + 30_000;
  let lastError = "no response";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `TN_GOLDEN_PATH_DEV_UNAVAILABLE: project '${project}' searched '${url}'; corrective command: ${correctiveCommand}. Dev server exited before responding with code ${child.exitCode}.`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `TN_GOLDEN_PATH_DEV_UNAVAILABLE: project '${project}' searched '${url}'; corrective command: ${correctiveCommand}. Dev server for '${template}' did not answer: ${lastError}.`,
  );
}

async function runDev(target: string, template: string, port: number): Promise<void> {
  const child = spawn(
    "pnpm",
    ["dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: target, detached: process.platform !== "win32", stdio: "inherit" },
  );
  const failed = new Promise<never>((_, reject) => {
    child.once("error", (error) => reject(error));
  });
  try {
    await Promise.race([
      waitForDevServer(child, `http://127.0.0.1:${port}/`, template, target, port),
      failed,
    ]);
  } finally {
    await stopProcess(child);
  }
}

async function assertArtifact(target: string, template: string): Promise<void> {
  const artifact = path.join(target, "dist", "index.html");
  const info = await stat(artifact).catch(() => undefined);
  if (info === undefined) {
    throw new Error(`template '${template}' produced no web artifact at '${artifact}'.`);
  }
  if (!info.isFile() || info.size === 0) {
    throw new Error(`template '${template}' produced an empty web artifact at '${artifact}'.`);
  }
}

async function runTemplate(
  template: string,
  target: string,
  sources: PackageSources,
  templatesRoot: string,
): Promise<readonly TemplateStep[]> {
  const port = await freePort();
  return runGoldenPathTemplate(
    template,
    {
      scaffold: async () => {
        await scaffold(template, target, sources, templatesRoot);
        await stat(target);
      },
      install: () =>
        runCommand("install", "pnpm", ["install", "--reporter", "append-only"], target),
      mcp: () => assertMcpServers(target),
      dev: () => runDev(target, template, port),
      test: () => runCommand("test", "pnpm", ["test"], target),
      buildWeb: () =>
        runCommand(
          "build web",
          "pnpm",
          ["exec", "threenative", "build", "--target", "web"],
          target,
        ),
      assertArtifact: () => assertArtifact(target, template),
    },
    target,
    goldenPathCorrectiveCommands(target, port),
  );
}

export interface IPackedMutationEvidence {
  readonly generatedManifest: string;
  readonly mutatedSha256: string;
  readonly mutatedTarball: string;
  readonly repositorySha256: string;
  readonly repositoryTarball: string;
}

async function materializeTemporaryPackageVersions(packageRoot: string): Promise<void> {
  const manifestPath = path.join(packageRoot, PACKAGE_FILE);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
    const dependencies = manifest[field];
    if (!isRecord(dependencies)) continue;
    for (const [name, specifier] of Object.entries(dependencies)) {
      if (
        typeof specifier !== "string" ||
        (specifier !== "catalog:" && !specifier.startsWith("workspace:"))
      ) {
        continue;
      }
      const dependencyManifest = await readManifest(
        path.join(REPO_ROOT, "packages/create-threenative/node_modules", name, PACKAGE_FILE),
      );
      if (dependencyManifest.version === undefined) {
        throw new Error(
          `TN_GOLDEN_PATH_PACKAGE_VERSION_MISSING: cannot materialize '${name}' for '${packageRoot}'.`,
        );
      }
      dependencies[name] = dependencyManifest.version;
    }
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function verifyPackedMutationControl(
  sources: PackageSources,
  template = "starter",
): Promise<IPackedMutationEvidence> {
  const repositoryTarball = sources["create-threenative"];
  if (repositoryTarball === undefined) {
    throw new Error("TN_GOLDEN_PATH_CLI_PACK_MISSING: create-threenative was not packed.");
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "threenative-golden-path-mutated-"));
  try {
    const mutatedPackage = path.join(root, "create-threenative");
    await cp(path.join(REPO_ROOT, "packages/create-threenative"), mutatedPackage, {
      filter: (source) => path.basename(source) !== "node_modules",
      recursive: true,
    });
    await materializeTemporaryPackageVersions(mutatedPackage);
    const templateManifestPath = path.join(mutatedPackage, "templates", template, PACKAGE_FILE);
    const templateManifest = JSON.parse(await readFile(templateManifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    const devDependencies = templateManifest.devDependencies;
    if (!isRecord(devDependencies) || typeof devDependencies.vite !== "string") {
      throw new Error(
        `TN_GOLDEN_PATH_MUTATION_INVALID: template '${template}' does not declare vite in devDependencies.`,
      );
    }
    devDependencies.vite = undefined;
    await writeFile(templateManifestPath, `${JSON.stringify(templateManifest, null, 2)}\n`);

    const staging = path.join(root, "packages");
    await mkdir(staging, { recursive: true });
    const mutatedTarball = await packPackageSource(mutatedPackage, staging);
    const repositorySha256 = await sha256(repositoryTarball);
    const mutatedSha256 = await sha256(mutatedTarball);
    if (repositorySha256 === mutatedSha256) {
      throw new Error(
        `TN_GOLDEN_PATH_MUTATION_IDENTITY: mutated template packed to the repository tarball '${repositoryTarball}'.`,
      );
    }
    process.stdout.write(
      `golden-path alternate: repository '${repositoryTarball}' sha256:${repositorySha256}; mutated '${mutatedTarball}' sha256:${mutatedSha256}\n`,
    );

    const alternateSources = { ...sources, "create-threenative": mutatedTarball };
    const target = path.join(root, "mutated-project");
    await scaffold(template, target, alternateSources, templateRoot(), {
      ignoreInstallScripts: true,
    });
    const generatedManifest = path.join(target, PACKAGE_FILE);
    const generated = await readManifest(generatedManifest);
    if (declaredDependencies(generated).has("vite")) {
      throw new Error(
        `TN_GOLDEN_PATH_MUTATION_NOT_SCAFFOLDED: generated manifest '${generatedManifest}' still contains vite. Packed source '${mutatedTarball}' sha256:${mutatedSha256}.`,
      );
    }
    process.stdout.write(
      `golden-path alternate: generated manifest '${generatedManifest}' contains the removed vite dependency from '${mutatedTarball}'\n`,
    );

    // The mutation-control assertion only checks that the packed template lost `vite`. Running
    // package install hooks here would make this proof depend on optional native release assets.
    await runCommand(
      "install",
      "pnpm",
      ["install", "--ignore-scripts", "--reporter", "append-only"],
      target,
    );
    const port = await freePort();
    let failed = false;
    try {
      await runCommand(
        "dev",
        "pnpm",
        ["dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
        target,
      );
    } catch (error) {
      failed = true;
      process.stdout.write(
        `golden-path alternate: expected broken dependency failed from '${target}': ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    if (!failed) {
      throw new Error(
        `TN_GOLDEN_PATH_MUTATION_DEPENDENCY_RESTORED: mutated template '${template}' unexpectedly completed its dev command.`,
      );
    }
    return {
      generatedManifest,
      mutatedSha256,
      mutatedTarball,
      repositorySha256,
      repositoryTarball,
    };
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

export async function verifyGoldenPath(templatesRoot = templateRoot()): Promise<void> {
  const templates = discoverGoldenPathTemplates(templatesRoot);
  const root = await mkdtemp(path.join(os.tmpdir(), "threenative-golden-path-"));
  try {
    const staging = path.join(root, "packages");
    const executed: GoldenPathStep[] = [];
    let sources: PackageSources | undefined;
    await runRecordedGlobalStep("pack", executed, async () => {
      await mkdir(staging, { recursive: true });
      sources = await packWorkspace(staging);
    });
    if (sources === undefined) {
      throw new Error("TN_GOLDEN_PATH_PACK_EMPTY: no package sources.");
    }
    if (JSON.stringify(executed) !== JSON.stringify(["pack"])) {
      throw new Error(
        `TN_GOLDEN_PATH_PLAN_INVALID: recorded global steps were ${JSON.stringify(executed)}.`,
      );
    }
    for (const template of templates) {
      await runTemplate(template, path.join(root, template), sources, templatesRoot);
    }
    await verifyPackedMutationControl(sources);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function main(): Promise<void> {
  await verifyGoldenPath();
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
