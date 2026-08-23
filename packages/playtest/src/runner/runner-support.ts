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
import { componentObservations, buildObservations, collectTrivialityOptOuts } from "./steps.js";
import { isAnonymousMovementScenario, observedMovementSample, entityPosition, entityRotation, subtract, resourceObservations, normalizedRuntimeDiagnostics, cameraReport, evaluateCamera } from "./sampling.js";
import type { RunnerConsoleEntry } from "./runner.js";
import type { IStandalonePlaytestReport, ILabeledPlaytestSample, IMovementSampleInterval } from "./runner.js";
// Extracted verbatim from runner.ts (PRD-182 Phase 4); do not edit semantics here.

export function preflightDisplay(
  config: Pick<IStandalonePlaytestConfig, "headless">,
  scenario: Pick<IPlaytestScenario, "artifacts" | "assert" | "steps">,
  environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): IPlaytestDiagnostic | undefined {
  const takesScreenshot = scenario.artifacts?.screenshots !== false
    || scenario.steps.some(({ screenshot }) => screenshot !== undefined);
  const evaluatesVisual = (scenario.assert?.visual?.length ?? 0) > 0;
  const evaluatesFramebuffer = scenario.assert?.framebufferCoverage !== undefined;
  if (platform !== "linux" || config.headless !== true || environment.DISPLAY || environment.WAYLAND_DISPLAY || (!takesScreenshot && !evaluatesVisual && !evaluatesFramebuffer)) {
    return undefined;
  }
  return {
    code: evaluatesFramebuffer
      ? "TN_PLAYTEST_FRAMEBUFFER_PIXELS_UNREADABLE"
      : "TN_PLAYTEST_HEADLESS_WEBGPU",
    message: evaluatesFramebuffer
      ? "Headless Linux cannot provide trusted per-frame WebGPU pixels without a display; use sh scripts/xvfb.sh <cmd>."
      : "Headless Linux visual runs may render WebGPU blank without a display; use sh scripts/xvfb.sh <cmd>.",
    severity: evaluatesFramebuffer ? "error" : "warning",
    suggestion: "Prefix the command with sh scripts/xvfb.sh.",
  };
}

/**
 * Capture-environment bake-in (report §2.10): the runner, not a wrapper, owns serialisation
 * and display provisioning for pixel-producing runs. Lock policy is decided from detected
 * concurrency (`CAPTURE_LOCK=1` forces it); lock state is printed either way so an agent can
 * tell its own failure from someone else's queue.
 */
export async function acquireRunnerCaptureLock(): Promise<ICaptureLease> {
  const lockRoot = defaultCaptureLockRoot();
  const policy = decideLockPolicy({
    captureLock: process.env.CAPTURE_LOCK,
    lockTimeoutMs: process.env.CAPTURE_LOCK_TIMEOUT_MS,
    othersAlive: detectCaptureConcurrency({ isProcessAlive, lockRoot }),
  });
  if (policy.mode === "none") {
    writeCaptureState({ captureLock: { detail: "no competing runner detected", mode: "none" } });
    return { release: async () => undefined };
  }
  // Emit queue visibility on change, not per poll — a contended 120 s wait must not spam stderr.
  let lastWaitingKey: string | undefined;
  return acquireCaptureLock({
    command: process.argv.slice(1).join(" ").slice(0, 200),
    isProcessAlive,
    lockRoot,
    onState: ({ holderSummary, mode, queueDepth }) => {
      if (mode === "waiting") {
        const key = `${holderSummary ?? ""}|${queueDepth}`;
        if (key === lastWaitingKey) return;
        lastWaitingKey = key;
      }
      writeCaptureState({ captureLock: mode === "held" ? { mode, queueDepth } : { holderSummary, mode, queueDepth } });
    },
    timeoutMs: policy.timeoutMs,
  });
}

export async function provideRunDisplay(): Promise<IProvidedDisplay> {
  const provided = await provideDisplay();
  writeCaptureState({
    captureDisplay: {
      ...(provided.display === undefined ? {} : { display: provided.display }),
      ...(provided.strategy.kind === "private-xvfb" ? { screen: provided.strategy.screen } : {}),
      strategy: provided.strategy.kind,
    },
  });
  return provided;
}

export function writeCaptureState(payload: Record<string, unknown>): void {
  process.stderr.write(`${JSON.stringify(payload)}\n`);
}

export function addPreflightDiagnostic(
  report: IStandalonePlaytestReport,
  diagnostic: IPlaytestDiagnostic | undefined,
): IStandalonePlaytestReport {
  return diagnostic === undefined ? report : { ...report, diagnostics: [diagnostic, ...report.diagnostics] };
}

