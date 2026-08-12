import { expect, test } from "vitest";
import { PNG } from "pngjs";

import {
  analyzeFramebufferCoverageVideo,
  analyzeScenarioBracketedCoverageFrames,
  findVideoContentBox,
  sampleFramebufferCoverageVideoFrame,
} from "../src/runner/videoAnalysis.js";

const BACKDROP: [number, number, number] = [13, 27, 42];

test("Android video analysis crops recorder bars and evaluates every inferred coverage frame", () => {
  const frames = [
    letterboxedFrame([180, 30, 20]),
    letterboxedFrame(BACKDROP),
    letterboxedFrame(BACKDROP),
    letterboxedFrame([20, 120, 180]),
  ];

  const result = analyzeFramebufferCoverageVideo(
    frames,
    frames.map((_, index) => `/artifacts/frame-${index}.png`),
    { backdrop: BACKDROP, grid: { columns: 4, rows: 2 }, tolerance: 0 },
  );

  expect(findVideoContentBox(frames)).toEqual({ height: 16, width: 24, x: 8, y: 4 });
  expect(result).toEqual({
    boundarySource: "video-backdrop-dominance",
    frameCount: 2,
    windowCompleted: true,
    windowStarted: true,
  });
});

test("Android video analysis reports the first one-frame coverage leak with its sample grid", () => {
  const leaking = letterboxedFrame(BACKDROP);
  setContentPixel(leaking, 3, 1, [90, 180, 210]);
  const frames = [
    letterboxedFrame([180, 30, 20]),
    letterboxedFrame(BACKDROP),
    leaking,
    letterboxedFrame([20, 120, 180]),
  ];

  const result = analyzeFramebufferCoverageVideo(
    frames,
    frames.map((_, index) => `/artifacts/frame-${index}.png`),
    { backdrop: BACKDROP, grid: { columns: 4, rows: 2 }, tolerance: 0 },
  );

  expect(result.firstViolation).toEqual({
    frameIndex: 1,
    grid: expect.objectContaining({ columns: 4, rows: 2, samples: expect.any(Array) }),
    screenshotPath: "/artifacts/frame-2.png",
  });
  expect(result.firstViolation?.grid.samples).toHaveLength(8);
});

test("Android scenario brackets trim the revealed encoder tail but retain a one-frame leak", () => {
  const covered = letterboxedFrame(BACKDROP);
  const leaking = letterboxedFrame(BACKDROP);
  setContentPixel(leaking, 3, 1, [90, 180, 210]);
  const revealed = letterboxedFrame([20, 120, 180]);
  const frames = [covered, leaking, revealed];
  const box = findVideoContentBox(frames);
  if (box === undefined) throw new Error("expected app content box");

  const result = analyzeScenarioBracketedCoverageFrames(
    frames.map((frame) => sampleFramebufferCoverageVideoFrame(frame, box, { columns: 4, rows: 2 })),
    ["covered.png", "leak.png", "revealed.png"],
    { backdrop: BACKDROP, grid: { columns: 4, rows: 2 }, tolerance: 0 },
  );

  expect(result).toMatchObject({
    boundarySource: "scenario-steps",
    frameCount: 2,
    firstViolation: { frameIndex: 1, screenshotPath: "leak.png" },
    windowCompleted: true,
    windowStarted: true,
  });
});

test("Android video analysis uses the shared 32 by 18 default and max-channel tolerance", () => {
  const frame = solidFrame(64, 36, [15, 31, 45]);
  const grid = sampleFramebufferCoverageVideoFrame(
    frame,
    { height: frame.height, width: frame.width, x: 0, y: 0 },
  );
  const result = analyzeFramebufferCoverageVideo(
    [solidFrame(64, 36, [200, 20, 20]), frame, solidFrame(64, 36, [20, 100, 200])],
    ["before.png", "covered.png", "after.png"],
    { backdrop: BACKDROP, tolerance: 4 },
  );

  expect(grid).toMatchObject({ columns: 32, rows: 18 });
  expect(grid.samples).toHaveLength(32 * 18);
  expect(result.firstViolation).toBeUndefined();
});

test("Android video analysis fails closed when frames or inferred boundaries are absent", () => {
  expect(analyzeFramebufferCoverageVideo([], [], { backdrop: BACKDROP, tolerance: 0 })).toEqual({
    boundarySource: "video-backdrop-dominance",
    frameCount: 0,
    unreadableReason: "TN_PLAYTEST_FRAMEBUFFER_COVERAGE_VIDEO_NO_FRAMES",
    windowCompleted: false,
    windowStarted: false,
  });

  const noBackdrop = [solidFrame(16, 16, [200, 20, 20]), solidFrame(16, 16, [20, 100, 200])];
  expect(analyzeFramebufferCoverageVideo(
    noBackdrop,
    ["before.png", "after.png"],
    { backdrop: BACKDROP, tolerance: 0 },
  )).toEqual({
    boundarySource: "video-backdrop-dominance",
    frameCount: 0,
    windowCompleted: false,
    windowStarted: false,
  });

  const truncated = [solidFrame(16, 16, BACKDROP), solidFrame(16, 16, BACKDROP)];
  expect(analyzeFramebufferCoverageVideo(
    truncated,
    ["covered-0.png", "covered-1.png"],
    { backdrop: BACKDROP, tolerance: 0 },
  )).toMatchObject({
    frameCount: 2,
    windowCompleted: false,
    windowStarted: false,
  });
});

function letterboxedFrame(color: [number, number, number]): PNG {
  const frame = solidFrame(40, 24, [0, 0, 0]);
  for (let y = 4; y < 20; y += 1) {
    for (let x = 8; x < 32; x += 1) setPixel(frame, x, y, color);
  }
  return frame;
}

function setContentPixel(frame: PNG, column: number, row: number, color: [number, number, number]): void {
  const x = 8 + Math.floor(((column + 0.5) / 4) * 24);
  const y = 4 + Math.floor(((row + 0.5) / 2) * 16);
  setPixel(frame, x, y, color);
}

function solidFrame(width: number, height: number, color: [number, number, number]): PNG {
  const frame = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) setPixel(frame, x, y, color);
  }
  return frame;
}

function setPixel(frame: PNG, x: number, y: number, [red, green, blue]: [number, number, number]): void {
  const offset = (y * frame.width + x) * 4;
  frame.data[offset] = red;
  frame.data[offset + 1] = green;
  frame.data[offset + 2] = blue;
  frame.data[offset + 3] = 255;
}
