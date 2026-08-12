import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { PNG } from "pngjs";

import type {
  IPlaytestFramebufferCoverageAssertion,
  IPlaytestFramebufferCoverageObservation,
} from "../index.js";

const execFileAsync = promisify(execFile);
type FramebufferCoverageVideoAssertion = Pick<
  IPlaytestFramebufferCoverageAssertion,
  "backdrop" | "grid" | "tolerance"
>;

export interface IFramebufferCoverageSampleGrid {
  columns: number;
  rows: number;
  samples: Array<[number, number, number]>;
}

interface IContentBox {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface IContentBoxAccumulator {
  columnLit: Uint8Array;
  height: number;
  rowLit: Uint8Array;
  width: number;
}

const DEFAULT_GRID = { columns: 32, rows: 18 } as const;

export async function analyzeFramebufferCoverageRecording(
  videoPath: string,
  artifactDirectory: string,
  assertion: FramebufferCoverageVideoAssertion,
  boundarySource: IPlaytestFramebufferCoverageObservation["boundarySource"] = "video-backdrop-dominance",
): Promise<IPlaytestFramebufferCoverageObservation> {
  await mkdir(artifactDirectory, { recursive: true });
  const frameDirectory = await mkdtemp(join(artifactDirectory, ".framebuffer-coverage-frames-"));
  try {
    const pattern = join(frameDirectory, "frame-%06d.png");
    await execFileAsync(
      "ffmpeg",
      ["-loglevel", "error", "-i", videoPath, "-vsync", "0", pattern],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    const framePaths = (await readdir(frameDirectory))
      .filter((name) => /^frame-\d+\.png$/u.test(name))
      .sort()
      .map((name) => join(frameDirectory, name));
    if (framePaths.length === 0) {
      return {
        boundarySource,
        frameCount: 0,
        unreadableReason: "TN_PLAYTEST_FRAMEBUFFER_COVERAGE_VIDEO_NO_FRAMES",
        windowCompleted: false,
        windowStarted: false,
      };
    }
    const box = await findVideoContentBoxFromFiles(framePaths);
    if (box === undefined) {
      return {
        boundarySource,
        frameCount: 0,
        unreadableReason: "TN_PLAYTEST_FRAMEBUFFER_COVERAGE_VIDEO_ALL_BLACK",
        windowCompleted: false,
        windowStarted: false,
      };
    }
    const gridSize = assertion.grid ?? DEFAULT_GRID;
    const grids: IFramebufferCoverageSampleGrid[] = [];
    for (const path of framePaths) {
      grids.push(sampleFramebufferCoverageVideoFrame(PNG.sync.read(await readFile(path)), box, gridSize));
    }
    const observation = boundarySource === "scenario-steps"
      ? analyzeScenarioBracketedCoverageFrames(grids, framePaths, assertion)
      : analyzeSampledCoverageFrames(grids, framePaths, assertion);
    if (observation.firstViolation === undefined) return observation;
    const screenshotPath = join(
      artifactDirectory,
      `framebuffer-coverage-failure-${observation.firstViolation.frameIndex}.png`,
    );
    await copyFile(observation.firstViolation.screenshotPath, screenshotPath);
    return {
      ...observation,
      firstViolation: { ...observation.firstViolation, screenshotPath },
    };
  } catch (error) {
    return {
      boundarySource,
      frameCount: 0,
      unreadableReason: `TN_PLAYTEST_FRAMEBUFFER_COVERAGE_VIDEO_UNREADABLE:${errorMessage(error)}`,
      windowCompleted: false,
      windowStarted: false,
    };
  } finally {
    await rm(frameDirectory, { force: true, recursive: true });
  }
}

/**
 * Scenario steps bracket the recording. Backdrop dominance trims only the encoder's queued
 * revealed tail; every frame in the covered run is still checked sample-by-sample.
 */
export function analyzeScenarioBracketedCoverageFrames(
  grids: readonly IFramebufferCoverageSampleGrid[],
  framePaths: readonly string[],
  assertion: FramebufferCoverageVideoAssertion,
): IPlaytestFramebufferCoverageObservation {
  const inferred = analyzeSampledCoverageFrames(grids, framePaths, assertion);
  if (inferred.frameCount === 0) {
    return {
      boundarySource: "scenario-steps",
      frameCount: 0,
      unreadableReason: "TN_PLAYTEST_FRAMEBUFFER_COVERAGE_VIDEO_NO_BACKDROP_FRAMES",
      windowCompleted: true,
      windowStarted: true,
    };
  }
  return {
    ...inferred,
    boundarySource: "scenario-steps",
    windowCompleted: true,
    windowStarted: true,
  };
}

/**
 * Finds recorder-added black bars without treating a legitimately dark game frame as a bar.
 * A row or column is cropped only when every app-owned frame keeps it black.
 */
export function findVideoContentBox(frames: readonly PNG[]): IContentBox | undefined {
  if (frames.length === 0) return undefined;
  const appFrames = frames.slice(Math.floor(frames.length / 2));
  const first = appFrames[0];
  if (first === undefined) return undefined;
  const accumulator = createContentBoxAccumulator(first);
  for (const frame of appFrames) {
    if (!accumulateContentBox(accumulator, frame)) return undefined;
  }
  return finishContentBox(accumulator);
}

async function findVideoContentBoxFromFiles(framePaths: readonly string[]): Promise<IContentBox | undefined> {
  const appPaths = framePaths.slice(Math.floor(framePaths.length / 2));
  const firstPath = appPaths[0];
  if (firstPath === undefined) return undefined;
  const accumulator = createContentBoxAccumulator(PNG.sync.read(await readFile(firstPath)));
  for (const path of appPaths) {
    if (!accumulateContentBox(accumulator, PNG.sync.read(await readFile(path)))) {
      throw new Error("TN_PLAYTEST_FRAMEBUFFER_COVERAGE_VIDEO_SIZE_CHANGED");
    }
  }
  return finishContentBox(accumulator);
}

function createContentBoxAccumulator(frame: PNG): IContentBoxAccumulator {
  return {
    columnLit: new Uint8Array(frame.width),
    height: frame.height,
    rowLit: new Uint8Array(frame.height),
    width: frame.width,
  };
}

function accumulateContentBox(accumulator: IContentBoxAccumulator, frame: PNG): boolean {
  if (frame.width !== accumulator.width || frame.height !== accumulator.height) return false;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const offset = (y * frame.width + x) * 4;
      if (frame.data[offset]! > 12 || frame.data[offset + 1]! > 12 || frame.data[offset + 2]! > 12) {
        accumulator.rowLit[y] = 1;
        accumulator.columnLit[x] = 1;
      }
    }
  }
  return true;
}