export function buildReport(
  config: IStandalonePlaytestConfig,
  scenario: IPlaytestScenario,
  beforeSnapshot: IPlaytestObservationSnapshot | undefined,
  afterSnapshot: IPlaytestObservationSnapshot | undefined,
  consoleEntries: RunnerConsoleEntry[],
  networkEntries: Array<{ method: string; url: string }>,
  pathLength: number | undefined = undefined,
  hud: Record<string, { after?: unknown; before?: unknown }> = {},
  runtimeReady = true,
  visual: IPlaytestObservations["visual"] = undefined,
  labeledSamples: readonly ILabeledPlaytestSample[] = [],
  framebufferCoverage: IPlaytestFramebufferCoverageObservation | undefined = undefined,
  capture: IPlaytestCaptureProvenance | undefined = undefined,
  captureFailure: { code: "TN_CAPTURE_BLANK"; label: string; reason: string } | undefined = undefined,
  movementSamples: readonly IMovementSampleInterval[] = [],
): IStandalonePlaytestReport {
  const movementSample = isAnonymousMovementScenario(scenario)
    ? observedMovementSample(movementSamples)
    : undefined;
  const entity = scenario.assert?.movement?.entity
    ?? scenario.subject
    ?? movementSample?.entity
    ?? "";
  const movementBeforeSnapshot = movementSample?.before ?? (isAnonymousMovementScenario(scenario) ? undefined : beforeSnapshot);
  const movementAfterSnapshot = movementSample?.after ?? (isAnonymousMovementScenario(scenario) ? undefined : afterSnapshot);
  const beforePosition = entityPosition(movementBeforeSnapshot, entity);
  const afterPosition = entityPosition(movementAfterSnapshot, entity);
  const beforeRotation = entityRotation(movementBeforeSnapshot, entity);
  const afterRotation = entityRotation(movementAfterSnapshot, entity);
  const components = componentObservations(beforeSnapshot, afterSnapshot);
  const movementDelta = beforePosition === undefined || afterPosition === undefined
    ? undefined
    : subtract(afterPosition, beforePosition);
  const distance = movementDelta === undefined ? 0 : length(movementDelta);
  const performanceSeries = scenario.assert?.performance === undefined
    ? undefined
    : afterSnapshot?.runtimeDiagnosticsSeries ?? beforeSnapshot?.runtimeDiagnosticsSeries;
  const diagnostics: IPlaytestDiagnostic[] = [];
  if (runtimeReady === false && scenario.assert?.diagnostics?.runtimeReady === true) {
    diagnostics.push({
      code: "TN_PLAYTEST_RUNTIME_NOT_READY",
      message: "The page did not expose a ready canvas after the warmup window.",
      severity: "error",
      suggestion: "Fix runtime startup so the page reaches DOM-ready state and creates a canvas before the playtest assertion.",
    });
  }
  const base: IPlaytestReport = {
    ...(afterPosition === undefined ? {} : { after: { frame: scenario.steps.length, position: afterPosition, ...(afterRotation === undefined ? {} : { rotation: afterRotation }), tick: afterSnapshot?.clock.tick ?? 0 } }),
    ...(beforePosition === undefined ? {} : { before: { frame: 0, position: beforePosition, ...(beforeRotation === undefined ? {} : { rotation: beforeRotation }), tick: beforeSnapshot?.clock.tick ?? 0 } }),
    diagnostics,
    diagnosticsPolicy: resolveDiagnosticsPolicy(scenario.assert?.diagnostics),
    distance,
    entity,
    expectMoved: scenario.assert?.movement?.minDistance !== undefined,
    frames: scenario.steps.reduce((total, step) => total + (step.holdFrames ?? step.waitFrames ?? step.holdTicks ?? step.waitTicks ?? 1), 0),
    trivialityOptOuts: [],
    ...(movementDelta === undefined ? {} : { movementDelta }),
    ...(pathLength === undefined ? {} : { pathLength }),
    observations: buildObservations({
      console: consoleEntries,
      ...(components === undefined
        ? {}
        : { components }),
      ...(labeledSamples.length === 0
        ? {}
        : {
            componentSeries: labeledSamples.map(({ label, snapshot }) => ({ label, snapshots: snapshot.components ?? {}, tick: snapshot.clock.tick ?? 0 })),
            resourceSeries: labeledSamples.map(({ label, snapshot }) => ({ label, snapshots: snapshot.resources ?? {}, tick: snapshot.clock.tick ?? 0 })),
            signalSeries: labeledSamples.map(({ label, signals, snapshot }) => ({ label, signals, tick: snapshot.clock.tick ?? 0 })),
            signals: labeledSamples.flatMap(({ signals }) => signals),
          }),
      hud,
      ...(framebufferCoverage === undefined ? {} : { framebufferCoverage }),
      network: networkEntries,
      ...(performanceSeries === undefined ? {} : { performanceSeries }),
      resources: resourceObservations(beforeSnapshot, afterSnapshot),
      ...(beforeSnapshot?.gameplay === undefined
        && afterSnapshot?.gameplay === undefined
        && labeledSamples.every(({ snapshot }) => snapshot.gameplay === undefined)
        ? {}
        : {
            runtimeObservations: {
              ...(beforeSnapshot?.gameplay === undefined ? {} : { gameplayBefore: beforeSnapshot.gameplay }),
              ...(afterSnapshot?.gameplay === undefined ? {} : { gameplay: afterSnapshot.gameplay }),
              ...(labeledSamples.every(({ snapshot }) => snapshot.gameplay === undefined)
                ? {}
                : {
                    gameplaySeries: labeledSamples.flatMap(({ label, snapshot }) => snapshot.gameplay === undefined
                      ? []
                      : [{ gameplay: snapshot.gameplay, label, tick: snapshot.clock.tick ?? 0 }]),
                  }),
            },
          }),
      ...(afterSnapshot?.physicsDebugSeries === undefined
        ? {}
        : { physicsDebugSeries: afterSnapshot.physicsDebugSeries }),
      ...(beforeSnapshot?.physicsDebugSeries?.[0]?.snapshot === undefined
        ? {}
        : { physicsDebugBefore: beforeSnapshot.physicsDebugSeries[0].snapshot }),
      runtimeDiagnostics: normalizedRuntimeDiagnostics(afterSnapshot, scenario, consoleEntries),
      ...(beforeSnapshot === undefined
        ? {}
        : { runtimeDiagnosticsBefore: normalizedRuntimeDiagnostics(beforeSnapshot, scenario, consoleEntries) }),
      ...(visual === undefined ? {} : { visual }),
    }),
  };
  if (scenario.assert?.camera !== undefined) {
    base.follow = cameraReport(scenario, beforeSnapshot, afterSnapshot);
  }
  const evaluated = evaluateRichPlaytestAssertions({ report: base, scenario });
  const cameraResult = evaluateCamera(scenario, afterSnapshot);
  const assertionResults = [...evaluated.assertions, ...(cameraResult === undefined ? [] : [cameraResult])];
  const trivialityOptOuts = collectTrivialityOptOuts(assertionResults);
  const allDiagnostics = [...diagnostics, ...evaluated.diagnostics];
  // Scoped to WebGPU because that is where the fallback is silent: a WebGL context reports its
  // software renderer in the same provenance field, but the browser never pretends otherwise
  // and the repo already runs WebGL fixtures headless on purpose.
  const softwareAdapter =
    capture?.rendererKind === "webgpu" ? softwareAdapterName(capture.adapter) : undefined;
  if (softwareAdapter !== undefined && config.allowSoftwareAdapter !== true) {
    allDiagnostics.push({
      code: "TN_PLAYTEST_SOFTWARE_ADAPTER",
      message: `WebGPU was served by a software adapter: '${softwareAdapter}'. Nothing errored, so every result in this run is a CPU rasteriser's.`,
      severity: "error",
      suggestion:
        "Run with --headed under a display and --browser-recipe webgpu so Chromium reaches the GPU driver, or pass --allow-software to accept the fallback deliberately.",
    });
  }
  if (captureFailure !== undefined) {
    allDiagnostics.push({
      code: captureFailure.code,
      message: `Visual capture '${captureFailure.label}' was blank: ${captureFailure.reason}.`,
      severity: "error",
      suggestion: "Inspect the browser display and GPU adapter before treating this run as render evidence.",
    });
  }
  if (cameraResult?.pass === false) {
    allDiagnostics.push({
      code: "TN_PLAYTEST_CAMERA_ASSERTION_FAILED",
      message: "Camera did not satisfy the declared follow or viewport assertion.",
      severity: "error",
      suggestion: "Check camera registration, follow distance, and target framing.",
    });
  }
  return {
    ...base,
    artifactDirectory: config.artifactDirectory,
    ...(capture === undefined ? {} : { capture }),
    assertionResults,
    diagnostics: allDiagnostics,
    pass: assertionResults.every(({ pass }) => pass) && allDiagnostics.every(({ severity }) => severity !== "error"),
    runtime: "web",
    scenario: scenario.name,
    target: scenario.target,
    trivialityOptOutCount: trivialityOptOuts.length,
    trivialityOptOuts,
    url: config.url,
  };
}

