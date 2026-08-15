import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createProject } from "../packages/create-threenative/src/index.js";
import { packageLocalFramework } from "./visual-gate.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PORT = 5310;
const SLOW_FRAME_MS = 1_000 / 60;

export type StarterProfileVariant = "baseline" | "no-sculpture";

export interface FrameSummary {
  readonly frames: number;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly slowFrames: number;
}

interface ProfileArgs {
  readonly allowSoftware: boolean;
  readonly browser?: string;
  readonly browserArgs: readonly string[];
  readonly headed: boolean;
  readonly json: boolean;
  readonly packageDir?: string;
  readonly port: number;
  readonly seconds: number;
  readonly url?: string;
  readonly variant: StarterProfileVariant;
}

interface CpuProfile {
  readonly nodes: readonly {
    readonly id: number;
    readonly callFrame: { readonly functionName: string; readonly url: string };
  }[];
  readonly samples?: readonly number[];
  readonly timeDeltas?: readonly number[];
}

interface ProfileResult {
  readonly adapter: Record<string, string> | null;
  readonly cpuHotspots: readonly { readonly location: string; readonly selfMs: number }[];
  readonly frames: FrameSummary;
  readonly gpuAvailable: boolean;
  readonly url: string;
  readonly variant: StarterProfileVariant;
}

function argumentValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function argumentValues(args: readonly string[], name: string): readonly string[] {
  const values: string[] = [];
  for (const [index, argument] of args.entries()) {
    if (argument === name && args[index + 1] !== undefined) values.push(args[index + 1] as string);
    else if (argument.startsWith(`${name}=`)) values.push(argument.slice(name.length + 1));
  }
  return values;
}

function positiveNumber(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new Error(`${label} must be a positive number.`);
  return parsed;
}

export function parseArgs(args: readonly string[]): ProfileArgs {
  const variant = argumentValue(args, "--variant") ?? "baseline";
  if (!(["baseline", "no-sculpture"] as const).includes(variant as never))
    throw new Error("--variant must be baseline or no-sculpture.");
  const browser = argumentValue(args, "--browser") ?? process.env.THREENATIVE_PROFILE_BROWSER;
  if (browser !== undefined && !existsSync(browser))
    throw new Error(`Profile browser does not exist: ${browser}`);
  const packageDir =
    argumentValue(args, "--package-dir") ?? process.env.THREENATIVE_PACKED_PACKAGES;
  if (packageDir !== undefined && !existsSync(packageDir))
    throw new Error(`Packed package directory does not exist: ${packageDir}`);
  return {
    allowSoftware: args.includes("--allow-software"),
    browser,
    browserArgs: argumentValues(args, "--browser-arg"),
    headed: args.includes("--headed"),
    json: args.includes("--json"),
    packageDir,
    port: positiveNumber(argumentValue(args, "--port"), DEFAULT_PORT, "--port"),
    seconds: positiveNumber(argumentValue(args, "--seconds"), 5, "--seconds"),
    url: argumentValue(args, "--url"),
    variant: variant as StarterProfileVariant,
  };
}

