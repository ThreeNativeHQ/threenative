import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, expect, test } from "vitest";

import {
  finishFramebufferCoverageProbe,
  startFramebufferCoverageProbe,
} from "../src/runner/framebufferCoverage.js";

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser.close();
});

async function waitRenderFrames(page: Page, count = 2): Promise<void> {
  await page.evaluate((frames) => new Promise<void>((resolve) => {
    let remaining = frames;
    const next = () => {
      remaining -= 1;
      if (remaining === 0) resolve();
      else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  }), count);
}

async function solidCanvas(page: Page, color: string): Promise<void> {
  await page.setContent('<canvas width="64" height="36"></canvas>');
  await page.evaluate((fillStyle) => {
    const canvas = document.querySelector("canvas")!;
    const context = canvas.getContext("2d")!;
    context.fillStyle = fillStyle;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }, color);
}

test("captures every render frame in the declared window without a default readback", async () => {
  const page = await browser.newPage();
  await solidCanvas(page, "rgb(5, 7, 11)");
  const artifactDirectory = await mkdtemp(join(tmpdir(), "framebuffer-coverage-pass-"));
  await mkdir(artifactDirectory, { recursive: true });

  await startFramebufferCoverageProbe(page, {
    backdrop: [5, 7, 11],
    tolerance: 0,
    window: { endStep: "loading", startStep: "loading" },
  });
  await waitRenderFrames(page, 3);
  const observation = await finishFramebufferCoverageProbe(page, artifactDirectory);

  expect(observation).toMatchObject({
    boundarySource: "scenario-steps",
    windowCompleted: true,
    windowStarted: true,
  });
  expect(observation.frameCount).toBeGreaterThanOrEqual(3);
  expect(observation.firstViolation).toBeUndefined();
  expect(observation.unreadableReason).toBeUndefined();
  await page.close();
});

test("retains the first violating grid and its exact full-frame PNG", async () => {
  const page = await browser.newPage();
  await solidCanvas(page, "rgb(255, 0, 0)");
  const artifactDirectory = await mkdtemp(join(tmpdir(), "framebuffer-coverage-fail-"));

  await startFramebufferCoverageProbe(page, {
    backdrop: [5, 7, 11],
    grid: { columns: 8, rows: 4 },
    tolerance: 0,
    window: { endStep: "loading", startStep: "loading" },
  });
  await waitRenderFrames(page);
  const observation = await finishFramebufferCoverageProbe(page, artifactDirectory);

  expect(observation.firstViolation).toMatchObject({
    frameIndex: 0,
    grid: { columns: 8, rows: 4 },
  });
  expect(observation.firstViolation?.grid.samples).toHaveLength(32);
  expect(observation.firstViolation?.grid.samples[0]).toEqual([255, 0, 0]);
  const screenshotPath = observation.firstViolation?.screenshotPath;
  expect(screenshotPath).toBeTruthy();
  const screenshot = PNG.sync.read(await readFile(screenshotPath!));
  expect({ height: screenshot.height, width: screenshot.width }).toEqual({ height: 36, width: 64 });
  await page.close();
});

test("reports an unreadable framebuffer instead of silently observing zero frames", async () => {
  const page = await browser.newPage();
  await page.setContent("<main>no canvas</main>");
  const artifactDirectory = await mkdtemp(join(tmpdir(), "framebuffer-coverage-unreadable-"));

  await startFramebufferCoverageProbe(page, {
    backdrop: [0, 0, 0],
    tolerance: 0,
    window: { endStep: "loading", startStep: "loading" },
  });
  const observation = await finishFramebufferCoverageProbe(page, artifactDirectory);

  expect(observation.frameCount).toBe(0);
  expect(observation.unreadableReason).toContain("no canvas framebuffer");
  await page.close();
});
