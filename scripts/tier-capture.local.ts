/**
 * PRD-304 evidence, run by hand and not part of any gate.
 *
 * Scaffolds the starter, captures it twice at its default tier — that pair is the same-code noise
 * band, because these captures are not bit-deterministic — then forces `tier: "low"` in the scene
 * and captures a third time. Prints the `TN_QUALITY_TIER` line each run reported, the adapter that
 * drew it, and how far apart the frames are.
 *
 *   sh scripts/xvfb.sh pnpm exec tsx scripts/tier-capture.local.ts <output-directory>
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import { createProject } from "../packages/create-threenative/src/index.js";
import { inspectFrame } from "../packages/playtest/src/capture.js";
import { packageLocalFramework, stopVisualServer } from "./visual-gate.js";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const WEBGPU_BROWSER_ARGS = [
  "--enable-unsafe-webgpu",
  "--enable-features=Vulkan",
  "--use-angle=vulkan",
  "--use-vulkan=native",
  "--disable-vulkan-fallback-to-gl-for-testing",
];

async function runCommand(command: string, args: readonly string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code ?? "?"}`)),
    );
  });
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`server never answered at ${url}`);
}

interface ICapture {
  readonly adapter: string;
  readonly content: Buffer;
  readonly tierLine: string;
}

async function capture(projectDir: string, port: number): Promise<ICapture> {
  const server = spawn(
    "pnpm",
    ["dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: projectDir, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await waitForServer(`http://127.0.0.1:${port}/`);
    const browser = await chromium.launch({ args: WEBGPU_BROWSER_ARGS, headless: false });
    try {
      const page = await browser.newPage({ viewport: { height: 720, width: 1280 } });
      const lines: string[] = [];
      page.on("console", (message) => lines.push(message.text()));
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("canvas", { timeout: 60_000 });
      await page.waitForTimeout(8_000);
      const adapter = await page.evaluate(async () => {
        const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
        if (gpu === undefined) return "no navigator.gpu";
        const handle = (await gpu.requestAdapter()) as { info?: Record<string, unknown> } | null;
        return JSON.stringify(handle?.info ?? {});
      });
      return {
        adapter,
        content: await page.screenshot({ type: "png" }),
        tierLine: lines.find((line) => line.includes("TN_QUALITY_TIER")) ?? "(none reported)",
      };
    } finally {
      await browser.close();
    }
  } finally {
    await stopVisualServer(server);
  }
}

/** Fraction of pixels whose 8-bit channels differ at all, and the mean absolute difference. */
function compare(a: Buffer, b: Buffer): string {
  const left = PNG.sync.read(a);
  const right = PNG.sync.read(b);
  if (left.width !== right.width || left.height !== right.height) return "different sizes";
  let moved = 0;
  let total = 0;
  for (let offset = 0; offset < left.data.length; offset += 4) {
    let delta = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      delta += Math.abs((left.data[offset + channel] ?? 0) - (right.data[offset + channel] ?? 0));
    }
    if (delta > 0) moved += 1;
    total += delta / 3;
  }
  const pixels = left.data.length / 4;
  return `${((moved / pixels) * 100).toFixed(3)}% of ${pixels} pixels moved; mean |Δ| ${(total / pixels).toFixed(3)}/255`;
}

function describe(label: string, shot: ICapture): void {
  const stats = inspectFrame(shot.content);
  console.log(
    `${label.padEnd(16)} ${shot.tierLine}\n${" ".repeat(17)}distinctColors=${stats.distinctColors} brightPixelRatio=${stats.brightPixelRatio.toFixed(4)} luminanceStdDev=${stats.luminanceStdDev.toFixed(4)} maxLuminance=${stats.maxLuminance.toFixed(4)}\n${" ".repeat(17)}adapter=${shot.adapter}`,
  );
}

async function main(): Promise<void> {
  const outDir = path.resolve(process.argv[2] ?? path.join(REPO_ROOT, "artifacts", "prd-304"));
  await mkdir(outDir, { recursive: true });
  const root = await mkdtemp(path.join(os.tmpdir(), "prd304-tier-"));
  const packages = await packageLocalFramework(REPO_ROOT);
  const project = await createProject(
    { install: true, packageSources: packages, target: "starter", template: "starter" },
    root,
  );
  await runCommand("pnpm", ["build"], project.target);

  const defaultA = await capture(project.target, 5411);
  await writeFile(path.join(outDir, "starter-tier-default-a.png"), defaultA.content);
  const defaultB = await capture(project.target, 5412);
  await writeFile(path.join(outDir, "starter-tier-default-b.png"), defaultB.content);

  const scene = path.join(project.target, "src", "scenes", "Play.ts");
  const source = await readFile(scene, "utf8");
  const patched = source.replace("mobile: isMobile(),", 'mobile: isMobile(),\n      tier: "low",');
  if (patched === source) throw new Error("could not patch the scene's setupPost call");
  await writeFile(scene, patched);
  await runCommand("pnpm", ["build"], project.target);
  const low = await capture(project.target, 5413);
  await writeFile(path.join(outDir, "starter-tier-low.png"), low.content);

  console.log("\n=== PRD-304: the starter at its default tier, twice, then forced to low ===");
  describe("default (a)", defaultA);
  describe("default (b)", defaultB);
  describe('tier: "low"', low);
  console.log(
    `\nsame-code noise band (default a vs default b): ${compare(defaultA.content, defaultB.content)}`,
  );
  console.log(
    `the switch     (default a vs tier low):        ${compare(defaultA.content, low.content)}`,
  );
  console.log(`\ncaptures in ${outDir}`);
}

await main();
