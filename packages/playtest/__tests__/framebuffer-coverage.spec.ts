import { makeTempDir } from "../../../test-support/temp-dir.js";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, expect, test } from "vitest";

import {
  finishFramebufferCoverageProbe,
  startFramebufferCoverageProbe,
} from "../src/runner/framebufferCoverage.js";
import type { IPlaytestFramebufferCoverageAssertion } from "../src/index.js";

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
    const canvas = document.querySelector("canvas");
    if (canvas === null) throw new Error("canvas fixture was not installed");
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("canvas fixture has no 2D context");
    context.fillStyle = fillStyle;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }, color);
}

const PROBE_KEY = "__THREENATIVE_FRAMEBUFFER_COVERAGE_PROBE__";

interface IFakeCanvas {
  getContext: (...args: unknown[]) => IFakeContext | null;
  height: number;
  toDataURL?: () => string;
  width: number;
}

interface IFakeContext {
  clearRect: (...args: number[]) => void;
  drawImage: (...args: unknown[]) => void;
  getImageData: (...args: number[]) => { data: Uint8ClampedArray };
}

function fakePage(): Page {
  return {
    evaluate: async (callback: unknown, value?: unknown) =>
      (callback as (argument: unknown) => unknown)(value),
  } as unknown as Page;
}

async function withFakeProbeGlobals<T>(
  source: IFakeCanvas | undefined,
  sampleContext: IFakeContext | null,
  fullContext: IFakeContext | null | undefined,
  body: (page: Page, flush: () => void) => Promise<T>,
): Promise<T> {
  const names = ["cancelAnimationFrame", "document", "requestAnimationFrame"];
  const restore = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  let callback: (() => void) | undefined;
  let nextRequestId = 0;
  let createdCanvases = 0;
  const sampleCanvas: IFakeCanvas = {
    getContext: () => sampleContext,
    height: 0,
    width: 0,
  };
  const fullCanvas: IFakeCanvas = {
    getContext: () => fullContext === undefined ? {
      clearRect: () => undefined,
      drawImage: () => undefined,
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    } : fullContext,
    height: 0,
    toDataURL: () => "data:image/png;base64,AAAA",
    width: 0,
  };
  try {
    Object.defineProperty(globalThis, "cancelAnimationFrame", {
      configurable: true,
      value: () => { callback = undefined; },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: () => createdCanvases++ === 0 ? sampleCanvas : fullCanvas,
        querySelectorAll: () => source === undefined ? [] : [source],
      },
    });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (next: () => void) => {
        callback = next;
        nextRequestId += 1;
        return nextRequestId;
      },
    });
    return await body(fakePage(), () => callback?.());
  } finally {
    Reflect.deleteProperty(globalThis, PROBE_KEY);
    for (const [name, descriptor] of restore) {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
      else Object.defineProperty(globalThis, name, descriptor);
    }
  }
}

function readableContext(data: readonly number[]): IFakeContext {
  return {
    clearRect: () => undefined,
    drawImage: () => undefined,
    getImageData: () => ({ data: Uint8ClampedArray.from(data) }),
  };
}

function coverageAssertion(): IPlaytestFramebufferCoverageAssertion {
  return {
    backdrop: [0, 0, 0],
    grid: { columns: 1, rows: 1 },
    tolerance: 0,
    window: { endStep: "end", startStep: "start" },
  };
}

