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
  type IPlaytestSetupApplication,
  type IPlaytestSetupRecord,
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
import { HOST_PLAYTEST_OBSERVATION_FIELDS, STANDALONE_PLAYTEST_OBSERVATION_FIELDS } from "./observationFields.js";
// Extracted verbatim from runner.ts (PRD-182 Phase 4); do not edit semantics here.
import { entityPosition, subtract, isAnonymousMovementScenario } from "./sampling.js";
import { aimAngles, yawPitchToQuaternion } from "../scenario/orientation.js";
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
  for (const field of [...STANDALONE_PLAYTEST_OBSERVATION_FIELDS, ...HOST_PLAYTEST_OBSERVATION_FIELDS]) {
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
    // A failed run still names what it was asked to place, with nothing applied — an
    // overridden spawn must be visible in the report even when the run never got green.
    ...(scenario.setup === undefined ? {} : { setup: { applied: [], requested: requestedSetupRecords(scenario) } }),
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

/**
 * Every override the scenario asks for, named by kind and entity. This is the honest-
 * reporting ledger: it rides into the run report as `requested`, next to `applied`.
 */
export function requestedSetupRecords(scenario: IPlaytestScenario): IPlaytestSetupRecord[] {
  const setup = scenario.setup;
  if (setup === undefined) return [];
  const asJson = (value: unknown): IPlaytestSetupRecord["value"] => value as IPlaytestSetupRecord["value"];
  return [
    ...(setup.spawn === undefined
      ? []
      : [{ entity: scenario.subject, kind: "spawn" as const, value: asJson(setup.spawn) }]),
    ...(setup.aim === undefined
      ? []
      : [{ entity: scenario.subject, kind: "aim" as const, value: asJson(setup.aim) }]),
    ...(setup.entities ?? []).map(({ entity, position, rotation, scale }) => ({
      entity,
      kind: "entities" as const,
      value: asJson({
        ...(position === undefined ? {} : { position }),
        ...(rotation === undefined ? {} : { rotation }),
        ...(scale === undefined ? {} : { scale }),
      }),
    })),
    ...(setup.place ?? []).map(({ at, entity, facing, frozen, lookAt }) => ({
      entity,
      kind: "place" as const,
      value: asJson({
        at,
        ...(facing === undefined ? {} : { facing }),
        ...(frozen === undefined ? {} : { frozen }),
        ...(lookAt === undefined ? {} : { lookAt }),
      }),
    })),
    ...(setup.resources ?? []).map(({ id, value }) => ({ entity: id, kind: "resources" as const, value: asJson(value) })),
  ];
}

function pointToTuple(point: { x: number; y: number; z: number }): PlaytestVec3 {
  return [point.x, point.y, point.z];
}

/** Compose the full bridge request: verbatim entities/resources plus spawn/aim/place. */
async function composeSetupRequest(
  bridge: Pick<IPlaytestBridgeClient, "sample">,
  scenario: IPlaytestScenario,
): Promise<IPlaytestSetupRequest> {
  const request = setupRequest(scenario);
  const setup = scenario.setup;
  if (setup === undefined || (setup.spawn === undefined && setup.aim === undefined && (setup.place?.length ?? 0) === 0)) {
    return request;
  }
  const entities = [...(request.entities ?? [])];
  const subject = scenario.subject;
  let sampledSubjectPosition: PlaytestVec3 | undefined;
  const sampleSubject = async (): Promise<PlaytestVec3> => {
    if (sampledSubjectPosition !== undefined) return sampledSubjectPosition;
    const snapshot = await bridge.sample({ entities: [subject ?? ""] });
    const position = entityPosition(snapshot, subject ?? "");
    if (position === undefined) {
      throw new Error(
        `Subject '${subject}' was not observed, so its current height cannot be preserved for setup.spawn; declare spawn.y explicitly or register the subject with the bridge.`,
      );
    }
    sampledSubjectPosition = position;
    return position;
  };
  if (setup.spawn !== undefined) {
    // Explicit presence semantics: an absent y preserves the game's own height (its eye
    // or ground line); it is never silently defaulted to zero.
    const y = setup.spawn.y ?? (await sampleSubject())[1];
    entities.push({
      entity: subject!,
      transform: { position: [setup.spawn.x, y, setup.spawn.z] },
    });
  }
  if (setup.aim !== undefined) {
    entities.push({
      entity: subject!,
      transform: { rotation: yawPitchToQuaternion(setup.aim.yaw, setup.aim.pitch) },
    });
  }
  for (const place of setup.place ?? []) {
    let rotation: [number, number, number, number] | undefined;
    if (place.lookAt !== undefined) {
      const angles = aimAngles(pointToTuple(place.at), pointToTuple(place.lookAt));
      rotation = yawPitchToQuaternion(angles.yaw, angles.pitch);
    } else if (place.facing !== undefined) {
      rotation = yawPitchToQuaternion(place.facing.yaw, 0);
    }
    entities.push({
      entity: place.entity,
      ...(place.frozen === undefined ? {} : { frozen: place.frozen }),
      transform: {
        position: pointToTuple(place.at),
        ...(rotation === undefined ? {} : { rotation }),
      },
    });
  }
  return { ...request, entities };
}

/**
 * Apply every declared placement through the bridge's setup channel and report what
 * applied. Any entry that cannot apply fails the run with the reason named — a partial
 * or skipped placement is never reported green.
 */
export async function applyScenarioSetup(
  bridge: Pick<IPlaytestBridgeClient, "applySetup" | "sample">,
  scenario: IPlaytestScenario,
): Promise<IPlaytestSetupApplication> {
  const requested = requestedSetupRecords(scenario);
  try {
    await bridge.applySetup(await composeSetupRequest(bridge, scenario));
    return { applied: requested, requested };
  } catch (error) {
    if ((error as object) instanceof PlaytestBridgeError) throw error;
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_SETUP_UNAPPLIED",
      `Scenario setup could not apply: ${error instanceof Error ? error.message : String(error)}`,
      "Register every placed entity with the playtest bridge before the run, or correct the placement.",
    ));
  }
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
  subject?: string,
): Promise<IRunStepSamples> {
  if (step.kind === "click") {
    await executeClickStep(page, bridge, step, viewport);
    const frames = Math.max(step.waitFrames ?? 0, step.waitTicks ?? 0, 1);
    if (bridge?.description.capabilities.includes("runtime.fixedStep") === true && step.waitTicks !== undefined) {
      await advanceFixedStep(page, bridge, step.waitTicks);
    } else {
      await waitFrames(page, frames);
    }
    return { afterInput: undefined, afterStep: undefined, inputDriven: false };
  }
  if (step.kind === "aimAt") {
    await executeAimAtStep(bridge, step, subject);
  }
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

async function executeClickStep(
  page: Page,
  bridge: IPlaytestBridgeClient | undefined,
  step: IPlaytestScenario["steps"][number],
  viewport: IPlaytestScenario["viewport"],
): Promise<void> {
  const target = step.at;
  if (target === undefined) {
    throw clickError(
      "Click step has no target.",
      "Declare at as viewport pixels ({ x, y }) or a registered entity ({ entity }).",
    );
  }
  const point = "entity" in target
    ? await entityClickPoint(bridge, target.entity)
    : { x: target.x, y: target.y };
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0
    || point.x > viewport.width || point.y > viewport.height) {
    throw clickError(
      `Click target resolves outside the ${viewport.width}x${viewport.height} viewport at (${point.x}, ${point.y}).`,
      "Use viewport pixel coordinates inside the scenario viewport, or register an entity visible to the bridge.",
    );
  }
  if (typeof page.mouse?.move !== "function" || typeof page.mouse?.down !== "function" || typeof page.mouse?.up !== "function") {
    throw clickError(
      "The selected playtest target has no browser pointer transport for a click step.",
      "Run the scenario on a target with pointer input, or replace click with a supported input step.",
    );
  }
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button: "left" });
  await page.mouse.up({ button: "left" });
}

