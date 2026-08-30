#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectCommand, inspectHelp } from "./inspect.js";

export { createEngineFreshnessPlugin, hashEngineDist } from "./engine-freshness.js";
export { createWebBrandPlugin, renderWebManifest } from "./web-brand.js";

export type ScaffoldTemplate = string;

const PACKAGE_SOURCE_FLAGS = {
  "@threenative/core": "--core-package",
  "@threenative/assets": "--assets-package",
  "@threenative/physics": "--physics-package",
  "@threenative/playtest": "--playtest-package",
  "@threenative/runtime-native": "--runtime-native-package",
  "@threenative/ui": "--ui-package",
  "threenative-engine-mcp": "--engine-mcp-package",
  "create-threenative": "--cli-package",
} as const;

type PackageSourceName = keyof typeof PACKAGE_SOURCE_FLAGS;
type PackageSources = Partial<Record<PackageSourceName, string>> & {
  readonly [packageName: string]: string | undefined;
};

export interface IKitManifest {
  readonly blurb: string;
  readonly genre: string;
  readonly kit: boolean;
  readonly name: ScaffoldTemplate;
  readonly title: string;
}

export interface IScaffoldOptions {
  install?: boolean;
  packageSources?: PackageSources;
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
const SHARED_AGENT_MARKER_LINE = /^<!--\s*(?:shared:\s*[^>]+|\/shared)\s*-->\r?\n?/gmu;
const DEFAULT_TEMPLATE = "starter";

export function templateRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../templates");
}

const LOADING_SOURCE_RELATIVE_PATH = path.join("src", "render", "loading.ts");
const LOADING_APPEARANCE_BLOCK_PATTERN =
  /\/\* BEGIN THREENATIVE LOADING APPEARANCE \*\/[\s\S]*?\/\* END THREENATIVE LOADING APPEARANCE \*\//gu;
export const FULL_LOADING_TEMPLATES = [
  "action-rpg",
  "defense",
  "platformer",
  "racing",
  "shooter",
  "starter",
] as const;

/** The canonical generated loading implementation ships beside, rather than inside, a kit. */
export function canonicalLoadingPath(root = templateRoot()): string {
  const local = path.resolve(root, "..", "template-assets", "loading.ts");
  if (existsSync(local)) return local;
  return path.resolve(templateRoot(), "..", "template-assets", "loading.ts");
}

function loadingAppearanceBlock(source: string, file: string): string {
  const matches = source.match(LOADING_APPEARANCE_BLOCK_PATTERN) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      `TN_LOADING_TEMPLATE_INVALID: ${file}: expected exactly one loading appearance block, found ${matches.length}.`,
    );
  }
  return matches[0];
}

/** Replaces only the declared per-kit appearance block and preserves the canonical implementation. */
export function stampLoadingSource(canonical: string, template: string): string {
  const canonicalBlock = loadingAppearanceBlock(canonical, "canonical loading source");
  const templateBlock = loadingAppearanceBlock(template, "template loading source");
  return canonical.replace(canonicalBlock, templateBlock);
}

/** Re-stamps every tracked full kit from the canonical source, preserving each kit's appearance. */
export async function restampTemplateLoadingCopies(
  root = templateRoot(),
): Promise<readonly string[]> {
  const canonical = await readFile(canonicalLoadingPath(root), "utf8");
  const stamped = [] as string[];
  for (const template of FULL_LOADING_TEMPLATES) {
    const file = path.join(root, template, LOADING_SOURCE_RELATIVE_PATH);
    const source = await readFile(file, "utf8");
    await writeFile(file, stampLoadingSource(canonical, source));
    stamped.push(file);
  }
  return stamped;
}

