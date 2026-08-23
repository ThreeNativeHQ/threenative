import { length } from "./sampling.js";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import {
  evaluateRichPlaytestAssertions,
  loadPlaytestScenario,
  playtestDiagnostic,
  playtestStepHoldTicks,
  playtestStepWaitTicks,
  resolveDiagnosticsPolicy,
  type IPlaytestArtifactRequest,
  type IPlaytestAssertionResult,
  type IPlaytestCaptureProvenance,
  type IPlaytestDiagnosticsPolicy,
  type IPlaytestDiagnostic,
  type IPlaytestFramebufferCoverageObservation,
  type IPlaytestObservationSnapshot,
  type IPlaytestObservations,
  type IPlaytestPathAssertion,
  type IPlaytestProtocolDiagnostic,
  type IPlaytestReport,
  type IPlaytestSampleRequest,
  type IPlaytestScenario,
  type IPlaytestSetupRequest,
  type IPlaytestTrivialityOptOut,
  type PlaytestVec3,
} from "../index.js";
import { assertCaptureNotBlank, CaptureGuardError } from "../capture.js";
import { chromium, type Browser, type CDPSession, type Page } from "playwright";

import { connectPlaytestBridge, PlaytestBridgeError, type IPlaytestBridgeClient } from "./bridgeClient.js";
import {
  PERFORMANCE_BROWSER_ARGS,
  reconcileBrowserPointers,
  resolveBrowserArguments,
  softwareAdapterName,
} from "./browser.js";
import type { IStandalonePlaytestConfig } from "./config.js";
import {
  provideDisplay,
  runNeedsPixels,
  type IProvidedDisplay,
} from "./captureEnvironment.js";
import {
  acquireCaptureLock,
  decideLockPolicy,
  defaultCaptureLockRoot,
  detectCaptureConcurrency,
  isProcessAlive,
  type ICaptureLease,
} from "./captureLock.js";
import {
  finishFramebufferCoverageProbe,
  startFramebufferCoverageProbe,
} from "./framebufferCoverage.js";
import { STANDALONE_PLAYTEST_OBSERVATION_FIELDS } from "./observationFields.js";
// Extracted verbatim from runner.ts (PRD-182 Phase 4); do not edit semantics here.
import { entityPosition, subtract, isAnonymousMovementScenario } from "./sampling.js";
import { failedDiagnosticsAssertion, STOPPED_LOOP_ERROR, MAX_FIXED_STEP_STARTUP_RETRIES } from "./runner.js";
import type { IStandalonePlaytestReport, IRunStepSamples } from "./runner.js";
// Extracted verbatim from runner.ts (PRD-182 Phase 4); do not edit semantics here.
export function collectTrivialityOptOuts(assertions: readonly IPlaytestAssertionResult[]): IPlaytestTrivialityOptOut[] {
  return assertions.flatMap(({ details, id }) => {
    if (details?.trivialityOptOut !== true) return [];
    const expected = details.expected;
    if (typeof expected !== "object" || expected === null || Array.isArray(expected)) return [];
    const reason = (expected as { allowTrivial?: unknown }).allowTrivial;
    return typeof reason === "string" ? [{ id, reason }] : [];
  });
}

/** Capture the largest rendered canvas without composited DOM overlays. */
export async function captureVisualSurface(
  page: Page,
  artifactPath?: string,
): Promise<Buffer | undefined> {
  const canvases = page.locator("canvas");
  const sourceIndex = await canvases.evaluateAll((elements) => {
    let largestArea = 0;
    let largestIndex = -1;
    for (const [index, canvas] of (elements as HTMLCanvasElement[]).entries()) {
      const area = canvas.width * canvas.height;
      if (area > largestArea) {
        largestArea = area;
        largestIndex = index;
      }
    }
    return largestIndex;
  });
  if (sourceIndex < 0) return undefined;
  const content = await canvases.nth(sourceIndex).screenshot();
  if (artifactPath !== undefined) await writeFile(artifactPath, content);
  return content;
}