async function packageSourcesFrom(directory: string): Promise<Record<string, string>> {
  const files = await readdir(directory);
  const packages = [
    ["@threenative/core", "threenative-core-"],
    ["@threenative/physics", "threenative-physics-"],
    ["@threenative/playtest", "threenative-playtest-"],
    ["@threenative/runtime-native", "threenative-runtime-native-"],
    ["@threenative/ui", "threenative-ui-"],
    ["create-threenative", "create-threenative-"],
  ] as const;
  return Object.fromEntries(
    packages.map(([name, prefix]) => {
      const archive = files.find((file) => file.startsWith(prefix));
      if (archive === undefined) throw new Error(`Packed package is missing: ${name}`);
      return [name, path.join(directory, archive)];
    }),
  );
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

export function summarizeFrames(deltas: readonly number[]): FrameSummary {
  if (deltas.length === 0 || deltas.some((delta) => !Number.isFinite(delta) || delta <= 0))
    throw new Error("Frame samples must contain positive finite durations.");
  const sorted = [...deltas].sort((left, right) => left - right);
  return {
    frames: sorted.length,
    maxMs: sorted.at(-1) ?? 0,
    meanMs: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    slowFrames: sorted.filter((value) => value > SLOW_FRAME_MS).length,
  };
}

export function applyVariant(source: string, variant: StarterProfileVariant): string {
  if (variant === "baseline") return source;
  if (variant !== "no-sculpture")
    throw new Error(`Unsupported starter profile variant: ${variant}`);
  const marker = "    ctx.add(sculptureMesh);";
  if (!source.includes(marker)) throw new Error(`Starter profile marker is missing: ${marker}`);
  return source.replace(marker, `    // Profile variant ${variant}: omitted.`);
}

function cpuHotspots(profile: CpuProfile): readonly { location: string; selfMs: number }[] {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
  const totals = new Map<string, number>();
  for (const [index, nodeId] of (profile.samples ?? []).entries()) {
    const frame = nodes.get(nodeId);
    if (frame === undefined) continue;
    const name = frame.functionName || "(anonymous)";
    const location = frame.url.length === 0 ? name : `${name} @ ${path.basename(frame.url)}`;
    totals.set(location, (totals.get(location) ?? 0) + (profile.timeDeltas?.[index] ?? 0) / 1_000);
  }
  return [...totals.entries()]
    .map(([location, selfMs]) => ({ location, selfMs }))
    .sort((left, right) => right.selfMs - left.selfMs)
    .slice(0, 8);
}

async function waitForServer(url: string, server: ChildProcess): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Starter server exited ${server.exitCode}.`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Starter server did not become ready within 120 seconds.");
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("close", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

async function profileUrl(url: string, args: ProfileArgs): Promise<ProfileResult> {
  const browser = await chromium.launch({
    args: [
      "--ozone-platform=x11",
      "--enable-unsafe-webgpu",
      // Without this Dawn picks SwiftShader even on a machine with a GPU, and
      // every number below becomes a software-rasteriser number.
      "--enable-features=Vulkan",
      "--disable-gpu-sandbox",
      "--ignore-gpu-blocklist",
      ...args.browserArgs,
    ],
    executablePath: args.browser,
    headless: !args.headed,
  });
  try {
    const page = await browser.newPage({ viewport: { height: 720, width: 1280 } });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("canvas", { timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const client = await page.context().newCDPSession(page);
    await client.send("Profiler.enable");
    await client.send("Profiler.start");
    const measured = (await page.evaluate(`(async () => {
      const gpu = navigator.gpu;
      let adapter = null;
      try {
        adapter = gpu ? await gpu.requestAdapter() : null;
      } catch {}
      const info = adapter && adapter.info;
      const adapterInfo = info ? {} : null;
      if (adapterInfo !== null) {
        for (const key of ["architecture", "description", "device", "vendor"]) {
          const value = String(info[key] || "");
          if (value.length > 0) adapterInfo[key] = value;
        }
      }
      const deltas = [];
      const durationMs = ${JSON.stringify(args.seconds)} * 1000;
      await new Promise((resolve) => {
        let previous = performance.now();
        const started = previous;
        function next() {
          const now = performance.now();
          deltas.push(now - previous);
          previous = now;
          if (now - started >= durationMs) resolve();
          else requestAnimationFrame(next);
        }
        requestAnimationFrame(next);
      });
      return { adapter: adapterInfo, deltas, gpuAvailable: gpu !== undefined };
    })()`)) as {
      readonly adapter: Record<string, string> | null;
      readonly deltas: readonly number[];
      readonly gpuAvailable: boolean;
    };
    const stopped = (await client.send("Profiler.stop")) as { profile: CpuProfile };
    await client.send("Profiler.disable");
    return {
      adapter: measured.adapter,
      cpuHotspots: cpuHotspots(stopped.profile),
      frames: summarizeFrames(measured.deltas),
      gpuAvailable: measured.gpuAvailable,
      url,
      variant: args.variant,
    };
  } finally {
    await browser.close();
  }
}

export function backendOf(
  adapter: Record<string, string> | null,
): "hardware" | "software fallback" | "unknown" {
  if (adapter === null) return "unknown";
  return /swiftshader|llvmpipe|software/u.test(adapter.architecture?.toLowerCase() ?? "")
    ? "software fallback"
    : "hardware";
}

function printResult(result: ProfileResult): void {
  const { frames } = result;
  const backend = backendOf(result.adapter);
  process.stdout.write(`starter profile (${result.variant}): ${result.url}\n`);
  process.stdout.write(
    `adapter: ${result.adapter === null ? "unavailable" : JSON.stringify(result.adapter)}; backend=${backend}; navigator.gpu=${result.gpuAvailable}\n`,
  );
  process.stdout.write(
    `frames: ${frames.frames}; mean ${frames.meanMs.toFixed(2)}ms; p50 ${frames.p50Ms.toFixed(2)}ms; p95 ${frames.p95Ms.toFixed(2)}ms; p99 ${frames.p99Ms.toFixed(2)}ms; max ${frames.maxMs.toFixed(2)}ms; >16.67ms ${frames.slowFrames}\n`,
  );
  for (const hotspot of result.cpuHotspots)
    process.stdout.write(`cpu: ${hotspot.selfMs.toFixed(1)}ms ${hotspot.location}\n`);
}

/** A profile taken on SwiftShader measures the rasteriser, not the scene. */
function report(result: ProfileResult, args: ProfileArgs): void {
  process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : "");
  if (!args.json) printResult(result);
  const backend = backendOf(result.adapter);
  if (backend !== "hardware" && !args.allowSoftware)
    throw new Error(
      `Profile ran on ${backend} GPU, so these frame times mean nothing. Re-run with --headed on a machine with a GPU, or pass --allow-software to accept the fallback.`,
    );
}

export async function runStarterProfile(
  cliArgs: readonly string[] = process.argv.slice(2),
): Promise<void> {
  if (cliArgs.includes("--help")) {
    process.stdout.write(
      "pnpm profile:starter -- [--variant baseline|no-sculpture] [--seconds 5] [--browser PATH --headed] [--browser-arg=FLAG] [--url URL] [--package-dir DIR] [--json] [--allow-software]\n",
    );
    return;
  }
  const args = parseArgs(cliArgs);
  if (args.url !== undefined) {
    report(await profileUrl(args.url, args), args);
    return;
  }

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "threenative-profile-starter-"));
  let server: ChildProcess | undefined;
  try {
    const packageSources =
      args.packageDir === undefined
        ? await packageLocalFramework(temporaryRoot)
        : await packageSourcesFrom(args.packageDir);
    const project = await createProject(
      { install: true, packageSources, target: "starter", template: "starter" },
      temporaryRoot,
    );
    const playFile = path.join(project.target, "src/scenes/Play.ts");
    await writeFile(playFile, applyVariant(await readFile(playFile, "utf8"), args.variant));
    server = spawn(
      "pnpm",
      ["dev", "--host", "127.0.0.1", "--port", String(args.port), "--strictPort"],
      { cwd: project.target, stdio: ["ignore", "pipe", "pipe"] },
    );
    const output: string[] = [];
    server.stdout?.on("data", (chunk) => output.push(String(chunk)));
    server.stderr?.on("data", (chunk) => output.push(String(chunk)));
    const url = `http://127.0.0.1:${args.port}/`;
    await waitForServer(url, server);
    const result = await profileUrl(url, args).catch((error: unknown) => {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${output.join("").slice(-4_000)}`,
      );
    });
    report(result, args);
  } finally {
    if (server !== undefined) await stopServer(server);
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runStarterProfile().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
