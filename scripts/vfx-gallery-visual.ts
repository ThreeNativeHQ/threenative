import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { softwareAdapterName } from "../packages/playtest/src/runner/browser.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_DIRECTORY = path.join(REPO_ROOT, "artifacts/vfx-gallery");
const SCENARIO = "examples/vfx-gallery/playtests/vfx-gallery.playtest.json";
const MIN_OCCUPIED_RATIO = 0.0001;
const PIXEL_DELTA = 12;
const GALLERY_BACKGROUND = [5, 10, 22] as const;

export const VFX_GALLERY_EFFECT_IDS = [
  "fire",
  "jet-flame",
  "burst-flash",
  "muzzle-flash",
  "smoke",
  "dust-cloud",
  "steam-plume",
  "ash-plume",
  "explosion-cloud",
  "impact-dust",
  "ground-mist",
  "poison-cloud",
  "rain",
  "snow",
  "spark-streaks",
  "impact-sparks",
  "ember-fountain",
  "magic-wisp",
  "magic-orb",
  "magic-beam",
  "healing-aura",
  "effekseer-fire01",
  "effekseer-fire02",
  "effekseer-fire03",
  "effekseer-lightning01",
  "effekseer-lightning02",
  "effekseer-lightning03",
  "effekseer-ice01",
  "effekseer-ice02",
  "effekseer-ice03",
  "effekseer-holy01",
  "effekseer-hit01",
  "effekseer-hit02",
  "effekseer-wind01",
  "effekseer-wind02",
  "effekseer-wind03",
  "kenney-slash-arc",
  "kenney-confetti-burst",
  "kenney-leaf-swirl",
  "pixi-bubble-stream",
  "pixi-cartoon-smoke-blast",
  "godot-fireflies",
  "godot-portal-vortex",
  "godot-blood-splash",
  "godot-shield-break",
  "godot-waterfall-mist",
] as const;

export interface IGalleryTileRegion {
  readonly id: string;
  readonly page?: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface IGalleryTileMetric extends IGalleryTileRegion {
  readonly occupiedPixels: number;
  readonly occupiedRatio: number;
}

const PAGE_SIZE = 9;
const PAGE_X = [350, 590, 830] as const;
const PAGE_Y = [170, 350, 510] as const;
const PAGE_WIDTH = 280;
const PAGE_HEIGHT = [210, 180, 190] as const;

export const VFX_GALLERY_PAGE_REGIONS: readonly (readonly IGalleryTileRegion[])[] = Array.from(
  { length: Math.ceil(VFX_GALLERY_EFFECT_IDS.length / PAGE_SIZE) },
  (_, page) =>
    VFX_GALLERY_EFFECT_IDS.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((id, slot) => {
      const row = Math.floor(slot / 3);
      return {
        id,
        page,
        x: PAGE_X[slot % 3] ?? 0,
        y: PAGE_Y[row] ?? 0,
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT[row] ?? 190,
      };
    }),
);

export const VFX_GALLERY_TILE_REGIONS: readonly IGalleryTileRegion[] =
  VFX_GALLERY_PAGE_REGIONS.flat();

const ASSERTION_KINDS = new Set(["frameDiff", "region"]);

function isOccupied(data: Uint8Array, offset: number): boolean {
  const alpha = data[offset + 3] ?? 0;
  if (alpha <= 8) return false;
  return (
    Math.max(
      Math.abs((data[offset] ?? 0) - GALLERY_BACKGROUND[0]),
      Math.abs((data[offset + 1] ?? 0) - GALLERY_BACKGROUND[1]),
      Math.abs((data[offset + 2] ?? 0) - GALLERY_BACKGROUND[2]),
    ) > PIXEL_DELTA
  );
}

export function measureGalleryTile(
  image: Pick<PNG, "data" | "height" | "width">,
  region: IGalleryTileRegion,
): IGalleryTileMetric {
  if (
    region.x < 0 ||
    region.y < 0 ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x + region.width > image.width ||
    region.y + region.height > image.height
  ) {
    throw new Error(`TN_VFX_GALLERY_REGION_OUT_OF_BOUNDS:${region.id}`);
  }
  let occupiedPixels = 0;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      if (isOccupied(image.data, (y * image.width + x) * 4)) occupiedPixels += 1;
    }
  }
  const area = region.width * region.height;
  return { ...region, occupiedPixels, occupiedRatio: occupiedPixels / area };
}