export function buildObservations(candidate: Partial<IPlaytestObservations>): IPlaytestObservations {
  const observations = {} as IPlaytestObservations;
  for (const field of STANDALONE_PLAYTEST_OBSERVATION_FIELDS) {
    const value = candidate[field];
    if (value !== undefined) Object.assign(observations, { [field]: value });
  }
  return observations;
}

export function componentObservations(
  before: IPlaytestObservationSnapshot | undefined,
  after: IPlaytestObservationSnapshot | undefined,
): IPlaytestObservations["components"] {
  if (before?.components === undefined && after?.components === undefined) return undefined;
  const entities = new Set([...Object.keys(before?.components ?? {}), ...Object.keys(after?.components ?? {})]);
  return Object.fromEntries([...entities].map((entity) => {
    const beforeFields = before?.components?.[entity] ?? {};
    const afterFields = after?.components?.[entity] ?? {};
    const fields = new Set([...Object.keys(beforeFields), ...Object.keys(afterFields)]);
    return [entity, Object.fromEntries([...fields].map((field) => [field, {
      ...(beforeFields[field] === undefined ? {} : { before: beforeFields[field] }),
      ...(afterFields[field] === undefined ? {} : { after: afterFields[field] }),
    }]))];
  }));
}

export function screenshotObservations(
  before: Buffer | undefined,
  after: Buffer | undefined,
  scenario: IPlaytestScenario,
  captureFailure: { code: "TN_CAPTURE_BLANK"; label: string; reason: string } | undefined = undefined,
): IPlaytestObservations["visual"] | undefined {
  if (after === undefined) return captureFailure === undefined ? undefined : { captureFailure };
  const afterPng = PNG.sync.read(after);
  const beforePng = before === undefined ? undefined : PNG.sync.read(before);
  const sameSize = beforePng !== undefined && beforePng.width === afterPng.width && beforePng.height === afterPng.height;
  let changedPixelRatio: number | undefined;
  if (sameSize && beforePng !== undefined) {
    let changed = 0;
    const pixels = afterPng.width * afterPng.height;
    for (let offset = 0; offset < afterPng.data.length; offset += 4) {
      const difference = Math.max(
        Math.abs(afterPng.data[offset]! - beforePng.data[offset]!),
        Math.abs(afterPng.data[offset + 1]! - beforePng.data[offset + 1]!),
        Math.abs(afterPng.data[offset + 2]! - beforePng.data[offset + 2]!),
      );
      if (difference > 8) changed += 1;
    }
    changedPixelRatio = changed / pixels;
  }
  const regions = (scenario.assert?.visual ?? [])
    .flatMap(({ region }) => region === undefined ? [] : [region])
    .map((region) => ({ ...region, ...regionMetrics(afterPng, region) }));
  return {
    ...(changedPixelRatio === undefined ? {} : { changedPixelRatio }),
    ...(sameSize ? { comparisonSource: "before-after" } : {}),
    ...(regions.length === 0 ? {} : { nonblankRegions: regions }),
    ...(captureFailure === undefined ? {} : { captureFailure }),
  };
}

export function regionMetrics(
  png: PNG,
  region: { height: number; maxLuminance?: number; width: number; x: number; y: number },
): { darkPixelRatio: number; nonblankPixelRatio: number } {
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(png.width, Math.ceil(region.x + region.width));
  const y1 = Math.min(png.height, Math.ceil(region.y + region.height));
  const pixels = Math.max(1, (x1 - x0) * (y1 - y0));
  let dark = 0;
  let nonblank = 0;
  const maximumLuminance = region.maxLuminance ?? 0.25;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * png.width + x) * 4;
      const alpha = png.data[offset + 3]! / 255;
      const luminance = (0.2126 * png.data[offset]! + 0.7152 * png.data[offset + 1]! + 0.0722 * png.data[offset + 2]!) / 255;
      if (alpha > 0 && luminance > 0.01) nonblank += 1;
      if (luminance <= maximumLuminance) dark += 1;
    }
  }
  return { darkPixelRatio: dark / pixels, nonblankPixelRatio: nonblank / pixels };
}

