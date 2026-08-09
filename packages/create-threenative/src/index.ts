#!/usr/bin/env node
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ScaffoldTemplate = "minimal" | "platformer" | "starter";

export interface ScaffoldOptions {
  install?: boolean;
  packageSources?: Partial<
    Record<
      "@threenative/core" | "@threenative/physics" | "@threenative/playtest" | "@threenative/ui",
      string
    >
  >;
  target: string;
  template?: ScaffoldTemplate;
}

export interface ScaffoldResult {
  installed: boolean;
  target: string;
  template: ScaffoldTemplate;
}

const TEMPLATE_NAMES: readonly ScaffoldTemplate[] = ["minimal", "starter", "platformer"];
const TEXT_FILE_EXTENSIONS = new Set([".css", ".html", ".json", ".md", ".svg", ".ts", ".tsx"]);

function templateRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../templates");
}

function packageName(target: string): string {
  const name = path
    .basename(target)
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-");
  if (name.length === 0 || name === "-" || name === "_") {
    throw new Error(`Cannot derive a package name from '${target}'.`);
  }
  return name;
}

async function isEmpty(directory: string): Promise<boolean> {
  const entries = await readdir(directory).catch(() => []);
  return entries.length === 0;
}

async function renderTemplate(directory: string, projectName: string): Promise<void> {
  const files = await readdir(directory, { withFileTypes: true });
  for (const entry of files) {
    const source = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await renderTemplate(source, projectName);
      continue;
    }
    if (!TEXT_FILE_EXTENSIONS.has(path.extname(entry.name))) continue;
    const content = await readFile(source, "utf8");
    await writeFile(source, content.replaceAll("__PROJECT_NAME__", projectName));
  }
}

async function applyPackageSources(
  target: string,
  packageSources: ScaffoldOptions["packageSources"],
): Promise<void> {
  if (packageSources === undefined) return;
  const packagePath = path.join(target, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  for (const [name, source] of Object.entries(packageSources)) {
    if (source === undefined) continue;
    if (name === "@threenative/playtest") {
      packageJson.devDependencies ??= {};
      packageJson.devDependencies[name] = source.startsWith("file:") ? source : `file:${source}`;
    } else {
      packageJson.dependencies ??= {};
      packageJson.dependencies[name] = source.startsWith("file:") ? source : `file:${source}`;
    }
  }
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

const NODE_MODULES_PREFIX = "./node_modules/";

function mcpPackageName(entry: string): string {
  const segments = entry.slice(NODE_MODULES_PREFIX.length).split("/");
  return entry.startsWith(`${NODE_MODULES_PREFIX}@`)
    ? segments.slice(0, 2).join("/")
    : (segments[0] ?? "");
}

/** Fails closed: a project whose MCP config is missing, empty, or points at a package it does
 * not install would silently hand the user's agent no asset tools at all. */
async function assertMcpConfig(target: string): Promise<void> {
  const configPath = path.join(target, ".mcp.json");
  const raw = await readFile(configPath, "utf8").catch(() => {
    throw new Error(`Scaffold produced no .mcp.json at '${configPath}'.`);
  });
  const { mcpServers } = JSON.parse(raw) as {
    mcpServers?: Record<
      string,
      { args?: string[]; command?: string; env?: Record<string, string> }
    >;
  };
  if (mcpServers === undefined || Object.keys(mcpServers).length === 0) {
    throw new Error(`'${configPath}' declares no mcpServers.`);
  }
  const manifest = JSON.parse(await readFile(path.join(target, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
  for (const [name, server] of Object.entries(mcpServers)) {
    const entry = server.args?.[0];
    if (entry === undefined || !entry.startsWith(NODE_MODULES_PREFIX)) {
      throw new Error(
        `MCP server '${name}' must launch from '${NODE_MODULES_PREFIX}', not '${entry ?? "nothing"}'.`,
      );
    }
    const dependency = mcpPackageName(entry);
    if (!declared.has(dependency)) {
      throw new Error(
        `MCP server '${name}' launches '${dependency}', which this project does not depend on.`,
      );
    }
    // Without a download directory the server writes into ~/Downloads, so a downloaded asset
    // never reaches the game and the agent cannot tell. An absolute or escaping path is the
    // same bug with a different destination.
    for (const [key, value] of Object.entries(server.env ?? {})) {
      if (!key.endsWith("_DOWNLOAD_DIR")) continue;
      if (!value.startsWith("./") || value.includes("..")) {
        throw new Error(
          `MCP server '${name}' sets ${key}='${value}'; it must be a './' path inside the project.`,
        );
      }
    }
  }
}

async function runInstall(target: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", ["install"], { cwd: target, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pnpm install exited with code ${code ?? "unknown"}.`));
    });
  });
}

export async function createProject(
  options: ScaffoldOptions,
  cwd = process.cwd(),
): Promise<ScaffoldResult> {
  const template = options.template ?? "starter";
  if (!TEMPLATE_NAMES.includes(template)) {
    throw new Error(`Unknown template '${template}'. Choose minimal, starter, or platformer.`);
  }
  const target = path.resolve(cwd, options.target);
  const targetExists = await isEmpty(target).catch(() => false);
  if (!targetExists) {
    throw new Error(`Target '${target}' already exists and is not empty.`);
  }

  await mkdir(target, { recursive: true });
  const source = path.join(templateRoot(), template);
  await cp(source, target, { recursive: true, errorOnExist: true });
  await renderTemplate(target, packageName(target));
  await applyPackageSources(target, options.packageSources);
  await assertMcpConfig(target);

  const installed = options.install ?? true;
  if (installed) await runInstall(target);
  return { installed, target, template };
}

function readFlag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

export function parseArgs(argv: readonly string[]): ScaffoldOptions {
  const target = argv.find(
    (value, index) => !value.startsWith("-") && (index === 0 || !argv[index - 1]?.startsWith("--")),
  );
  if (target === undefined)
    throw new Error("Missing target directory. Usage: pnpm create threenative my-game");
  const template = readFlag(argv, "--template") as ScaffoldTemplate | undefined;
  if (template !== undefined && !TEMPLATE_NAMES.includes(template)) {
    throw new Error(`Unknown template '${template}'. Choose minimal, starter, or platformer.`);
  }
  const packageSources: Record<string, string> = {};
  for (const [name, flag] of [
    ["@threenative/core", "--core-package"],
    ["@threenative/physics", "--physics-package"],
    ["@threenative/playtest", "--playtest-package"],
    ["@threenative/ui", "--ui-package"],
  ] as const) {
    const source = readFlag(argv, flag);
    if (source !== undefined) packageSources[name] = source;
  }
  return {
    install: !argv.includes("--no-install"),
    target,
    ...(Object.keys(packageSources).length === 0 ? {} : { packageSources }),
    ...(template === undefined ? {} : { template }),
  };
}

async function main(): Promise<void> {
  const result = await createProject(parseArgs(process.argv.slice(2)));
  process.stdout.write(`Created ${result.template} project at ${result.target}\n`);
  if (!result.installed)
    process.stdout.write("Skipped install (--no-install). Run pnpm install, then pnpm dev.\n");
  else process.stdout.write("Next: cd into the project and run pnpm dev.\n");
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