async function entityClickPoint(
  bridge: IPlaytestBridgeClient | undefined,
  entity: string,
): Promise<{ x: number; y: number }> {
  if (bridge === undefined) {
    throw clickError(
      `Click target entity '${entity}' cannot be resolved without a playtest bridge.`,
      "Install the playtest bridge and register the clickable entity, or use explicit viewport pixels.",
    );
  }
  const snapshot = await bridge.sample({ entities: [entity] });
  const bounds = snapshot.entities?.find((candidate) => candidate.id === entity)?.bounds;
  if (bounds === undefined) {
    throw clickError(
      `Click target entity '${entity}' has no observed screen bounds.`,
      "Register a visible entity with the playtest bridge, or use explicit viewport pixels.",
    );
  }
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function clickError(message: string, instruction: string): PlaytestBridgeError {
  return new PlaytestBridgeError(playtestDiagnostic(
    "TN_PLAYTEST_UNSUPPORTED_ON_TARGET",
    message,
    instruction,
  ));
}

/**
 * The runner-native aim: yaw/pitch are computed from the subject's CURRENT sampled
 * position toward the target and applied through the setup channel as quaternion data.
 * No CDP mouse events, no OS-focus dependency, and one scenario file can hold several
 * labelled aims — that is why zone contrast no longer needs two files.
 */
async function executeAimAtStep(
  bridge: IPlaytestBridgeClient | undefined,
  step: IPlaytestScenario["steps"][number],
  subject?: string,
): Promise<void> {
  const fail = (message: string, instruction: string): PlaytestBridgeError =>
    new PlaytestBridgeError(playtestDiagnostic("TN_PLAYTEST_SETUP_UNAPPLIED", message, instruction));
  if (bridge === undefined) {
    throw fail(
      "Step kind 'aimAt' samples and steers the subject through the playtest bridge, but none is installed.",
      "Install the playtest bridge, or replace the aimAt step with an explicit setup rotation.",
    );
  }
  if (subject === undefined) {
    throw fail(
      "Step kind 'aimAt' has no subject to aim; the scenario must declare one.",
      "Declare scenario.subject so aimAt knows which player start to steer.",
    );
  }
  try {
    const snapshot = await bridge.sample({ entities: [subject] });
    const from = entityPosition(snapshot, subject);
    if (from === undefined) {
      throw new Error(`the subject '${subject}' was not observed, so no aim direction can be computed`);
    }
    const target = step.target;
    if (target === undefined) {
      // Unreachable through the validator, which requires an aimAt target at load.
      throw new Error("the aimAt step declared no target");
    }
    let targetPoint: PlaytestVec3;
    if ("entity" in target) {
      const targetSnapshot = await bridge.sample({ entities: [target.entity] });
      const resolved = entityPosition(targetSnapshot, target.entity);
      if (resolved === undefined) {
        throw new Error(`the aim target entity '${target.entity}' was not observed`);
      }
      targetPoint = resolved;
    } else {
      // An xz target names a horizontal direction at the subject's own height unless an
      // explicit pitch overrides it.
      targetPoint = [target.x, from[1], target.z];
    }
    const derived = aimAngles(from, targetPoint);
    const rotation = yawPitchToQuaternion(derived.yaw, step.pitch ?? derived.pitch);
    await bridge.applySetup({ entities: [{ entity: subject, transform: { rotation } }] });
  } catch (error) {
    if ((error as object) instanceof PlaytestBridgeError) throw error;
    throw fail(
      `The aimAt step could not apply: ${error instanceof Error ? error.message : String(error)}`,
      "Register the subject and any aim-target entity with the bridge, and keep the target off the subject's own position.",
    );
  }
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
  if (step.kind === "click") return false;
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

export async function sampleAfterTransition(
  page: Page,
  bridge: IPlaytestBridgeClient | undefined,
  request: IPlaytestSampleRequest,
): Promise<IPlaytestObservationSnapshot | undefined> {
  if (bridge === undefined) return undefined;
  // UI intents cross a message boundary before the game performs its scene goto. Give that
  // boundary one rendered frame to settle before recording the terminal resources snapshot.
  await waitFrames(page, 1);
  return bridge.sample(request);
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