export function failureReport(config: IStandalonePlaytestConfig, scenario: IPlaytestScenario, diagnostic: IPlaytestProtocolDiagnostic): IStandalonePlaytestReport {
  const diagnosticsPolicy = resolveDiagnosticsPolicy(scenario.assert?.diagnostics);
  return {
    artifactDirectory: config.artifactDirectory,
    assertionResults: [failedDiagnosticsAssertion(diagnosticsPolicy)],
    debugColliders: false,
    diagnostics: [{ ...diagnostic, suggestion: diagnostic.fix.instruction }],
    diagnosticsPolicy,
    distance: 0,
    entity: scenario.subject ?? "",
    expectMoved: false,
    frames: 0,
    input: "",
    movementThreshold: 0,
    pass: false,
    runtime: "web",
    scenario: scenario.name,
    target: scenario.target,
    trivialityOptOutCount: 0,
    trivialityOptOuts: [],
    url: config.url,
  } as IStandalonePlaytestReport;
}

// Every key here is optional in the scenario, and the payload crosses assertJsonSafe
// on the way to the page. An explicit `undefined` is not JSON-safe, so spreading a
// partially-specified transform verbatim aborted the whole run before it started.
// Absent keys must stay absent.
export function setupRequest(scenario: IPlaytestScenario): IPlaytestSetupRequest {
  return {
    ...(scenario.setup?.entities === undefined
      ? {}
      : {
          entities: scenario.setup.entities.map(({ entity, position, rotation, scale }) => ({
            entity,
            transform: {
              ...(position === undefined ? {} : { position }),
              ...(rotation === undefined ? {} : { rotation }),
              ...(scale === undefined ? {} : { scale }),
            },
          })),
        }),
    ...(scenario.setup?.resources === undefined
      ? {}
      : {
          resources: scenario.setup.resources.map(({ id, path, value }) => ({
            id,
            ...(path === undefined ? {} : { path }),
            value: value as never,
          })),
        }),
  };
}

export async function runStep(
  page: Page,
  bridge: IPlaytestBridgeClient | undefined,
  step: IPlaytestScenario["steps"][number],
  viewport: IPlaytestScenario["viewport"],
  pathEntity: string | undefined,
  pathPositions: PlaytestVec3[],
  inputState: StepInputState,
  movementSampleRequest: IPlaytestSampleRequest | undefined,
  finalStep: boolean,
): Promise<IRunStepSamples> {
  if (step.pointerPosition !== undefined) {
    await page.mouse.move(
      step.pointerPosition.x * viewport.width,
      step.pointerPosition.y * viewport.height,
    );
    if (step.pointerPosition.buttons !== undefined) {
      await setPointerButtons(page, inputState, step.pointerPosition.buttons);
    }
  }
  if (step.pointers !== undefined) {
    await setBrowserPointers(page, inputState, step.pointers, viewport);
  }
  const press = step.press;
  if (typeof press === "string") {
    await page.keyboard.down(press);
    inputState.heldKeys.add(press);
  } else if (press !== undefined) {
    for (const key of inputState.heldKeys) {
      if (!press.includes(key)) {
        await page.keyboard.up(key);
        inputState.heldKeys.delete(key);
      }
    }
    for (const key of press) {
      if (!inputState.heldKeys.has(key)) {
        await page.keyboard.down(key);
        inputState.heldKeys.add(key);
      }
    }
  }
  const inputDriven = playtestStepDrivesMovement(step, inputActive(inputState));
  const frames = (step.holdFrames ?? 0) + (step.waitFrames ?? 0);
  const fixedStep = bridge?.description.capabilities.includes("runtime.fixedStep") === true;
  const ticks = playtestStepHoldTicks(step, 0) + playtestStepWaitTicks(step) + (fixedStep ? frames : 0);
  if (ticks > 0 && fixedStep) {
    // Keep the virtual clock ahead of requestAnimationFrame while preserving a bounded
    // path sample cadence. One browser round-trip per tick lets live frames race the
    // deterministic clock on loaded runners and makes long recordings nondeterministic.
    const sampleTicks = 10;
    for (let index = 0; index < ticks; index += sampleTicks) {
      await advanceFixedStep(page, bridge, Math.min(sampleTicks, ticks - index));
      await samplePathPosition(bridge, pathEntity, pathPositions);
    }
  } else {
    await waitFrames(page, Math.max(frames, ticks, 1));
    await samplePathPosition(bridge, pathEntity, pathPositions);
  }
  const afterInput = bridge === undefined || movementSampleRequest === undefined
    ? undefined
    : await bridge.sample(movementSampleRequest);
  let afterStep = afterInput;
  if (press !== undefined && step.release) {
    const released = typeof press === "string" ? [press] : [...inputState.heldKeys];
    for (const key of released) {
      await page.keyboard.up(key);
      inputState.heldKeys.delete(key);
    }
    // Let the game loop observe the release before a following step presses the
    // same key again. Without this frame, adjacent steps are indistinguishable
    // from one continuous hold to input latches.
    if (!finalStep) {
      if (bridge?.description.capabilities.includes("runtime.fixedStep") === true) {
        await advanceFixedStep(page, bridge, 1);
      } else {
        await waitFrames(page, 1);
      }
      if (bridge !== undefined && movementSampleRequest !== undefined) {
        afterStep = await bridge.sample(movementSampleRequest);
      }
    }
  }
  if (step.pointerPosition?.buttons !== undefined && step.release) {
    await setPointerButtons(page, inputState, 0);
  }
  if (step.pointers !== undefined && step.release) {
    await setBrowserPointers(page, inputState, [], viewport);
    if (bridge?.description.capabilities.includes("runtime.fixedStep") === true) {
      await advanceFixedStep(page, bridge, 1);
    } else {
      await waitFrames(page, 1);
    }
    if (bridge !== undefined && movementSampleRequest !== undefined) {
      afterStep = await bridge.sample(movementSampleRequest);
    }
  }
  return { afterInput, afterStep, inputDriven };
}

