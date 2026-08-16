#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ScaffoldTemplate = string;

export interface IKitManifest {
  readonly blurb: string;
  readonly genre: string;
  readonly kit: boolean;
  readonly name: ScaffoldTemplate;
  readonly title: string;
}

export interface IScaffoldOptions {
  install?: boolean;
  packageSources?: Partial<
    Record<
      | "@threenative/core"
      | "@threenative/physics"
      | "@threenative/playtest"
      | "@threenative/runtime-native"
      | "@threenative/studio"
      | "@threenative/ui"
      | "create-threenative",
      string
    >
  >;
  target: string;
  template?: ScaffoldTemplate;
}

export interface IScaffoldResult {
  installed: boolean;
  target: string;
  template: ScaffoldTemplate;
}

const TEXT_FILE_EXTENSIONS = new Set([".css", ".html", ".json", ".md", ".svg", ".ts", ".tsx"]);
const TEMPLATE_NAME = /^[a-z][a-z0-9-]*$/u;

export function templateRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../templates");
}

function invalidManifest(file: string, reason: string): never {
  throw new Error(`TN_KIT_MANIFEST_INVALID: ${file}: ${reason}`);
}

function nonEmptyString(value: unknown, field: string, file: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    return invalidManifest(file, `${field} must be a non-empty string`);
  return value;
}