async function stampTemplateLoading(target: string, template: string, root: string): Promise<void> {
  const sourcePath = path.join(template, LOADING_SOURCE_RELATIVE_PATH);
  if (!existsSync(sourcePath)) return;
  const source = await readFile(sourcePath, "utf8");
  if (!source.includes("BEGIN THREENATIVE LOADING APPEARANCE")) return;
  const canonical = await readFile(canonicalLoadingPath(root), "utf8");
  await writeFile(
    path.join(target, LOADING_SOURCE_RELATIVE_PATH),
    stampLoadingSource(canonical, source),
  );
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

export function scaffoldCompletionMessage(
  manifests: readonly IKitManifest[],
  defaultTemplate = DEFAULT_TEMPLATE,
): string {
  const names = manifests
    .map(({ name }) => (name === defaultTemplate ? `${name} (default)` : name))
    .join(", ");
  return `Templates: ${names}. Choose with --template <name>.\n`;
}

export function cliHelp(): string {
  const manifests = discoverKitManifests();
  return `${[
    "Usage: npx create-threenative <directory> [options]",
    "       npx create-threenative inspect <file.glb> [--json]",
    "",
    "Commands:",
    "  inspect <file>      Report the facts in a glTF asset.",
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
  const entries = await readdir(directory).catch((error: unknown) =>
    (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT" ? [] : undefined,
  );
  if (entries === undefined) return false;
  return entries.length === 0;
}

function substituteTemplateVariables(
  content: string,
  replacements: Readonly<Record<string, string>>,
): string {
  let rendered = content;
  for (const [placeholder, value] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(placeholder, value);
  }
  return rendered;
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
    let rendered = substituteTemplateVariables(content, replacements);
    if (entry.name === "AGENTS.md" || entry.name === "CLAUDE.md") {
      rendered = rendered.replace(SHARED_AGENT_MARKER_LINE, "");
    }
    await writeFile(source, rendered);
  }
}

/** Long recipes live here in the package and ship as `<target>/agent-docs/*.md`. */
const REFERENCE_BUNDLE_DIRECTORY = "agent-docs";
const REFERENCE_FILE_NAME = /^[a-z0-9][a-z0-9-]*\.md$/u;
/** Backticked paths and Markdown links share one prefix so both readers resolve identically. */
const REFERENCE_TOKEN_PATTERN =
  /`agent-docs\/([a-z0-9][a-z0-9./-]*\.md)`|\[[^\]]*\]\(agent-docs\/([^)#]+\.md)\)/gu;

/**
 * Copies the searchable reference pages into the generated project with the same placeholder
 * substitution as source templates. Path-safe by construction: only flat, validated file names
 * are read from the bundle directory and written under `<target>/agent-docs/`.
 */
async function copyReferenceBundle(
  target: string,
  templateRootDirectory: string,
  replacements: Readonly<Record<string, string>>,
): Promise<void> {
  const bundle = path.join(
    path.dirname(templateRootDirectory),
    REFERENCE_BUNDLE_DIRECTORY,
    "references",
  );
  if (!existsSync(bundle)) return;
  const destination = path.join(target, REFERENCE_BUNDLE_DIRECTORY);
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(bundle, { withFileTypes: true })) {
    if (!entry.isFile() || !REFERENCE_FILE_NAME.test(entry.name)) continue;
    const content = substituteTemplateVariables(
      await readFile(path.join(bundle, entry.name), "utf8"),
      replacements,
    );
    const destinationPath = path.join(destination, entry.name);
    if (path.relative(target, destinationPath).startsWith("..")) {
      throw new Error(`Reference page '${entry.name}' resolves outside '${target}'.`);
    }
    await writeFile(destinationPath, content);
  }
}

/** Fails closed: an instruction that names a recipe the project does not ship strands the
 * agent on a link that goes nowhere. Checks both files of the generated pair. */
async function assertReferenceBundle(target: string): Promise<void> {
  for (const file of ["AGENTS.md", "CLAUDE.md"]) {
    const filePath = path.join(target, file);
    if (existsSync(filePath)) await assertReferenceTargets(target, file, filePath);
  }
}

async function assertReferenceTargets(
  target: string,
  from: string,
  filePath: string,
): Promise<void> {
  const content = await readFile(filePath, "utf8");
  for (const match of content.matchAll(REFERENCE_TOKEN_PATTERN)) {
    const referenced = match[1] ?? match[2];
    if (referenced === undefined) continue;
    if (!REFERENCE_FILE_NAME.test(referenced) || referenced.includes("/")) {
      throw new Error(
        `RED observed: referenced recipe missing: '${from}' names '${referenced}', which is not a shipped reference page.`,
      );
    }
    const resolved = path.join(target, REFERENCE_BUNDLE_DIRECTORY, referenced);
    if (!existsSync(resolved)) {
      throw new Error(
        `RED observed: referenced recipe missing: '${from}' links 'agent-docs/${referenced}', which the scaffold did not copy.`,
      );
    }
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
  const localSource = (source: string): string => {
    const filePath = source.startsWith("file:") ? source.slice("file:".length) : source;
    return `file:${path.resolve(filePath)}`;
  };
  for (const [name, source] of Object.entries(packageSources)) {
    if (source === undefined) continue;
    const resolvedSource = localSource(source);
    const isExistingDevDependency = packageJson.devDependencies?.[name] !== undefined;
    if (packageJson.optionalDependencies?.[name] !== undefined) {
      packageJson.optionalDependencies[name] = resolvedSource;
    } else if (
      isExistingDevDependency ||
      name === "@threenative/playtest" ||
      name === "create-threenative" ||
      name === "threenative-engine-mcp"
    ) {
      packageJson.devDependencies ??= {};
      packageJson.devDependencies[name] = resolvedSource;
    } else {
      packageJson.dependencies ??= {};
      packageJson.dependencies[name] = resolvedSource;
    }
    // Every local source also overrides transitive resolution: the packed CLI itself depends
    // on @threenative/assets, which no direct pin in this manifest reaches — and which is not
    // on the registry, so an install without the override 404s.
    packageJson.pnpm ??= {};
    packageJson.pnpm.overrides ??= {};
    packageJson.pnpm.overrides[name] = resolvedSource;
  }
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function copyCapabilityManifest(
  target: string,
  templateRootDirectory: string,
): Promise<void> {
  const source = path.join(path.dirname(templateRootDirectory), "capabilities.json");
  // Fail closed: a scaffold without the manifest looks fine and every generated project
  // silently loses the capability search its AGENTS.md tells the user's agent to run.
  if (!existsSync(source)) {
    throw new Error(
      `TN_KIT_CAPABILITIES_MISSING: '${source}' is not in the package; the generated project needs the capability manifest for its agent tooling.`,
    );
  }
  await cp(source, path.join(target, "capabilities.json"));
}

const FRAMEWORK_PATCH_DIRECTORY = "patches";
const THREE_PATCH_NAME = "three@0.185.1.patch";

async function copyFrameworkPatches(target: string, templateRootDirectory: string): Promise<void> {
  const source = path.join(
    path.dirname(templateRootDirectory),
    "template-assets",
    FRAMEWORK_PATCH_DIRECTORY,
    THREE_PATCH_NAME,
  );
  if (!existsSync(source)) {
    throw new Error(
      `TN_FRAMEWORK_PATCH_MISSING: '${source}' is not in the package; the generated project needs the Three.js velocity patch for batched temporal history.`,
    );
  }
  const destination = path.join(target, FRAMEWORK_PATCH_DIRECTORY, THREE_PATCH_NAME);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination);
}

const NODE_MODULES_PREFIX = "./node_modules/";
// Every server launches through a shim inside `@threenative/core`, the one package a ThreeNative
// project always has as a direct dependency. Pointing straight at `threenative-asset-mcp` only
// works where the package manager hoists, so a project that installed the library without
// scaffolding — or one on pnpm whose lockfile nests differently — silently lost its asset tools.
const REQUIRED_MCP_SERVERS = {
  "threenative-assets": `${NODE_MODULES_PREFIX}@threenative/core/mcp/assets.mjs`,
  "threenative-sculpt": `${NODE_MODULES_PREFIX}@threenative/core/mcp/sculpt.mjs`,
  "threenative-engine": `${NODE_MODULES_PREFIX}@threenative/core/mcp/engine.mjs`,
} as const;

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
  for (const name of Object.keys(REQUIRED_MCP_SERVERS)) {
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
  for (const [name, entry] of Object.entries(REQUIRED_MCP_SERVERS)) {
    if (mcpServers[name]?.args?.[0] !== entry) {
      throw new Error(
        `MCP server '${name}' must launch '${entry}', not '${mcpServers[name]?.args?.[0] ?? "nothing"}'.`,
      );
    }
  }
  const codexPath = path.join(target, ".codex", "config.toml");
  const codex = await readFile(codexPath, "utf8").catch(() => {
    throw new Error(`Scaffold produced no Codex MCP config at '${codexPath}'.`);
  });
  for (const [name, entry] of Object.entries(REQUIRED_MCP_SERVERS)) {
    if (!codex.includes(`[mcp_servers.${name}]`) || !codex.includes(`args = ["${entry}"]`)) {
      throw new Error(`'${codexPath}' does not wire required MCP server '${name}' to '${entry}'.`);
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
  root = templateRoot(),
): Promise<IScaffoldResult> {
  const manifests = discoverKitManifests(root);
  const template = options.template ?? DEFAULT_TEMPLATE;
  if (!manifests.some(({ name }) => name === template)) kitManifest(template, root);
  const target = path.resolve(cwd, options.target);
  const targetExists = await isEmpty(target).catch(() => false);
  if (!targetExists) {
    throw new Error(`Target '${target}' already exists and is not empty.`);
  }

  await mkdir(target, { recursive: true });
  const source = path.join(root, template);
  await cp(source, target, { recursive: true, errorOnExist: true });
  // pnpm pack strips `.gitignore` from published tarballs, so the template carries the asset
  // pipeline's ignore rules under a dotless name and the scaffold installs the real one.
  if (existsSync(path.join(target, "gitignore"))) {
    await rename(path.join(target, "gitignore"), path.join(target, ".gitignore"));
  }
  const projectName = packageName(target);
  const compactProjectId = projectName.toLowerCase().replace(/[^a-z0-9]+/gu, "") || "game";
  const projectId = /^[a-z]/u.test(compactProjectId) ? compactProjectId : `game${compactProjectId}`;
  // Entries rather than an object literal: these are template tokens, not identifiers. Written as
  // property names they read as names the naming rule must judge, and `__PROJECT_NAME__` is
  // neither ours to rename nor expressible in camelCase.
  const replacements = Object.fromEntries([
    ["__PROJECT_NAME__", projectName],
    ["__PROJECT_ID__", projectId],
  ]) as Readonly<Record<string, string>>;
  await stampTemplateLoading(target, source, root);
  await renderTemplate(target, replacements);
  await copyReferenceBundle(target, root, replacements);
  await copyCapabilityManifest(target, root);
  await copyFrameworkPatches(target, root);
  await applyPackageSources(target, options.packageSources);
  await assertMcpConfig(target);
  await assertReferenceBundle(target);

  const installed = options.install ?? true;
  if (installed) await runInstall(target);
  return { installed, target, template };
}

const PACKAGE_SOURCE_FLAG = /^--([a-z0-9-]+)-package$/u;
const SCOPED_PACKAGE_FLAG_PREFIX = "threenative-";

function packageNameFromFlag(flag: string): string | undefined {
  const match = flag.match(PACKAGE_SOURCE_FLAG);
  if (match === null) return undefined;
  const suffix = match[1];
  if (suffix === undefined) return undefined;
  // Legacy aliases are retained for the two existing unscoped workspace packages. Scoped package
  // flags use the namespaced spelling generated from the actual package name, so a scoped package
  // can never overwrite one of those unscoped aliases.
  if (suffix.startsWith(SCOPED_PACKAGE_FLAG_PREFIX)) {
    const scopedSuffix = suffix.slice(SCOPED_PACKAGE_FLAG_PREFIX.length);
    return scopedSuffix.length === 0 ? undefined : `@threenative/${scopedSuffix}`;
  }
  if (suffix === "runtime") return undefined;
  if (suffix === "cli") return "create-threenative";
  if (suffix === "engine-mcp") return "threenative-engine-mcp";
  return `@threenative/${suffix}`;
}

const BOOLEAN_FLAGS = new Set(["--no-install", "--help", "-h"]);
const VALUE_FLAGS = new Set<string>([
  "--template",
  "--runtime-package",
  ...Object.values(PACKAGE_SOURCE_FLAGS),
]);
const SCAFFOLD_USAGE = "Usage: pnpm create threenative my-game";

export function parseArgs(argv: readonly string[]): IScaffoldOptions {
  // A real token walk, not a positional guess: flags may precede the target, and every option
  // must be either known or a named failure — a silently ignored flag is how `--tempalte`
  // scaffolds the wrong template without a word of warning.
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  const targets: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("-")) {
      targets.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const name = equals === -1 ? token : token.slice(0, equals);
    const inlineValue = equals === -1 ? undefined : token.slice(equals + 1);
    if (BOOLEAN_FLAGS.has(name)) {
      if (inlineValue !== undefined)
        throw new Error(`Option '${name}' takes no value. ${SCAFFOLD_USAGE}`);
      booleans.add(name);
      continue;
    }
    if (!VALUE_FLAGS.has(name) && !PACKAGE_SOURCE_FLAG.test(name))
      throw new Error(`Unknown option '${name}'. ${SCAFFOLD_USAGE}`);
    const next = argv[index + 1];
    const value = inlineValue ?? next;
    if (value === undefined || value.length === 0 || value.startsWith("-"))
      throw new Error(`Option '${name}' requires a value. ${SCAFFOLD_USAGE}`);
    values.set(name, value);
    if (inlineValue === undefined) index += 1;
  }
  const target = targets[0];
  if (target === undefined) throw new Error(`Missing target directory. ${SCAFFOLD_USAGE}`);
  if (targets.length > 1)
    throw new Error(`Unexpected extra argument '${targets.at(1)}'. ${SCAFFOLD_USAGE}`);
  const template = values.get("--template") as ScaffoldTemplate | undefined;
  if (template !== undefined) kitManifest(template);
  const packageSources: Record<string, string> = {};
  const knownPackageFlags = new Set<string>(Object.values(PACKAGE_SOURCE_FLAGS));
  for (const [name, flag] of Object.entries(PACKAGE_SOURCE_FLAGS)) {
    const source = values.get(flag);
    if (source !== undefined) packageSources[name] = source;
  }
  for (const [flag, source] of values) {
    if (knownPackageFlags.has(flag)) continue;
    const name = packageNameFromFlag(flag);
    if (name !== undefined) packageSources[name] = source;
  }
  const shortRuntimeSource = values.get("--runtime-package");
  if (shortRuntimeSource !== undefined) {
    packageSources["@threenative/runtime-native"] = shortRuntimeSource;
  }
  return {
    install: !booleans.has("--no-install"),
    target,
    ...(Object.keys(packageSources).length === 0 ? {} : { packageSources }),
    ...(template === undefined ? {} : { template }),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "inspect") {
    if (argv.includes("--help") || argv.includes("-h")) {
      process.stdout.write(inspectHelp());
      return;
    }
    await inspectCommand(argv.slice(1));
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(cliHelp());
    return;
  }
  const result = await createProject(parseArgs(argv));
  process.stdout.write(`Created ${result.template} project at ${result.target}\n`);
  process.stdout.write(scaffoldCompletionMessage(discoverKitManifests()));
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
