import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { type ScaffoldTemplate, createProject } from "../packages/create-threenative/src/index.js";
import { type CaptureFrameStats, assertFrameShowsSomething } from "./capture-guard.js";
import {
  type ImageScoringArtifact,
  createImageBlindBundle,
  hashPromptFile,
} from "./score-blind.js";

export const TEMPLATE_NAMES = [
  "minimal",
  "starter",
  "platformer",
] as const satisfies readonly ScaffoldTemplate[];
export const RENDER_LAYER_FILES = [
  "palette.ts",
  "camera.ts",
  "sky.ts",
  "lighting.ts",
  "materials.ts",
  "postprocessing.ts",
] as const;
export const VISUAL_SCORE_FLOOR = 4;
export const LOCAL_FRAMEWORK_PACKAGES = [
  ["@threenative/playtest", "threenative-playtest-"],
  ["@threenative/core", "threenative-core-"],
  ["@threenative/physics", "threenative-physics-"],
  ["@threenative/runtime-native", "threenative-runtime-native-"],
  ["@threenative/ui", "threenative-ui-"],
  ["create-threenative", "create-threenative-"],
] as const;

export function visualServerProcessGroup(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): number {
  return platform === "win32" ? pid : -pid;
}

function stopVisualServer(server: ChildProcess): void {
  if (server.pid === undefined || server.exitCode !== null) return;
  try {
    process.kill(visualServerProcessGroup(server.pid), "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

export interface TemplateStructureResult {
  readonly errors: readonly string[];
  readonly files: readonly string[];
  readonly template: ScaffoldTemplate;
}

export interface VisualScoreFile {
  readonly parity: { readonly framework: number; readonly vanilla: number };
  readonly templates: Record<ScaffoldTemplate, number>;
}

export interface VisualCaptureResult {
  readonly stats: CaptureFrameStats;
  readonly template: ScaffoldTemplate;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_ROOT = path.join(REPO_ROOT, "packages/create-threenative/templates");
const VISUAL_ROOT = path.join(REPO_ROOT, "docs/verification/visuals");
const BASELINE = path.join(REPO_ROOT, "docs/product/VISUAL-BASELINE.md");

function sourceFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [file] : [];
  });
}

function requiredImport(source: string, stem: string): boolean {
  return new RegExp(`(?:from|import\\s*\\()\\s*["'][^"']*${stem}\\.js["']`, "u").test(source);
}

function paletteKeys(source: string): string[] | undefined {
  const body = source.match(/export\s+const\s+palette\s*=\s*\{([\s\S]*?)\}\s+as\s+const/u)?.[1];
  if (body === undefined) return undefined;
  return [...body.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:/gmu)].map((match) => match[1] ?? "");
}