function loadManifest(directory: string): IKitManifest {
  const file = path.join(directory, "kit.json");
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(`TN_KIT_MANIFEST_MISSING: ${file}`);
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    return invalidManifest(file, `JSON could not be parsed: ${String(error)}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return invalidManifest(file, "the root must be an object");
  const record = value as Record<string, unknown>;
  const directoryName = path.basename(directory);
  const name = nonEmptyString(record.name, "name", file);
  if (!TEMPLATE_NAME.test(name))
    return invalidManifest(file, "name must match /^[a-z][a-z0-9-]*$/");
  if (name !== directoryName)
    return invalidManifest(file, `name '${name}' must match directory '${directoryName}'`);
  const kit = record.kit;
  if (typeof kit !== "boolean") return invalidManifest(file, "kit must be a boolean");
  return {
    blurb: nonEmptyString(record.blurb, "blurb", file),
    genre: nonEmptyString(record.genre, "genre", file),
    kit,
    name,
    title: nonEmptyString(record.title, "title", file),
  };
}

/** Reads every template directory on each call so a new kit is live without a TypeScript edit. */
export function discoverKitManifests(root = templateRoot()): readonly IKitManifest[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => loadManifest(path.join(root, entry.name)))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function discoverTemplateNames(root = templateRoot()): readonly ScaffoldTemplate[] {
  return discoverKitManifests(root).map(({ name }) => name);
}

export function kitManifest(template: ScaffoldTemplate, root = templateRoot()): IKitManifest {
  const manifest = discoverKitManifests(root).find(({ name }) => name === template);
  if (manifest === undefined)
    throw new Error(
      `Unknown template '${template}'. Available templates: ${discoverTemplateNames(root).join(", ")}.`,
    );
  return manifest;
}

function templateHelp(manifests: readonly IKitManifest[]): string {
  const width = Math.max(...manifests.map(({ name }) => name.length), 0);
  return manifests
    .map(({ blurb, name, title }) => `  ${name.padEnd(width)}  ${title}: ${blurb}`)
    .join("\n");
}

export function cliHelp(): string {
  const manifests = discoverKitManifests();
  return `${[
    "Usage: npx create-threenative <directory> [options]",
    "",
    "Options:",
    "  --template <name>  Choose a template.",
    "  --no-install       Copy the project without running pnpm install.",
    "  --help             Show this help.",
    "",
    "Templates:",
    templateHelp(manifests),
  ].join("\n")}\n`;
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

async function renderTemplate(
  directory: string,
  replacements: Readonly<Record<string, string>>,
): Promise<void> {
  const files = await readdir(directory, { withFileTypes: true });
  for (const entry of files) {
    const source = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await renderTemplate(source, replacements);
      continue;
    }
    if (!TEXT_FILE_EXTENSIONS.has(path.extname(entry.name))) continue;
    const content = await readFile(source, "utf8");
    let rendered = content;
    for (const [placeholder, value] of Object.entries(replacements)) {
      rendered = rendered.replaceAll(placeholder, value);
    }
    await writeFile(source, rendered);
  }
}

async function applyPackageSources(
  target: string,
  packageSources: IScaffoldOptions["packageSources"],
): Promise<void> {
  if (packageSources === undefined) return;
  const packagePath = path.join(target, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    pnpm?: { overrides?: Record<string, string> };
  };
  for (const [name, source] of Object.entries(packageSources)) {
    if (source === undefined) continue;
    if (packageJson.optionalDependencies?.[name] !== undefined) {
      packageJson.optionalDependencies[name] = source.startsWith("file:")
        ? source
        : `file:${source}`;
    } else if (
      name === "@threenative/playtest" ||
      name === "@threenative/studio" ||
      name === "create-threenative"
    ) {
      packageJson.devDependencies ??= {};
      packageJson.devDependencies[name] = source.startsWith("file:") ? source : `file:${source}`;
    } else {
      packageJson.dependencies ??= {};
      packageJson.dependencies[name] = source.startsWith("file:") ? source : `file:${source}`;
    }
    if (name === "create-threenative") {
      packageJson.pnpm ??= {};
      packageJson.pnpm.overrides ??= {};
      packageJson.pnpm.overrides[name] = source.startsWith("file:") ? source : `file:${source}`;
    }
  }
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

const NODE_MODULES_PREFIX = "./node_modules/";
const REQUIRED_MCP_SERVERS = ["threenative-assets", "threenative-sculpt"] as const;

function mcpPackageName(entry: string): string {
  const segments = entry.slice(NODE_MODULES_PREFIX.length).split("/");
  return entry.startsWith(`${NODE_MODULES_PREFIX}@`)
    ? segments.slice(0, 2).join("/")
    : (segments[0] ?? "");
}

/** Fails closed: a project whose MCP config is missing, incomplete, or points at a package it
 * does not install would silently hand the user's agent none of its authoring tools. */
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
  for (const name of REQUIRED_MCP_SERVERS) {
    if (mcpServers[name] === undefined) {
      throw new Error(`'${configPath}' is missing required MCP server '${name}'.`);
    }
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
  options: IScaffoldOptions,
  cwd = process.cwd(),
): Promise<IScaffoldResult> {
  const manifests = discoverKitManifests();
  const template = options.template ?? "starter";
  if (!manifests.some(({ name }) => name === template)) kitManifest(template);
  const target = path.resolve(cwd, options.target);
  const targetExists = await isEmpty(target).catch(() => false);
  if (!targetExists) {
    throw new Error(`Target '${target}' already exists and is not empty.`);
  }

  await mkdir(target, { recursive: true });
  const source = path.join(templateRoot(), template);
  await cp(source, target, { recursive: true, errorOnExist: true });
  const projectName = packageName(target);
  const compactProjectId = projectName.toLowerCase().replace(/[^a-z0-9]+/gu, "") || "game";
  const projectId = /^[a-z]/u.test(compactProjectId) ? compactProjectId : `game${compactProjectId}`;
  // Entries rather than an object literal: these are template tokens, not identifiers. Written as
  // property names they read as names the naming rule must judge, and `__PROJECT_NAME__` is
  // neither ours to rename nor expressible in camelCase.
  await renderTemplate(
    target,
    Object.fromEntries([
      ["__PROJECT_NAME__", projectName],
      ["__PROJECT_ID__", projectId],
    ]),
  );
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

export function parseArgs(argv: readonly string[]): IScaffoldOptions {
  const target = argv.find(
    (value, index) => !value.startsWith("-") && (index === 0 || !argv[index - 1]?.startsWith("--")),
  );
  if (target === undefined)
    throw new Error("Missing target directory. Usage: pnpm create threenative my-game");
  const template = readFlag(argv, "--template") as ScaffoldTemplate | undefined;
  if (template !== undefined) kitManifest(template);
  const packageSources: Record<string, string> = {};
  for (const [name, flag] of [
    ["@threenative/core", "--core-package"],
    ["@threenative/physics", "--physics-package"],
    ["@threenative/playtest", "--playtest-package"],
    ["@threenative/runtime-native", "--runtime-native-package"],
    ["@threenative/studio", "--studio-package"],
    ["@threenative/ui", "--ui-package"],
    ["create-threenative", "--cli-package"],
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
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(cliHelp());
    return;
  }
  const result = await createProject(parseArgs(argv));
  process.stdout.write(`Created ${result.template} project at ${result.target}\n`);
  process.stdout.write(
    "Templates: minimal (smallest), starter (default), platformer. Choose with --template <name>.\n",
  );
  if (!result.installed)
    process.stdout.write("Skipped install (--no-install). Run pnpm install, then pnpm dev.\n");
  else process.stdout.write("Next: cd into the project and run pnpm dev.\n");
}

// `realpathSync`, not `path.resolve`. A package manager installs a `bin` as a symlink, so the
// installed CLI runs as `node_modules/.bin/create-threenative` while `import.meta.url` is the
// real `dist/index.js`. `path.resolve` normalises a path but does not follow symlinks, so the
// two never matched, this guard was false, and the published CLI exited 0 having done nothing —
// no project, no error, no output. It worked in this workspace only because the tests invoke
// `dist/index.js` directly.
//
// `packages/playtest/src/runner/cli.ts:180` carries the same fix for the same reason; its
// regression test is `__tests__/cli-bin.spec.ts`.
const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  existsSync(entryPath) &&
  realpathSync(path.resolve(entryPath)) === realpathSync(fileURLToPath(import.meta.url))
) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