/**
 * The core bridge is installed before an async scene load completes, so its describe/ready
 * handshake can finish one browser frame before the fixed-step loop starts. Retry only that
 * exact startup race; a stopped loop that does not recover remains a runner failure.
 */
export async function advanceFixedStep(
  page: Page,
  bridge: Pick<IPlaytestBridgeClient, "advance">,
  ticks: number,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await bridge.advance(ticks);
      return;
    } catch (error) {
      if (
        !(error instanceof Error)
        || !error.message.includes(STOPPED_LOOP_ERROR)
        || attempt >= MAX_FIXED_STEP_STARTUP_RETRIES
      )
        throw error;
      await waitFrames(page, 1);
    }
  }
}

export type StepInputState = {
  heldKeys: Set<string>;
  pointerButtons: number;
  pointers: Map<number, { buttons: number; id: number; x: number; y: number }>;
  touchSession?: CDPSession;
};

export function playtestStepDrivesMovement(
  step: IPlaytestScenario["steps"][number],
  hasHeldInput: boolean,
): boolean {
  const hasNewInput = typeof step.press === "string"
    ? step.press.length > 0
    : (step.press?.length ?? 0) > 0
      || step.pointerPosition !== undefined
      || (step.pointers?.length ?? 0) > 0;
  return hasNewInput || (step.press === undefined && step.pointers === undefined && step.pointerPosition === undefined && hasHeldInput);
}

export function inputActive(inputState: StepInputState): boolean {
  return inputState.heldKeys.size > 0 || inputState.pointerButtons !== 0 || inputState.pointers.size > 0;
}

