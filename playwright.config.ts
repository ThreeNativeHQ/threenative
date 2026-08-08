import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, defineConfig } from "@playwright/test";
import { PNG } from "pngjs";
import { createProject } from "./packages/create-threenative/src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const starterLookServer = process.argv.includes("--starter-look-server");
const starterLookGatePort = 4176;
const starterLookReadyPort = 4175;
const hotReloadPort = 4177;
const replayPort = 4178;
const localPackages = ["core", "physics", "playtest", "ui"] as const;
// The scaffolded projects install from tarballs, not from `packages/*` directly: a source
// directory still carries `catalog:` specifiers, which only resolve inside this workspace.
// `pnpm pack` rewrites them, which is the same thing CI's scaffold smoke does.
const localPackageSources = await packLocalPackages();

async function packLocalPackages(): Promise<Record<string, string>> {
  const existing = process.env.THREENATIVE_PACKED_PACKAGES;
  const staging = existing ?? (await mkdtemp(path.join(tmpdir(), "threenative-packed-")));
  if (existing === undefined) {
    await run("pnpm", ["-r", "--workspace-concurrency=1", "--if-present", "run", "build"]);
    for (const name of localPackages)
      await run("pnpm", [
        "--filter",
        `./packages/${name}`,
        "exec",
        "pnpm",
        "pack",
        "--pack-destination",
        staging,
      ]);
    process.env.THREENATIVE_PACKED_PACKAGES = staging;
  }
  const files = await readdir(staging);
  const sources: Record<string, string> = {};
  for (const name of localPackages) {
    const tarball = files.find((file) => file.startsWith(`threenative-${name}-`));
    if (tarball === undefined) throw new Error(`pnpm pack produced no tarball for ${name}.`);
    sources[`@threenative/${name}`] = path.join(staging, tarball);
  }
  return sources;
}

async function run(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { cwd: repoRoot, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}.`)),
    );
  });
}

if (starterLookServer) await runStarterLookServer();
const hotReloadProject = starterLookServer ? undefined : await prepareHotReloadProject();
if (hotReloadProject !== undefined) process.env.THREENATIVE_HOT_RELOAD_PROJECT = hotReloadProject;

async function prepareHotReloadProject(): Promise<string> {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "threenative-hot-reload-"));
  const target = path.join(temporaryRoot, "starter");
  await createProject(
    { install: true, packageSources: localPackageSources, target, template: "starter" },
    repoRoot,
  );
  return target;
}

async function runStarterLookServer(): Promise<void> {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "threenative-starter-look-"));
  const target = path.join(temporaryRoot, "starter");
  const artifacts = path.join(temporaryRoot, "artifacts");
  await createProject(
    { install: true, packageSources: localPackageSources, target, template: "starter" },
    repoRoot,
  );

  const server = startStarterServer(target, starterLookGatePort);
  const serverOutput: string[] = [];
  server.stdout?.on("data", (chunk) => serverOutput.push(String(chunk)));
  server.stderr?.on("data", (chunk) => serverOutput.push(String(chunk)));
  let exposedServer: ChildProcess | undefined;

  try {
    await waitForUrl(`http://127.0.0.1:${starterLookGatePort}/`, server, 120_000);
    await runStarterLookScenario(artifacts, starterLookGatePort);
    await measureFrameCost(starterLookGatePort);
    exposedServer = startStarterServer(target, starterLookReadyPort);
    exposedServer.stdout?.on("data", (chunk) => serverOutput.push(String(chunk)));
    exposedServer.stderr?.on("data", (chunk) => serverOutput.push(String(chunk)));
    await waitForUrl(`http://127.0.0.1:${starterLookReadyPort}/`, exposedServer, 120_000);
    await keepServerAlive(exposedServer);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${serverOutput.join("").slice(-4_000)}`,
    );
  } finally {
    exposedServer?.kill();
    server.kill();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function startStarterServer(target: string, port: number): ChildProcess {
  return spawn(
    "pnpm",
    ["--dir", target, "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: repoRoot,
      env: { ...process.env, CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING ?? "true" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function waitForUrl(url: string, server: ChildProcess, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (server.exitCode !== null)
      throw new Error(`Starter server exited with code ${server.exitCode}.`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Vite has not started listening yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Starter server did not become ready within ${timeoutMs}ms.`);
}

