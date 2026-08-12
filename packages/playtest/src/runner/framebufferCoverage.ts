import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";

import type {
  IPlaytestFramebufferCoverageAssertion,
  IPlaytestFramebufferCoverageObservation,
} from "../index.js";

const DEFAULT_COLUMNS = 32;
const DEFAULT_ROWS = 18;
const PROBE_KEY = "__THREENATIVE_FRAMEBUFFER_COVERAGE_PROBE__";

interface IPageProbeResult {
  firstViolation?: {
    frameIndex: number;
    fullPngDataUrl?: string;
    grid: {
      columns: number;
      rows: number;
      samples: Array<[number, number, number]>;
    };
  };
  frameCount: number;
  unreadableReason?: string;
}

export async function startFramebufferCoverageProbe(
  page: Page,
  assertion: IPlaytestFramebufferCoverageAssertion,
): Promise<void> {
  const columns = assertion.grid?.columns ?? DEFAULT_COLUMNS;
  const rows = assertion.grid?.rows ?? DEFAULT_ROWS;
  await page.evaluate(
    ({ backdrop, columns: gridColumns, key, rows: gridRows, tolerance }) => {
      const host = globalThis as unknown as Record<string, unknown>;
      if (host[key] !== undefined) throw new Error("A framebuffer coverage probe is already active.");
      const canvases = [...document.querySelectorAll("canvas")];
      const source = canvases.sort(
        (left, right) => right.width * right.height - left.width * left.height,
      )[0];
      const state: {
        active: boolean;
        firstViolation?: IPageProbeResult["firstViolation"];
        frameCount: number;
        requestId?: number;
        unreadableReason?: string;
      } = { active: true, frameCount: 0 };
      host[key] = state;
      if (source === undefined) {
        state.unreadableReason = "the page has no canvas framebuffer";
        return;
      }
      if (source.width <= 0 || source.height <= 0) {
        state.unreadableReason = `the canvas drawing buffer is ${source.width}x${source.height}`;
        return;
      }
      const sampleCanvas = document.createElement("canvas");
      sampleCanvas.width = gridColumns;
      sampleCanvas.height = gridRows;
      const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
      if (sampleContext === null) {
        state.unreadableReason = "a 2D readback context could not be created";
        return;
      }
      const capture = (): void => {
        if (!state.active) return;
        try {
          sampleContext.clearRect(0, 0, gridColumns, gridRows);
          sampleContext.drawImage(source, 0, 0, gridColumns, gridRows);
          const image = sampleContext.getImageData(0, 0, gridColumns, gridRows);
          if (image.data.length !== gridColumns * gridRows * 4) {
            throw new Error(`readback returned ${image.data.length} bytes`);
          }
          const samples: Array<[number, number, number]> = [];
          let hasReadableAlpha = false;
          let violates = false;
          for (let offset = 0; offset < image.data.length; offset += 4) {
            const sample: [number, number, number] = [
              image.data[offset]!,
              image.data[offset + 1]!,
              image.data[offset + 2]!,
            ];
            samples.push(sample);
            if (image.data[offset + 3]! > 0) hasReadableAlpha = true;
            if (sample.some((channel, index) => Math.abs(channel - backdrop[index]!) > tolerance)) {
              violates = true;
            }
          }
          if (!hasReadableAlpha) throw new Error("readback returned only transparent pixels");
          const frameIndex = state.frameCount;
          state.frameCount += 1;
          if (violates && state.firstViolation === undefined) {
            const fullCanvas = document.createElement("canvas");
            fullCanvas.width = source.width;
            fullCanvas.height = source.height;
            const fullContext = fullCanvas.getContext("2d");
            if (fullContext === null) throw new Error("a full-frame evidence context could not be created");
            fullContext.drawImage(source, 0, 0);
            state.firstViolation = {
              frameIndex,
              fullPngDataUrl: fullCanvas.toDataURL("image/png"),
              grid: { columns: gridColumns, rows: gridRows, samples },
            };
          }
        } catch (error) {
          state.unreadableReason = error instanceof Error ? error.message : String(error);
          state.active = false;
          return;
        }
        state.requestId = requestAnimationFrame(capture);
      };
      state.requestId = requestAnimationFrame(capture);
    },
    { backdrop: assertion.backdrop, columns, key: PROBE_KEY, rows, tolerance: assertion.tolerance },
  );
}

export async function finishFramebufferCoverageProbe(
  page: Page,
  artifactDirectory: string,
): Promise<IPlaytestFramebufferCoverageObservation> {
  const result = await page.evaluate((key): IPageProbeResult | undefined => {
    const host = globalThis as unknown as Record<string, unknown>;
    const state = host[key] as
      | (IPageProbeResult & { active: boolean; requestId?: number })
      | undefined;
    if (state === undefined) return undefined;
    state.active = false;
    if (state.requestId !== undefined) cancelAnimationFrame(state.requestId);
    delete host[key];
    return {
      ...(state.firstViolation === undefined ? {} : { firstViolation: state.firstViolation }),
      frameCount: state.frameCount,
      ...(state.unreadableReason === undefined ? {} : { unreadableReason: state.unreadableReason }),
    };
  }, PROBE_KEY);
  if (result === undefined) {
    return {
      boundarySource: "scenario-steps",
      frameCount: 0,
      unreadableReason: "the declared coverage window never installed its framebuffer probe",
      windowCompleted: false,
      windowStarted: false,
    };
  }
  let firstViolation: IPlaytestFramebufferCoverageObservation["firstViolation"];
  let unreadableReason = result.unreadableReason;
  if (result.firstViolation !== undefined) {
    const screenshotPath = join(
      artifactDirectory,
      `framebuffer-coverage-frame-${result.firstViolation.frameIndex}.png`,
    );
    const encoded = result.firstViolation.fullPngDataUrl;
    if (encoded?.startsWith("data:image/png;base64,") === true) {
      await writeFile(screenshotPath, Buffer.from(encoded.slice("data:image/png;base64,".length), "base64"));
    } else {
      unreadableReason ??= "the violating frame could not be encoded as PNG evidence";
    }
    firstViolation = {
      frameIndex: result.firstViolation.frameIndex,
      grid: result.firstViolation.grid,
      screenshotPath: encoded?.startsWith("data:image/png;base64,") === true ? screenshotPath : "",
    };
  }
  return {
    boundarySource: "scenario-steps",
    ...(firstViolation === undefined ? {} : { firstViolation }),
    frameCount: result.frameCount,
    ...(unreadableReason === undefined ? {} : { unreadableReason }),
    windowCompleted: true,
    windowStarted: true,
  };
}