export async function setBrowserPointers(
  page: Page,
  inputState: StepInputState,
  next: NonNullable<IPlaytestScenario["steps"][number]["pointers"]>,
  viewport: IPlaytestScenario["viewport"],
): Promise<void> {
  const changes = reconcileBrowserPointers(inputState.pointers, next);
  if (next.some(({ buttons }) => buttons !== undefined && buttons !== 1)) {
    throw new Error("Browser touch injection supports buttons=1 only.");
  }
  inputState.touchSession ??= await page.context().newCDPSession(page);
  const session = inputState.touchSession;
  const points = (pointers: typeof next) => pointers.map((pointer) => ({
    force: 1,
    id: pointer.id,
    radiusX: 1,
    radiusY: 1,
    x: pointer.x * viewport.width,
    y: pointer.y * viewport.height,
  }));
  const removed = changes.filter(({ type }) => type === "pointerup").map(({ pointer }) => pointer);
  const added = changes.filter(({ type }) => type === "pointerdown").map(({ pointer }) => pointer);
  const moved = changes.filter(({ type }) => type === "pointermove").map(({ pointer }) => pointer);
  if (removed.length > 0) {
    await session.send("Input.dispatchTouchEvent", {
      touchPoints: points(removed),
      type: "touchEnd",
    });
  }
  if (added.length > 0) {
    await session.send("Input.dispatchTouchEvent", { touchPoints: points(added), type: "touchStart" });
  }
  if (moved.length > 0) {
    await session.send("Input.dispatchTouchEvent", { touchPoints: points(moved), type: "touchMove" });
  }
  inputState.pointers = new Map(next.map((pointer) => [pointer.id, {
    buttons: pointer.buttons ?? 1,
    id: pointer.id,
    x: pointer.x,
    y: pointer.y,
  }]));
}

export const POINTER_BUTTONS = [
  { button: "left", mask: 1 },
  { button: "right", mask: 2 },
  { button: "middle", mask: 4 },
] as const;

export async function setPointerButtons(
  page: Page,
  inputState: StepInputState,
  buttons: number,
): Promise<void> {
  const supportedMask = POINTER_BUTTONS.reduce((mask, entry) => mask | entry.mask, 0);
  if ((buttons & ~supportedMask) !== 0) {
    throw new Error(`Playtest pointer button mask ${buttons} is not supported by Playwright.`);
  }
  for (const entry of POINTER_BUTTONS) {
    if ((inputState.pointerButtons & entry.mask) !== 0 && (buttons & entry.mask) === 0) {
      await page.mouse.up({ button: entry.button });
    }
  }
  for (const entry of POINTER_BUTTONS) {
    if ((inputState.pointerButtons & entry.mask) === 0 && (buttons & entry.mask) !== 0) {
      await page.mouse.down({ button: entry.button });
    }
  }
  inputState.pointerButtons = buttons;
}

export async function samplePathPosition(
  bridge: IPlaytestBridgeClient | undefined,
  entity: string | undefined,
  positions: PlaytestVec3[],
): Promise<void> {
  if (bridge === undefined || entity === undefined) return;
  const snapshot = await bridge.sample({ entities: [entity] });
  const position = entityPosition(snapshot, entity);
  if (position !== undefined) positions.push(position);
}

export function accumulatedPathLength(positions: readonly PlaytestVec3[]): number | undefined {
  if (positions.length < 2) return undefined;
  return positions.slice(1).reduce(
    (total, position, index) => total + length(subtract(position, positions[index] ?? position)),
    0,
  );
}

export async function waitFrames(page: Page, frames: number): Promise<void> {
  if (frames <= 0) return;
  await page.evaluate((count) => new Promise<void>((resolveFrame) => {
    const schedule = (globalThis as unknown as {
      requestAnimationFrame(callback: () => void): number;
    }).requestAnimationFrame;
    let remaining = count;
    const next = () => {
      remaining -= 1;
      if (remaining <= 0) resolveFrame();
      else schedule(next);
    };
    schedule(next);
  }), frames);
}

export function observedEntityIds(scenario: IPlaytestScenario): string[] | undefined {
  if (isAnonymousMovementScenario(scenario)) return undefined;
  const ids = [...new Set([
    scenario.subject,
    scenario.assert?.movement?.entity,
    scenario.assert?.camera?.entity,
    scenario.assert?.camera?.follows,
    ...(scenario.assert?.visibility ?? []).map(({ entity }) => entity),
  ].filter((value): value is string => value !== undefined))];
  return ids.length > 0
    ? ids
    : scenario.assert?.movement === undefined
      ? []
      : undefined;
}

export function observedResourceIds(scenario: IPlaytestScenario): string[] {
  return [...new Set([
    ...(scenario.assert?.resources ?? []).map(({ id }) => id),
    ...(scenario.setup?.resources ?? []).map(({ id }) => id),
  ])];
}