export function inspectTemplate(
  template: ScaffoldTemplate,
  root = TEMPLATE_ROOT,
): TemplateStructureResult {
  const templateRoot = path.join(root, template, "src");
  const renderRoot = path.join(templateRoot, "render");
  const errors: string[] = [];
  const files = existsSync(renderRoot)
    ? readdirSync(renderRoot).filter((file) => file.endsWith(".ts"))
    : [];
  const sources = existsSync(templateRoot)
    ? sourceFiles(templateRoot).map((file) => ({ file, source: readFileSync(file, "utf8") }))
    : [];

  for (const file of RENDER_LAYER_FILES) {
    const filePath = path.join(renderRoot, file);
    if (!existsSync(filePath)) errors.push(`${template}: missing src/render/${file}`);
    const stem = file.slice(0, -3);
    if (
      !sources.some(
        ({ file: sourceFile, source }) => sourceFile !== filePath && requiredImport(source, stem),
      )
    )
      errors.push(`${template}: src/render/${file} has no live importer`);
  }

  const palette = existsSync(path.join(renderRoot, "palette.ts"))
    ? readFileSync(path.join(renderRoot, "palette.ts"), "utf8")
    : "";
  const keys = paletteKeys(palette);
  if (keys === undefined) errors.push(`${template}: palette.ts must export a palette object`);
  else {
    if (keys.length > 6)
      errors.push(`${template}: palette has ${keys.length} named colours; maximum is 6`);
    if (keys.filter((key) => key === "accent").length !== 1)
      errors.push(`${template}: palette must contain exactly one accent role`);
  }

  const readRender = (file: string): string => {
    const filePath = path.join(renderRoot, file);
    return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  };
  const materials = readRender("materials.ts");
  const sky = readRender("sky.ts");
  const lighting = readRender("lighting.ts");
  const post = readRender("postprocessing.ts");
  if (!/from ["']\.\/palette\.js["']/u.test(materials))
    errors.push(`${template}: materials.ts must import palette.ts`);
  if (!/from ["']\.\/palette\.js["']/u.test(sky))
    errors.push(`${template}: sky.ts must import palette.ts`);
  if ((lighting.match(/new DirectionalLight/g) ?? []).length < 2)
    errors.push(`${template}: lighting.ts needs a key and rim DirectionalLight`);
  if (!/new (?:HemisphereLight|AmbientLight)/u.test(lighting))
    errors.push(`${template}: lighting.ts needs a fill or ambient light`);
  for (const marker of ["PCFSoftShadowMap", "normalBias"]) {
    if (!lighting.includes(marker)) errors.push(`${template}: lighting.ts is missing ${marker}`);
  }
  for (const marker of ["toneMapping", "toneMappingExposure", "setOutputNode", "bloom("]) {
    if (!post.includes(marker)) errors.push(`${template}: postprocessing.ts is missing ${marker}`);
  }

  return { errors, files, template };
}

export function inspectAllTemplates(root = TEMPLATE_ROOT): readonly TemplateStructureResult[] {
  return TEMPLATE_NAMES.map((template) => inspectTemplate(template, root));
}

function score(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5)
    throw new Error(`TN_VISUAL_SCORE_INVALID: ${label} must be an integer from 1 to 5.`);
  return value;
}

export function validateVisualScores(value: unknown): VisualScoreFile {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("TN_VISUAL_SCORE_INVALID: expected a score object.");
  const record = value as Record<string, unknown>;
  const templateRecord = record.templates;
  const parity = record.parity;
  if (
    typeof templateRecord !== "object" ||
    templateRecord === null ||
    Array.isArray(templateRecord)
  )
    throw new Error("TN_VISUAL_SCORE_INVALID: templates scores are required.");
  if (typeof parity !== "object" || parity === null || Array.isArray(parity))
    throw new Error("TN_VISUAL_SCORE_INVALID: parity scores are required.");
  const templates = Object.fromEntries(
    TEMPLATE_NAMES.map((template) => [
      template,
      score((templateRecord as Record<string, unknown>)[template], template),
    ]),
  ) as Record<ScaffoldTemplate, number>;
  const parityRecord = parity as Record<string, unknown>;
  const result: VisualScoreFile = {
    parity: {
      framework: score(parityRecord.framework, "parity.framework"),
      vanilla: score(parityRecord.vanilla, "parity.vanilla"),
    },
    templates,
  };
  for (const [label, valueToCheck] of Object.entries({ ...templates, ...result.parity })) {
    if (valueToCheck < VISUAL_SCORE_FLOOR)
      throw new Error(
        `TN_VISUAL_SCORE_FLOOR: ${label} scored ${valueToCheck}; floor is ${VISUAL_SCORE_FLOOR}.`,
      );
  }
  return result;
}

function argumentValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function runCommand(command: string, args: readonly string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const output: string[] = [];
    child.stdout?.on("data", (chunk) => output.push(String(chunk)));
    child.stderr?.on("data", (chunk) => output.push(String(chunk)));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${command} ${args.join(" ")} exited ${code ?? "unknown"}.\n${output.join("").slice(-4_000)}`,
          ),
        );
    });
  });
}

async function waitForServer(
  url: string,
  server: ChildProcess,
  timeoutMs = 120_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (server.exitCode !== null)
      throw new Error(`Visual server exited with code ${server.exitCode}.`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Visual server did not become ready within ${timeoutMs}ms.`);
}

export async function packageLocalFramework(root: string): Promise<Record<string, string>> {
  const packageRoot = path.join(root, "packages");
  await mkdir(packageRoot, { recursive: true });
  const packages = LOCAL_FRAMEWORK_PACKAGES;
  const archives = new Map<string, string>();
  for (const [name] of packages) {
    await runCommand("pnpm", ["--filter", name, "build"], REPO_ROOT);
    await runCommand(
      "pnpm",
      ["--filter", name, "pack", "--pack-destination", packageRoot],
      REPO_ROOT,
    );
  }
  for (const file of await readdir(packageRoot)) {
    if (!file.endsWith(".tgz")) continue;
    const key = packages.find(([, prefix]) => file.startsWith(prefix))?.[0];
    if (key !== undefined) archives.set(key, path.join(packageRoot, file));
  }
  if (archives.size !== packages.length)
    throw new Error("TN_VISUAL_PACKAGES_MISSING: local package archives were not created.");
  return Object.fromEntries(archives);
}

async function captureTemplate(
  template: ScaffoldTemplate,
  root: string,
  packageSources: Record<string, string>,
  port: number,
): Promise<{ content: Buffer; stats: CaptureFrameStats }> {
  const result = await createProject(
    {
      install: true,
      packageSources,
      target: template,
      template,
    },
    root,
  );
  await runCommand("pnpm", ["build"], result.target);
  const server = spawn(
    "pnpm",
    ["dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: result.target,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const output: string[] = [];
  server.stdout?.on("data", (chunk) => output.push(String(chunk)));
  server.stderr?.on("data", (chunk) => output.push(String(chunk)));
  try {
    await waitForServer(`http://127.0.0.1:${port}/`, server);
    const browser = await chromium.launch({
      args: [
        "--ozone-platform=x11",
        "--enable-unsafe-webgpu",
        "--disable-gpu-sandbox",
        "--ignore-gpu-blocklist",
      ],
      headless: false,
      timeout: 30_000,
    });
    try {
      const page = await browser.newPage({ viewport: { height: 720, width: 1280 } });
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("canvas", { timeout: 30_000 });
      await page.waitForTimeout(2_000);
      if (pageErrors.length > 0) throw new Error(`TN_VISUAL_PAGE_ERROR: ${pageErrors.join(" | ")}`);
      const content = await page.screenshot({ type: "png" });
      const stats = assertFrameShowsSomething(content, template);
      return { content, stats };
    } finally {
      await browser.close();
    }
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${output.join("").slice(-4_000)}`,
    );
  } finally {
    stopVisualServer(server);
  }
}

async function captureAllTemplates(
  root: string,
  packages: Record<string, string>,
): Promise<readonly VisualCaptureResult[]> {
  const results: VisualCaptureResult[] = [];
  for (const [index, template] of TEMPLATE_NAMES.entries()) {
    const packageSources = Object.fromEntries(
      Object.entries(packages).filter(
        ([name]) => name !== "@threenative/ui" || template !== "minimal",
      ),
    );
    const capture = await captureTemplate(template, root, packageSources, 5300 + index);
    await mkdir(VISUAL_ROOT, { recursive: true });
    await writeFile(path.join(VISUAL_ROOT, `${template}.png`), capture.content);
    results.push({ stats: capture.stats, template });
  }
  return results;
}

async function buildAllTemplates(root: string, packages: Record<string, string>): Promise<void> {
  for (const template of TEMPLATE_NAMES) {
    const packageSources = Object.fromEntries(
      Object.entries(packages).filter(
        ([name]) => name !== "@threenative/ui" || template !== "minimal",
      ),
    );
    const result = await createProject(
      {
        install: true,
        packageSources,
        target: template,
        template,
      },
      root,
    );
    await runCommand("pnpm", ["build"], result.target);
    console.log(`${template}: scaffold build passed.`);
  }
}

function createParityBundle(framework: string, vanilla: string): void {
  const bundle = path.join(VISUAL_ROOT, "parity-blind");
  const reveal = path.join(VISUAL_ROOT, "parity-reveal.json");
  const artifacts: ImageScoringArtifact[] = [
    { arm: "framework", content: readFileSync(framework), id: "framework-reference" },
    { arm: "vanilla", content: readFileSync(vanilla), id: "vanilla-reference" },
  ];
  createImageBlindBundle(hashPromptFile(BASELINE), artifacts, bundle, reveal);
}

export async function runVisualGate(
  args: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const structures = inspectAllTemplates();
  const structuralErrors = structures.flatMap(({ errors }) => errors);
  if (structuralErrors.length > 0)
    throw new Error(`TN_VISUAL_STRUCTURE_FAILED:\n${structuralErrors.join("\n")}`);
  console.log(`Visual structure passed for ${TEMPLATE_NAMES.join(", ")}.`);
  if (args.includes("--structural-only")) return;

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "threenative-visuals-"));
  try {
    const packages = await packageLocalFramework(temporaryRoot);
    if (args.includes("--build-only")) {
      await buildAllTemplates(temporaryRoot, packages);
      return;
    }
    const captures = await captureAllTemplates(temporaryRoot, packages);
    for (const capture of captures)
      console.log(`${capture.template}: ${JSON.stringify(capture.stats)}`);

    const framework =
      argumentValue(args, "--framework-frame") ?? path.join(VISUAL_ROOT, "parity-framework.png");
    const vanilla =
      argumentValue(args, "--vanilla-frame") ?? path.join(VISUAL_ROOT, "parity-vanilla.png");
    if (!existsSync(framework) || !existsSync(vanilla))
      throw new Error(
        "TN_VISUAL_PARITY_UNVERIFIED: supply --framework-frame and --vanilla-frame for a blind pair.",
      );
    createParityBundle(framework, vanilla);

    const scorePath = argumentValue(args, "--scores") ?? path.join(VISUAL_ROOT, "scores.json");
    if (!existsSync(scorePath))
      throw new Error(
        `TN_VISUAL_SCORE_UNVERIFIED: human Visuals scores are required at ${scorePath}.`,
      );
    const scores = validateVisualScores(JSON.parse(await readFile(scorePath, "utf8")) as unknown);
    if (scores.parity.framework < scores.parity.vanilla)
      throw new Error(
        `TN_VISUAL_PARITY_LOSS: framework ${scores.parity.framework} < vanilla ${scores.parity.vanilla}.`,
      );
    console.log(
      `Visual scores passed at floor ${VISUAL_SCORE_FLOOR}; framework parity is not below vanilla.`,
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runVisualGate().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
