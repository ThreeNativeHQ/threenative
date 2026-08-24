import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const ENTITY_LINE_LIMIT = 80;

const BANNED_ENTITY_TOKENS = /\b(?:archetype|createQuery|defineComponent|System|Component)\b/gu;
const CORE_SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const RENDER_EXTENSIONS = new Set([".css", ".js", ".jsx", ".ts", ".tsx"]);

async function filesUnder(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(file)));
    else files.push(file);
  }
  return files;
}

function lineCount(source: string): number {
  return source.length === 0 ? 0 : source.split(/\r?\n/u).length - (source.endsWith("\n") ? 1 : 0);
}

function relative(root: string, file: string): string {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

async function checkEntityRegistry(root: string): Promise<string[]> {
  const file = path.join(root, "packages/core/src/entities.ts");
  const findings: string[] = [];
  if (!existsSync(file)) {
    findings.push(`TN_CORE_ENTITY_FILE_MISSING: ${relative(root, file)}`);
  } else {
    const source = await readFile(file, "utf8");
    const lines = lineCount(source);
    if (lines >= ENTITY_LINE_LIMIT) {
      findings.push(
        `${relative(root, file)} has ${lines} lines; the entity registry must stay fewer than ${ENTITY_LINE_LIMIT} lines`,
      );
    }
  }
  for (const sourceFile of await filesUnder(path.join(root, "packages/core/src"))) {
    if (!CORE_SOURCE_EXTENSIONS.has(path.extname(sourceFile))) continue;
    const source = await readFile(sourceFile, "utf8");
    for (const [lineIndex, sourceLine] of source.split(/\r?\n/u).entries()) {
      for (const match of sourceLine.matchAll(BANNED_ENTITY_TOKENS)) {
        findings.push(
          `${relative(root, sourceFile)}:${lineIndex + 1} uses banned entity-registry token '${match[0]}'`,
        );
      }
    }
  }
  return findings;
}

async function checkScaffoldHygiene(root: string): Promise<string[]> {
  const templateRoot = path.join(root, "packages/create-threenative/templates");
  if (!existsSync(templateRoot)) return [];
  const findings: string[] = [];
  const templates = (await readdir(templateRoot, { withFileTypes: true })).filter((entry) =>
    entry.isDirectory(),
  );
  for (const template of templates) {
    const templateRootPath = path.join(templateRoot, template.name);
    const manifest = path.join(templateRootPath, "package.json");
    if (existsSync(manifest) && (await readFile(manifest, "utf8")).includes("catalog:")) {
      findings.push(
        `${relative(root, manifest)} contains catalog:; generated manifests need real versions`,
      );
    }
    const renderRoot = path.join(templateRootPath, "src/render");
    for (const file of await filesUnder(renderRoot)) {
      if (!RENDER_EXTENSIONS.has(path.extname(file))) continue;
      const source = await readFile(file, "utf8");
      if (source.includes("@threenative/")) {
        findings.push(
          `${relative(root, file)} imports @threenative/; render source must stay portable`,
        );
      }
    }
    if (template.name !== "starter") continue;
    const lighting = path.join(renderRoot, "lighting.ts");
    if (!existsSync(lighting))
      findings.push(`${relative(root, lighting)} is required by scaffold hygiene`);
  }
  return findings;
}

async function checkBuiltScaffold(root: string): Promise<string[]> {
  const directory = path.join(root, "examples/abyss-framework/dist");
  if (!existsSync(directory)) return [];
  const findings: string[] = [];
  for (const file of await filesUnder(directory)) {
    const source = await readFile(file, "utf8");
    if (/DebugOverlay|__THREENATIVE__/u.test(source)) {
      findings.push(`${relative(root, file)} contains DebugOverlay or __THREENATIVE__`);
    }
  }
  return findings;
}

export async function checkCoreBoundary(root = process.cwd()): Promise<readonly string[]> {
  return [
    ...(await checkEntityRegistry(root)),
    ...(await checkScaffoldHygiene(root)),
    ...(await checkBuiltScaffold(root)),
  ];
}

async function main(): Promise<void> {
  const findings = await checkCoreBoundary();
  if (findings.length > 0) {
    console.error(
      `TN_CORE_BOUNDARY_FAILED:\n${findings.map((finding) => `- ${finding}`).join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log("core boundary and scaffold hygiene passed");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