export function measureGalleryTiles(
  image: Pick<PNG, "data" | "height" | "width">,
  regions: readonly IGalleryTileRegion[] = VFX_GALLERY_TILE_REGIONS,
): readonly IGalleryTileMetric[] {
  return regions.map((region) => measureGalleryTile(image, region));
}

export function validateGalleryEvidence(
  appliedIds: readonly string[],
  metrics: readonly IGalleryTileMetric[],
): void {
  const expected = new Set<string>(VFX_GALLERY_EFFECT_IDS);
  const applied = new Set(appliedIds);
  const metricIds = new Set(metrics.map(({ id }) => id));
  const unknownApplied = appliedIds.filter((id) => !expected.has(id));
  const duplicateApplied = appliedIds.length !== applied.size;
  const unknownMetrics = metrics.filter(({ id }) => !expected.has(id)).map(({ id }) => id);
  const duplicateMetrics = metrics.length !== metricIds.size;
  if (unknownApplied.length > 0 || duplicateApplied) {
    throw new Error(
      `TN_VFX_GALLERY_APPLIED_IDS_INVALID:${unknownApplied.join(",") || "duplicate"}`,
    );
  }
  if (unknownMetrics.length > 0 || duplicateMetrics) {
    throw new Error(`TN_VFX_GALLERY_METRICS_INVALID:${unknownMetrics.join(",") || "duplicate"}`);
  }
  const missingApplied = VFX_GALLERY_EFFECT_IDS.filter((id) => !applied.has(id));
  if (missingApplied.length > 0) {
    throw new Error(`TN_VFX_GALLERY_MISSING_TILE:${missingApplied.join(",")}`);
  }
  const missingMetrics = VFX_GALLERY_EFFECT_IDS.filter((id) => !metricIds.has(id));
  if (missingMetrics.length > 0) {
    throw new Error(`TN_VFX_GALLERY_MISSING_METRIC:${missingMetrics.join(",")}`);
  }
  const empty = metrics
    .filter(({ occupiedRatio }) => occupiedRatio < MIN_OCCUPIED_RATIO)
    .map(({ id }) => id);
  if (empty.length > 0) {
    throw new Error(`TN_VFX_GALLERY_TILE_EMPTY:${empty.join(",")}`);
  }
}

export function assertGalleryAssertionKinds(kinds: readonly string[]): void {
  const invalid = kinds.filter((kind) => !ASSERTION_KINDS.has(kind));
  if (invalid.length > 0) throw new Error(`TN_VFX_GALLERY_ASSERTION_KIND:${invalid.join(",")}`);
}

export function compareGalleryCaptures(
  before: Pick<PNG, "data" | "height" | "width">,
  after: Pick<PNG, "data" | "height" | "width">,
): { readonly changedPixels: number; readonly changedPixelRatio: number } {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error("TN_VFX_GALLERY_CAPTURE_DIMENSIONS_MISMATCH");
  }
  let changedPixels = 0;
  const pixels = before.width * before.height;
  for (let offset = 0; offset < before.data.length; offset += 4) {
    if (
      Math.abs((before.data[offset] ?? 0) - (after.data[offset] ?? 0)) > PIXEL_DELTA ||
      Math.abs((before.data[offset + 1] ?? 0) - (after.data[offset + 1] ?? 0)) > PIXEL_DELTA ||
      Math.abs((before.data[offset + 2] ?? 0) - (after.data[offset + 2] ?? 0)) > PIXEL_DELTA
    )
      changedPixels += 1;
  }
  const changedPixelRatio = changedPixels / pixels;
  if (changedPixelRatio < MIN_OCCUPIED_RATIO) {
    throw new Error(`TN_VFX_GALLERY_CAPTURE_UNCHANGED:${changedPixelRatio.toFixed(6)}`);
  }
  return { changedPixels, changedPixelRatio };
}

