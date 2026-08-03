#!/usr/bin/env node
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ScaffoldTemplate = "minimal" | "starter";

export interface ScaffoldOptions {
  install?: boolean;
  packageSources?: Partial<
    Record<"@threenative/core" | "@threenative/physics" | "@threenative/ui", string>
  >;
  target: string;
  template?: ScaffoldTemplate;
}

export interface ScaffoldResult {
  installed: boolean;
  target: string;
  template: ScaffoldTemplate;
}

const TEMPLATE_NAMES: readonly ScaffoldTemplate[] = ["minimal", "starter"];

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
  };
  for (const [name, source] of Object.entries(packageSources)) {
    if (source === undefined) continue;
    packageJson.dependencies ??= {};
    packageJson.dependencies[name] = source.startsWith("file:") ? source : `file:${source}`;
  }
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
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
    throw new Error(`Unknown template '${template}'. Choose minimal or starter.`);
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
    throw new Error(`Unknown template '${template}'. Choose minimal or starter.`);
  }
  const packageSources: Record<string, string> = {};
  for (const [name, flag] of [
    ["@threenative/core", "--core-package"],
    ["@threenative/physics", "--physics-package"],
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