test("covers framebuffer probe failure modes in the page seam and preserves first evidence", async () => {
  const source = { getContext: () => null, height: 2, width: 2 } satisfies IFakeCanvas;
  await withFakeProbeGlobals(source, readableContext([0, 0, 0, 255]), undefined, async (page) => {
    await startFramebufferCoverageProbe(page, coverageAssertion());
    await expect(startFramebufferCoverageProbe(page, coverageAssertion())).rejects.toThrow(
      "A framebuffer coverage probe is already active.",
    );
    const observation = await finishFramebufferCoverageProbe(page, "/tmp/framebuffer-unit");
    expect(observation).toMatchObject({ frameCount: 0, windowCompleted: true, windowStarted: true });
  });

  const cases: Array<[string, IFakeCanvas | undefined, IFakeContext | null, string]> = [
    ["no canvas", undefined, readableContext([0, 0, 0, 255]), "no canvas framebuffer"],
    ["zero-sized canvas", { getContext: () => null, height: 0, width: 2 }, readableContext([0, 0, 0, 255]), "drawing buffer is 2x0"],
    ["missing sample context", source, null, "2D readback context could not be created"],
    ["wrong readback length", source, readableContext([0, 0, 0]), "readback returned 3 bytes"],
    ["transparent readback", source, readableContext([0, 0, 0, 0]), "only transparent pixels"],
  ];
  for (const [label, canvas, context, reason] of cases) {
    await withFakeProbeGlobals(canvas, context, undefined, async (page, flush) => {
      await startFramebufferCoverageProbe(page, coverageAssertion());
      flush();
      const observation = await finishFramebufferCoverageProbe(page, `/tmp/framebuffer-unit-${label}`);
      expect(observation.unreadableReason, label).toContain(reason);
    });
  }

  await withFakeProbeGlobals(
    source,
    readableContext([255, 0, 0, 255]),
    null,
    async (page, flush) => {
      await startFramebufferCoverageProbe(page, coverageAssertion());
      flush();
      const observation = await finishFramebufferCoverageProbe(page, "/tmp/framebuffer-unit-full-context");
      expect(observation.unreadableReason).toContain("full-frame evidence context");
    },
  );

  await withFakeProbeGlobals(source, readableContext([255, 0, 0, 255]), undefined, async (page, flush) => {
    await startFramebufferCoverageProbe(page, coverageAssertion());
    const state = (globalThis as unknown as Record<string, { active: boolean }>)[PROBE_KEY];
    if (state === undefined) throw new Error("framebuffer probe state was not installed");
    state.active = false;
    flush();
    const observation = await finishFramebufferCoverageProbe(page, "/tmp/framebuffer-unit-inactive");
    expect(observation.frameCount).toBe(0);
  });

  await withFakeProbeGlobals(source, readableContext([255, 0, 0, 255]), undefined, async (page, flush) => {
    await startFramebufferCoverageProbe(page, coverageAssertion());
    flush();
    const artifactDirectory = await makeTempDir("framebuffer-coverage-unit-png-");
    const observation = await finishFramebufferCoverageProbe(page, artifactDirectory);
    expect(observation.firstViolation?.screenshotPath).toContain("framebuffer-coverage-frame-0.png");
  });

  await withFakeProbeGlobals(source, readableContext([0, 0, 0, 255]), undefined, async (page, flush) => {
    await startFramebufferCoverageProbe(page, coverageAssertion());
    flush();
    const observation = await finishFramebufferCoverageProbe(page, "/tmp/framebuffer-unit-pass");
    expect(observation).toMatchObject({ frameCount: 1, windowCompleted: true, windowStarted: true });
    expect(observation.firstViolation).toBeUndefined();
  });
});

test("reports a missing probe when the finish seam has no page state", async () => {
  await withFakeProbeGlobals(undefined, null, undefined, async (page) => {
    expect(await finishFramebufferCoverageProbe(page, "/tmp/framebuffer-unit-missing")).toEqual({
      boundarySource: "scenario-steps",
      frameCount: 0,
      unreadableReason: "the declared coverage window never installed its framebuffer probe",
      windowCompleted: false,
      windowStarted: false,
    });
  });
});

test("captures every render frame in the declared window without a default readback", async () => {
  const page = await browser.newPage();
  await solidCanvas(page, "rgb(5, 7, 11)");
  const artifactDirectory = await makeTempDir("framebuffer-coverage-pass-");
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
  const artifactDirectory = await makeTempDir("framebuffer-coverage-fail-");

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
  if (screenshotPath === undefined) throw new Error("framebuffer violation has no screenshot");
  const screenshot = PNG.sync.read(await readFile(screenshotPath));
  expect({ height: screenshot.height, width: screenshot.width }).toEqual({ height: 36, width: 64 });
  await page.close();
});

test("reports an unreadable framebuffer instead of silently observing zero frames", async () => {
  const page = await browser.newPage();
  await page.setContent("<main>no canvas</main>");
  const artifactDirectory = await makeTempDir("framebuffer-coverage-unreadable-");

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