async function runStarterLookScenario(artifacts: string, port: number): Promise<void> {
  const runner = spawn(
    process.execPath,
    [
      path.join(repoRoot, "packages/playtest/dist/runner/cli.js"),
      path.join(repoRoot, "playtests/starter-look.playtest.json"),
      "--project",
      repoRoot,
      "--url",
      `http://127.0.0.1:${port}/`,
      "--artifacts",
      artifacts,
      "--browser-arg",
      "--disable-gpu-sandbox",
      "--browser-arg",
      "--ignore-gpu-blocklist",
    ],
    { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  const stdout: string[] = [];
  const stderr: string[] = [];
  runner.stdout?.on("data", (chunk) => stdout.push(String(chunk)));
  runner.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
  const exitCode = await new Promise<number>((resolveExit) =>
    runner.once("close", (code) => resolveExit(code ?? 2)),
  );
  if (exitCode !== 0) {
    throw new Error(
      `Starter look scenario exited with code ${exitCode}: ${stderr.join("")}${stdout.join("")}`,
    );
  }
  const report = JSON.parse(stdout.join("")) as { pass?: boolean };
  if (report.pass !== true)
    throw new Error(`Starter look scenario reported failure: ${stdout.join("")}`);
  await assertStarterScreenshot(path.join(artifacts, "starter-look.png"));
}

async function assertStarterScreenshot(file: string): Promise<void> {
  const image = PNG.sync.read(await readFile(file));
  if (image.width !== 1280 || image.height !== 720) {
    throw new Error(
      `Starter look screenshot must be 1280x720, got ${image.width}x${image.height}.`,
    );
  }
  const stage = { bottom: 660, left: 220, right: 1060, top: 160 };
  const pixels = stagePixels(image, stage);
  const warm = findColorBounds(
    image,
    stage,
    (red, green, blue) => red > 130 && red > blue * 1.35 && green > blue * 1.15,
  );
  const cool = countPixels(
    image,
    stage,
    (red, green, blue) => red < 110 && green > 90 && blue > 130 && blue > red * 1.35,
  );
  const luminance =
    pixels.reduce((sum, [red, green, blue]) => sum + pixelLuminance(red, green, blue), 0) /
    pixels.length;
  if (luminance < 0.02)
    throw new Error(
      `Starter look reference failed: stage luminance ${luminance.toFixed(4)} is black.`,
    );
  if (warm.count < pixels.length * 0.0005)
    throw new Error(`Starter look reference failed: warm crate pixels ${warm.count} are missing.`);
  if (cool < pixels.length * 0.0005)
    throw new Error(`Starter look reference failed: cool player pixels ${cool} are missing.`);
  if (warm.bounds === undefined)
    throw new Error("Starter look reference failed: crate bounds are unavailable.");
  const contact = contactShadowCoverage(image, warm.bounds);
  if (contact < 0.02)
    throw new Error(
      `Starter look reference failed: contact-shadow coverage ${contact.toFixed(4)} is too low.`,
    );
}

function stagePixels(
  image: PNG,
  stage: { bottom: number; left: number; right: number; top: number },
): [number, number, number][] {
  const pixels: [number, number, number][] = [];
  for (let y = stage.top; y < stage.bottom; y += 1) {
    for (let x = stage.left; x < stage.right; x += 1) pixels.push(readPixel(image, x, y));
  }
  return pixels;
}

function countPixels(
  image: PNG,
  stage: { bottom: number; left: number; right: number; top: number },
  matches: (r: number, g: number, b: number) => boolean,
): number {
  let count = 0;
  for (let y = stage.top; y < stage.bottom; y += 1) {
    for (let x = stage.left; x < stage.right; x += 1) {
      const [red, green, blue] = readPixel(image, x, y);
      if (matches(red, green, blue)) count += 1;
    }
  }
  return count;
}

function findColorBounds(
  image: PNG,
  stage: { bottom: number; left: number; right: number; top: number },
  matches: (r: number, g: number, b: number) => boolean,
) {
  let count = 0;
  let left = image.width;
  let top = image.height;
  let right = 0;
  let bottom = 0;
  for (let y = stage.top; y < stage.bottom; y += 1) {
    for (let x = stage.left; x < stage.right; x += 1) {
      const [red, green, blue] = readPixel(image, x, y);
      if (!matches(red, green, blue)) continue;
      count += 1;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return { bounds: count === 0 ? undefined : { bottom, left, right, top }, count };
}

function contactShadowCoverage(
  image: PNG,
  bounds: { bottom: number; left: number; right: number; top: number },
): number {
  let dark = 0;
  let floor = 0;
  for (let y = bounds.bottom + 1; y <= Math.min(image.height - 1, bounds.bottom + 36); y += 1) {
    for (
      let x = Math.max(0, bounds.left - 220);
      x <= Math.min(image.width - 1, bounds.right + 20);
      x += 1
    ) {
      if (pixelLuminance(...readPixel(image, x, y)) < 0.1) dark += 1;
      floor += 1;
    }
  }
  return dark / Math.max(1, floor);
}

function readPixel(image: PNG, x: number, y: number): [number, number, number] {
  const index = (y * image.width + x) * 4;
  return [image.data[index] ?? 0, image.data[index + 1] ?? 0, image.data[index + 2] ?? 0];
}

function pixelLuminance(red: number, green: number, blue: number): number {
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

async function measureFrameCost(port: number): Promise<void> {
  const browser = await chromium.launch({
    args: ["--disable-gpu-sandbox", "--ignore-gpu-blocklist"],
  });
  try {
    const page = await browser.newPage({ viewport: { height: 720, width: 1280 } });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("canvas");
    const result = (await page.evaluate(
      `new Promise((resolve) => {
        const start = performance.now();
        let frames = 0;
        function next() {
          frames += 1;
          if (frames === 120) resolve({ elapsedMs: performance.now() - start, frames });
          else requestAnimationFrame(next);
        }
        requestAnimationFrame(next);
      })`,
    )) as { elapsedMs: number; frames: number };
    const msPerFrame = result.elapsedMs / result.frames;
    if (!Number.isFinite(msPerFrame) || msPerFrame <= 0)
      throw new Error("Frame-cost measurement was not finite.");
    process.stdout.write(
      `starter-look frame cost: ${msPerFrame.toFixed(3)} ms/frame over ${result.frames} frames\n`,
    );
  } finally {
    await browser.close();
  }
}

async function keepServerAlive(server: ChildProcess): Promise<void> {
  await new Promise<void>((resolveHold, rejectHold) => {
    const stop = () => {
      server.kill();
      resolveHold();
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    server.once("exit", (code) =>
      rejectHold(
        new Error(`Starter server exited after the gate passed with code ${code ?? "unknown"}.`),
      ),
    );
  });
}

export default defineConfig({
  testDir: "./examples/abyss-vanilla/__tests__",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    screenshot: "only-on-failure",
    launchOptions: {
      args: ["--enable-unsafe-webgpu", "--disable-gpu-sandbox", "--ignore-gpu-blocklist"],
    },
  },
  webServer: [
    {
      command: "pnpm --filter abyss-vanilla dev --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173",
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: "node --import tsx playwright.config.ts --starter-look-server",
      url: "http://127.0.0.1:4175",
      timeout: 120_000,
      reuseExistingServer: false,
    },
    ...(hotReloadProject === undefined
      ? []
      : [
          {
            command: `pnpm --dir ${hotReloadProject} dev --host 127.0.0.1 --port ${hotReloadPort} --strictPort`,
            url: `http://127.0.0.1:${hotReloadPort}`,
            timeout: 120_000,
            reuseExistingServer: false,
          },
        ]),
    {
      command: "pnpm --filter abyss-framework dev --host 127.0.0.1 --port 4178 --strictPort",
      url: `http://127.0.0.1:${replayPort}`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: "abyss-vanilla",
      testDir: "./examples/abyss-vanilla/__tests__",
    },
    {
      name: "hot-reload",
      testDir: "./tests/browser",
      use: { baseURL: `http://127.0.0.1:${hotReloadPort}` },
    },
    {
      name: "abyss-framework-replay",
      testDir: "./tests/browser-replay",
      use: { baseURL: `http://127.0.0.1:${replayPort}` },
    },
  ],
});