function finishContentBox({ columnLit, height, rowLit, width }: IContentBoxAccumulator): IContentBox | undefined {
  const firstRow = rowLit.indexOf(1);
  const firstColumn = columnLit.indexOf(1);
  if (firstRow === -1 || firstColumn === -1) return undefined;
  let lastRow = height - 1;
  while (lastRow > firstRow && rowLit[lastRow] === 0) lastRow -= 1;
  let lastColumn = width - 1;
  while (lastColumn > firstColumn && columnLit[lastColumn] === 0) lastColumn -= 1;
  return {
    height: lastRow - firstRow + 1,
    width: lastColumn - firstColumn + 1,
    x: firstColumn,
    y: firstRow,
  };
}

export function sampleFramebufferCoverageVideoFrame(
  frame: PNG,
  box: IContentBox,
  grid: { columns: number; rows: number } = DEFAULT_GRID,
): IFramebufferCoverageSampleGrid {
  const samples: Array<[number, number, number]> = [];
  for (let row = 0; row < grid.rows; row += 1) {
    const y = box.y + Math.min(box.height - 1, Math.floor(((row + 0.5) / grid.rows) * box.height));
    for (let column = 0; column < grid.columns; column += 1) {
      const x = box.x + Math.min(box.width - 1, Math.floor(((column + 0.5) / grid.columns) * box.width));
      const offset = (y * frame.width + x) * 4;
      samples.push([frame.data[offset]!, frame.data[offset + 1]!, frame.data[offset + 2]!]);
    }
  }
  return { columns: grid.columns, rows: grid.rows, samples };
}