export function requiredPng(filePath: string): PNG {
  if (!existsSync(filePath)) throw new Error(`TN_VFX_GALLERY_CAPTURE_MISSING:${filePath}`);
  try {
    return PNG.sync.read(readFileSync(filePath));
  } catch (error) {
    throw new Error(
      `TN_VFX_GALLERY_CAPTURE_INVALID:${filePath}:${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function appliedIdsFromReport(report: unknown): readonly string[] {
  const observations = record(record(report).observations);
  const resources = record(observations.resources);
  const state = record(resources.state);
  const after = record(state.after);
  const appliedIds = after.appliedIds;
  if (!Array.isArray(appliedIds) || appliedIds.some((id) => typeof id !== "string")) {
    throw new Error("TN_VFX_GALLERY_APPLIED_IDS_UNOBSERVED");
  }
  return appliedIds;
}

async function validateScenarioVisualKinds(): Promise<void> {
  const scenario = record(
    JSON.parse(await readFile(path.join(REPO_ROOT, SCENARIO), "utf8")) as unknown,
  );
  const assertions = record(scenario.assert).visual;
  if (!Array.isArray(assertions) || assertions.length === 0) {
    throw new Error("TN_VFX_GALLERY_VISUAL_ASSERTIONS_MISSING");
  }
  const kinds = assertions.flatMap((assertion) => {
    const keys = Object.keys(record(assertion));
    return keys.length === 1 ? keys : [];
  });
  assertGalleryAssertionKinds(kinds);
}

export function hardwareAdapterName(provenance: unknown): string {
  const capture = record(provenance);
  if (capture.rendererKind !== "webgpu") {
    throw new Error(`TN_VFX_GALLERY_RENDERER_INVALID:${String(capture.rendererKind ?? "missing")}`);
  }
  const rawAdapter = record(capture.adapter);
  const adapter = Object.fromEntries(
    Object.entries(rawAdapter).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "",
    ),
  );
  if (Object.keys(adapter).length === 0) throw new Error("TN_VFX_GALLERY_ADAPTER_MISSING");
  const software = softwareAdapterName(adapter);
  if (software !== undefined) throw new Error(`TN_VFX_GALLERY_SOFTWARE_ADAPTER:${software}`);
  return Object.entries(adapter)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

interface ICommandResult {
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}

function runCommand(command: string, args: readonly string[]): Promise<ICommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.once("error", rejectCommand);
    child.once("close", (code) => resolveCommand({ code: code ?? 1, stderr, stdout }));
  });
}

function parseRunnerReport(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  if (trimmed === "") throw new Error("TN_VFX_GALLERY_PLAYTEST_REPORT_MISSING");
  try {
    return record(JSON.parse(trimmed));
  } catch {
    throw new Error("TN_VFX_GALLERY_PLAYTEST_REPORT_INVALID");
  }
}

export async function runVfxGalleryVisual(
  out = ARTIFACT_DIRECTORY,
): Promise<Record<string, unknown>> {
  await validateScenarioVisualKinds();
  await rm(out, { force: true, recursive: true });
  await mkdir(out, { recursive: true });
  const command = await runCommand(process.execPath, [
    path.join(REPO_ROOT, "packages/playtest/dist/runner/cli.js"),
    SCENARIO,
    "--project",
    REPO_ROOT,
    "--target",
    "browser",
    "--url",
    "http://127.0.0.1:5173",
    "--port",
    "0",
    "--server-command",
    "pnpm --filter vfx-gallery dev --host 127.0.0.1 --port $PORT --strictPort",
    "--browser-recipe",
    "webgpu",
    "--headed",
    "--artifacts",
    path.relative(REPO_ROOT, out),
  ]);
  const runnerReport = parseRunnerReport(command.stdout);
  const provenance = JSON.parse(await readFile(path.join(out, "capture.json"), "utf8")) as unknown;
  const adapter = hardwareAdapterName(provenance);
  const before = requiredPng(path.join(out, "before.png"));
  const after = requiredPng(path.join(out, "after.png"));
  const metrics = VFX_GALLERY_PAGE_REGIONS.flatMap((regions, page) => {
    const screenshot = requiredPng(path.join(out, `page-${page + 1}.png`));
    return measureGalleryTiles(screenshot, regions);
  });
  const appliedIds = appliedIdsFromReport(runnerReport);
  validateGalleryEvidence(appliedIds, metrics);
  const comparison = compareGalleryCaptures(before, after);
  const report: Record<string, unknown> = {
    adapter,
    appliedIds,
    comparison,
    generatedAt: new Date().toISOString(),
    metrics,
    runnerExitCode: command.code,
    runnerPass: runnerReport.pass === true,
    schemaVersion: "0.1.0",
    source: "vfx-gallery-browser-webgpu",
  };
  await writeFile(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (command.code !== 0 || runnerReport.pass !== true) {
    throw new Error(`TN_VFX_GALLERY_PLAYTEST_FAILED:exit=${command.code}`);
  }
  const visible = metrics.filter(({ occupiedRatio }) => occupiedRatio >= MIN_OCCUPIED_RATIO).length;
  process.stdout.write(`46 evaluated, ${visible} visible, 0 missing; adapter ${adapter}\n`);
  return report;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runVfxGalleryVisual().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