export function analyzeFramebufferCoverageVideo(
  frames: readonly PNG[],
  framePaths: readonly string[],
  assertion: FramebufferCoverageVideoAssertion,
): IPlaytestFramebufferCoverageObservation {
  const base = {
    boundarySource: "video-backdrop-dominance" as const,
    frameCount: 0,
    windowCompleted: false,
    windowStarted: false,
  };
  if (frames.length === 0) {
    return { ...base, unreadableReason: "TN_PLAYTEST_FRAMEBUFFER_COVERAGE_VIDEO_NO_FRAMES" };
  }
  if (framePaths.length !== frames.length) {
    return { ...base, unreadableReason: "TN_PLAYTEST_FRAMEBUFFER_COVERAGE_VIDEO_PATH_COUNT" };
  }
  const { width, height } = frames[0]!;
  if (frames.some((frame) => frame.width !== width || frame.height !== height)) {
    return { ...base, unreadableReason: "TN_PLAYTEST_FRAMEBUFFER_COVERAGE_VIDEO_SIZE_CHANGED" };
  }
  const box = findVideoContentBox(frames);
  if (box === undefined) {
    return { ...base, unreadableReason: "TN_PLAYTEST_FRAMEBUFFER_COVERAGE_VIDEO_ALL_BLACK" };
  }
  const gridSize = assertion.grid ?? DEFAULT_GRID;
  const grids = frames.map((frame) => sampleFramebufferCoverageVideoFrame(frame, box, gridSize));
  return analyzeSampledCoverageFrames(grids, framePaths, assertion);
}

/**
 * Android screenrecord has no bridge-tick timestamps. Its boundaries are therefore inferred,
 * never reported as scenario-step aligned: the first and last frames whose sampled grid is
 * backdrop-dominant bound the window, and frames on both sides are required as start/end proof.
 */
function analyzeSampledCoverageFrames(
  grids: readonly IFramebufferCoverageSampleGrid[],
  framePaths: readonly string[],
  assertion: FramebufferCoverageVideoAssertion,
): IPlaytestFramebufferCoverageObservation {
  const base = {
    boundarySource: "video-backdrop-dominance" as const,
    frameCount: 0,
    windowCompleted: false,
    windowStarted: false,
  };
  const matchingFractions = grids.map((grid) =>
    grid.samples.reduce(
      (count, sample) => count + (sampleMatches(sample, assertion.backdrop, assertion.tolerance) ? 1 : 0),
      0,
    ) / grid.samples.length,
  );
  const dominantFrames = matchingFractions
    .map((fraction, index) => ({ fraction, index }))
    .filter(({ fraction }) => fraction > 0.5)
    .map(({ index }) => index);
  const firstVideoFrame = dominantFrames[0];
  const lastVideoFrame = dominantFrames.at(-1);
  if (firstVideoFrame === undefined || lastVideoFrame === undefined) return base;

  const windowFrames = grids.slice(firstVideoFrame, lastVideoFrame + 1);
  const firstViolationOffset = windowFrames.findIndex((grid) =>
    grid.samples.some((sample) => !sampleMatches(sample, assertion.backdrop, assertion.tolerance)),
  );
  return {
    ...base,
    frameCount: windowFrames.length,
    ...(firstViolationOffset === -1
      ? {}
      : {
          firstViolation: {
            frameIndex: firstViolationOffset,
            grid: windowFrames[firstViolationOffset]!,
            screenshotPath: framePaths[firstVideoFrame + firstViolationOffset]!,
          },
        }),
    windowCompleted: lastVideoFrame < grids.length - 1,
    windowStarted: firstVideoFrame > 0,
  };
}

function sampleMatches(
  sample: readonly [number, number, number],
  backdrop: readonly [number, number, number],
  tolerance: number,
): boolean {
  return Math.max(
    Math.abs(sample[0] - backdrop[0]),
    Math.abs(sample[1] - backdrop[1]),
    Math.abs(sample[2] - backdrop[2]),
  ) <= tolerance;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
