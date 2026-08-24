import { ManagedServerError } from "./runner.js";
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
import type { IMovementSampleInterval, RunnerConsoleEntry } from "./runner.js";
// Extracted verbatim from runner.ts (PRD-182 Phase 4); do not edit semantics here.
export async function sampleHud(page: Page, assertions: readonly IPlaytestPathAssertion[]): Promise<Record<string, unknown>> {
  if (assertions.length === 0) return {};
  return page.evaluate((requestedAssertions) => Object.fromEntries(requestedAssertions.flatMap(({ id, path }) => {
    const element = path === undefined
      ? document.getElementById(id)
      : (() => {
          try {
            return document.querySelector(path);
          } catch {
            return null;
          }
        })();
    if (element === null) return [];
    const text = element.textContent?.trim() ?? "";
    const rawValue = element.getAttribute("data-value");
    const value = rawValue === null ? undefined : Number.isFinite(Number(rawValue)) ? Number(rawValue) : rawValue;
    const snapshot = value === undefined ? text : value;
    return [[id, path === undefined ? snapshot : { [path]: snapshot }] as const];
  })), assertions.map(({ id, path }) => ({ id, ...(path === undefined ? {} : { path }) })));
}

export function pairObservations(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { after?: unknown; before?: unknown }> {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Object.fromEntries([...ids].map((id) => [id, {
    ...(before[id] === undefined ? {} : { before: before[id] }),
    ...(after[id] === undefined ? {} : { after: after[id] }),
  }]));
}

export function entityPosition(snapshot: IPlaytestObservationSnapshot | undefined, id: string): PlaytestVec3 | undefined {
  return snapshot?.entities?.find((entity) => entity.id === id)?.transform?.position;
}

export function isAnonymousMovementScenario(scenario: IPlaytestScenario): boolean {
  return scenario.assert?.movement !== undefined
    && scenario.assert.movement.entity === undefined
    && scenario.subject === undefined;
}

export function observedMovementSample(
  samples: readonly IMovementSampleInterval[],
): { after: IPlaytestObservationSnapshot; before: IPlaytestObservationSnapshot; entity: string } | undefined {
  const inputOff = samples.filter(({ inputDriven }) => !inputDriven);
  if (inputOff.length === 0) return undefined;
  return samples
    .filter(({ inputDriven }) => inputDriven)
    .flatMap((sample) => observedMovementEntities(sample.before, sample.after).flatMap(({ id, distance }) => {
      const inputOffBaseline = inputOff.every((offSample) => {
        const offEntity = observedMovementEntities(offSample.before, offSample.after).find(({ id: offId }) => offId === id);
        return offEntity !== undefined && offEntity.distance === 0 && movementRate(offSample, id) !== undefined;
      });
      const inputOnRate = movementRate(sample, id);
      return !inputOffBaseline || inputOnRate === undefined || inputOnRate <= 0
        ? []
        : [{ ...sample, distance, entity: id, contrast: inputOnRate }];
    }))
    .sort((left, right) => right.distance - left.distance || right.contrast - left.contrast || left.entity.localeCompare(right.entity))[0];
}

export function observedMovementEntities(
  before: IPlaytestObservationSnapshot,
  after: IPlaytestObservationSnapshot,
): Array<{ distance: number; id: string }> {
  const beforeEntities = new Map(
    (before.entities ?? [])
      .filter(({ transform }) => transform?.position !== undefined)
      .map(({ id, transform }) => [id, transform!.position!] as const),
  );
  return (after.entities ?? []).flatMap((entity) => {
    const beforePosition = beforeEntities.get(entity.id);
    const afterPosition = entity.transform?.position;
    return beforePosition === undefined || afterPosition === undefined || entity.visible === false
      ? []
      : [{ distance: length(subtract(afterPosition, beforePosition)), id: entity.id }];
  });
}

export function movementRate(sample: IMovementSampleInterval, entity: string): number | undefined {
  const beforePosition = entityPosition(sample.before, entity);
  const afterPosition = entityPosition(sample.after, entity);
  if (beforePosition === undefined || afterPosition === undefined) return undefined;
  const duration = movementDuration(sample);
  return duration === undefined ? undefined : length(subtract(afterPosition, beforePosition)) / duration;
}

export function movementDuration(sample: IMovementSampleInterval): number | undefined {
  if (sample.before.clock.mode !== sample.after.clock.mode) return undefined;
  const duration = sample.before.clock.mode === "fixed-step"
    ? positiveFiniteDelta(sample.before.clock.tick, sample.after.clock.tick)
    : positiveFiniteDelta(sample.before.clock.timeMs, sample.after.clock.timeMs);
  return duration;
}

export function positiveFiniteDelta(before: number | undefined, after: number | undefined): number | undefined {
  if (
    typeof before !== "number"
    || typeof after !== "number"
    || !Number.isFinite(before)
    || !Number.isFinite(after)
  ) return undefined;
  const delta = after - before;
  return Number.isFinite(delta) && delta > 0 ? delta : undefined;
}

export function entityRotation(snapshot: IPlaytestObservationSnapshot | undefined, id: string): [number, number, number, number] | undefined {
  return snapshot?.entities?.find((entity) => entity.id === id)?.transform?.rotation;
}

export function resourceObservations(before: IPlaytestObservationSnapshot | undefined, after: IPlaytestObservationSnapshot | undefined) {
  const ids = new Set([...Object.keys(before?.resources ?? {}), ...Object.keys(after?.resources ?? {})]);
  return Object.fromEntries([...ids].map((id) => [id, { before: before?.resources?.[id], after: after?.resources?.[id] }]));
}

/**
 * A published diagnostic that is unmistakably a *readout* rather than an error.
 *
 * The bridge's `diagnostics` channel is typed `() => JsonValue[]` and the generated project
 * AGENTS.md says it "returns current runtime diagnostics", so a game publishes its debug HUD
 * through it — that is the documented use. Every entry then landed in `recentRuntimeErrors`, and
 * a proof with `noRuntimeDiagnostics` failed the build for owning a frame counter. Round 9 lost a
 * sealed scenario to `{id:"fps",label:"FPS",value:30}` being counted as a runtime error.
 *
 * This does **not** guess. Ambiguous entries stay errors, because this package fails closed and an
 * error counter that quietly stops counting is the exact defect it exists to prevent. Only the
 * unambiguous readout shape — a labelled scalar, carrying no error marker — is reclassified, and
 * nothing is dropped: readouts move to `runtimeReadouts` on the same object and stay observable.
 */
export function isRuntimeReadout(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
  const record = entry as Record<string, unknown>;
  if (record.severity === "error" || record.error !== undefined) return false;
  if (typeof record.type === "string" && ["assert", "error", "pageerror"].includes(record.type)) return false;
  const value = record.value;
  return (
    typeof record.label === "string" &&
    (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
  );
}

export function normalizedRuntimeDiagnostics(
  snapshot: IPlaytestObservationSnapshot | undefined,
  scenario: IPlaytestScenario,
  consoleEntries: RunnerConsoleEntry[],
): { recentRuntimeErrors: unknown[]; runtimeReadouts: unknown[]; scene: { renderedEntities: unknown[] } } {
  const published = snapshot?.diagnostics ?? [];
  return {
    recentRuntimeErrors: [
      ...published.filter((entry) => !isRuntimeReadout(entry)),
      ...consoleEntries.filter(({ source, type }) => source !== "browser-console" && ["assert", "error", "pageerror"].includes(type)),
    ],
    runtimeReadouts: published.filter(isRuntimeReadout),
    scene: {
      renderedEntities: (snapshot?.entities ?? []).map((entity) => ({
        id: entity.id,
        projectedBounds: entity.bounds === undefined ? undefined : pixelBoundsToNdc(entity.bounds, scenario.viewport),
        visible: entity.visible,
      })),
    },
  };
}

export async function readCaptureProvenance(
  page: Page,
  config: IStandalonePlaytestConfig,
  scenario: IPlaytestScenario,
): Promise<IPlaytestCaptureProvenance> {
  const observed = await page.evaluate(async () => {
    type Adapter = {
      features?: Iterable<string>;
      info?: Record<string, unknown>;
      limits?: Record<string, number | undefined>;
      requestAdapterInfo?: () => Promise<Record<string, unknown>>;
    };
    const gpu = (globalThis.navigator as Navigator & { gpu?: { requestAdapter(): Promise<Adapter | null> } }).gpu;
    const adapter = gpu === undefined ? null : await gpu.requestAdapter().catch(() => null);
    const infoCandidate = adapter?.info;
    const legacyInfo = await adapter?.requestAdapterInfo?.().catch(() => undefined);
    const info = infoCandidate === undefined || Object.keys(infoCandidate).length === 0
      ? legacyInfo ?? infoCandidate
      : infoCandidate;
    const adapterIdentityKeys = ["architecture", "description", "device", "vendor"];
    const adapterIdentityEntries: Array<[string, string]> = info === undefined
      ? []
      : adapterIdentityKeys.flatMap((key) => {
          const value = info[key];
          const text = String(value ?? "");
          return text.length === 0 ? [] : [[key, text]];
        });
    const webgpuAdapterEntries = [...adapterIdentityEntries];
    if (adapterIdentityEntries.length > 0 && adapter?.features !== undefined) {
      const features = [...adapter.features].map(String).sort();
      if (features.length > 0) webgpuAdapterEntries.push(["features", features.join(",")]);
    }
    if (adapterIdentityEntries.length > 0) {
      for (const key of ["maxBindGroups", "maxTextureDimension2D", "maxStorageBufferBindingSize"]) {
        const value = adapter?.limits?.[key];
        if (typeof value === "number" && Number.isFinite(value)) webgpuAdapterEntries.push([`limit.${key}`, String(value)]);
      }
    }
    const webgpuAdapterInfo = adapterIdentityEntries.length === 0
      ? undefined
      : Object.fromEntries(webgpuAdapterEntries);
    const canvas = document.querySelector("canvas");
    const engine = canvas?.getAttribute("data-engine")?.toLowerCase() ?? "";
    let rendererKind: "webgl" | "webgpu" | undefined;
    if (engine.includes("webgpu")) rendererKind = "webgpu";
    else if (engine.includes("webgl")) rendererKind = "webgl";
    else if (adapter !== null && canvas !== null) {
      try {
        if (canvas.getContext("webgpu") !== null) rendererKind = "webgpu";
      } catch {
        // A canvas can reject a second context request; the adapter and engine marker remain authoritative.
      }
    }
    let webglAdapterInfo: Record<string, string> | undefined;
    if (rendererKind === undefined || rendererKind === "webgl") {
      try {
        const context = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
        if (context !== null && context !== undefined) {
          rendererKind = "webgl";
          const debugInfo = context.getExtension("WEBGL_debug_renderer_info") as {
            UNMASKED_RENDERER_WEBGL: number;
            UNMASKED_VENDOR_WEBGL: number;
          } | null;
          const vendor = String(context.getParameter(debugInfo?.UNMASKED_VENDOR_WEBGL ?? context.VENDOR) ?? "");
          const renderer = String(context.getParameter(debugInfo?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER) ?? "");
          const webglEntries: Array<[string, string]> = [
            ["renderer", renderer],
            ["vendor", vendor],
          ];
          webglAdapterInfo = Object.fromEntries(webglEntries.filter(([, value]) => value.length > 0));
        }
      } catch {
        // Report the missing renderer or adapter below instead of guessing.
      }
    }
    return {
      adapter: rendererKind === "webgl" ? webglAdapterInfo : webgpuAdapterInfo,
      rendererKind,
    };
  });
  if (observed.adapter === undefined || Object.keys(observed.adapter).length === 0) {
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_CAPTURE_PROVENANCE_MISSING",
      `Visual capture could not read a renderer adapter description (kind=${observed.rendererKind ?? "unknown"}).`,
      "Run the visual playtest with a working GPU/WebGPU adapter or WebGL renderer; the runner will not write unknown adapter provenance.",
    ));
  }
  if (observed.rendererKind === undefined) {
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_CAPTURE_PROVENANCE_MISSING",
      "Visual capture could not identify the page renderer kind.",
      "Expose a WebGPU/WebGL canvas before capturing the visual artifact, then rerun the playtest.",
    ));
  }
  return {
    adapter: observed.adapter,
    browserArgs: resolveBrowserArguments(config.browserArgs),
    captureMethod: "page.screenshot",
    rendererKind: observed.rendererKind,
    target: scenario.target,
    viewport: { ...scenario.viewport },
  };
}

export function pixelBoundsToNdc(bounds: { height: number; width: number; x: number; y: number }, viewport: { height: number; width: number }) {
  return {
    max: [2 * (bounds.x + bounds.width) / viewport.width - 1, 1 - 2 * bounds.y / viewport.height],
    min: [2 * bounds.x / viewport.width - 1, 1 - 2 * (bounds.y + bounds.height) / viewport.height],
  };
}

export function cameraReport(scenario: IPlaytestScenario, before: IPlaytestObservationSnapshot | undefined, after: IPlaytestObservationSnapshot | undefined) {
  const assertion = scenario.assert?.camera;
  const cameraId = assertion?.entity ?? "camera";
  const targetId = assertion?.follows ?? scenario.subject ?? "";
  const beforeCamera = entityPosition(before, cameraId);
  const afterCamera = entityPosition(after, cameraId);
  const target = entityPosition(after, targetId);
  return {
    ...(afterCamera === undefined ? {} : { after: { frame: scenario.steps.length, position: afterCamera, tick: after?.clock.tick ?? 0 } }),
    ...(beforeCamera === undefined ? {} : { before: { frame: 0, position: beforeCamera, tick: before?.clock.tick ?? 0 } }),
    entity: cameraId,
    separation: afterCamera === undefined || target === undefined ? undefined : length(subtract(afterCamera, target)),
    within: assertion?.within ?? Number.POSITIVE_INFINITY,
  };
}

export function evaluateCamera(scenario: IPlaytestScenario, snapshot: IPlaytestObservationSnapshot | undefined): IPlaytestAssertionResult | undefined {
  const assertion = scenario.assert?.camera;
  if (assertion === undefined) return undefined;
  const cameraId = assertion.entity ?? "camera";
  const targetId = assertion.follows ?? scenario.subject ?? "";
  const camera = entityPosition(snapshot, cameraId);
  const targetEntity = snapshot?.entities?.find(({ id }) => id === targetId);
  const target = targetEntity?.transform?.position;
  const separation = camera === undefined || target === undefined ? undefined : length(subtract(camera, target));
  return {
    details: { camera: cameraId, separation, target: targetId, visible: targetEntity?.visible },
    id: "camera",
    pass: (assertion.within === undefined || (separation !== undefined && separation <= assertion.within))
      && (assertion.targetInViewport !== true || targetEntity?.visible === true),
  };
}

export function subtract(a: PlaytestVec3, b: PlaytestVec3): PlaytestVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function length(vector: PlaytestVec3): number {
  return Math.hypot(...vector);
}

export function safePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

export function startManagedServer(config: IStandalonePlaytestConfig, dynamicPort?: number): ChildProcess {
  const port = dynamicPort ?? managedPort(config);
  const server = spawn(resolveManagedServerCommand(config, dynamicPort), {
    cwd: resolve(config.server!.cwd ?? config.projectPath),
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      ...(port === undefined ? {} : { PORT: String(port) }),
    },
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return server;
}

export function resolveManagedServerCommand(
  config: IStandalonePlaytestConfig,
  dynamicPort?: number,
): string {
  const port = dynamicPort ?? managedPort(config);
  return port === undefined ? config.server!.command : substituteManagedPort(config.server!.command, port);
}

export function substituteManagedPort(command: string, port: number): string {
  return command
    .replace(/(?:\$\{PORT\}|\$PORT\b)/gu, String(port))
    .replace(/(--port(?:=|\s+))(?=--|$)/u, `$1${port} `);
}

export async function findFreePort(): Promise<number> {
  const probe = createServer();
  return new Promise<number>((resolvePort, reject) => {
    const rejectProbe = (error: Error): void => {
      probe.close();
      reject(error);
    };
    probe.once("error", rejectProbe);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        rejectProbe(new Error("Could not determine the free managed server port."));
        return;
      }
      probe.close((error) => {
        if (error !== undefined) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

export function managedPort(config: IStandalonePlaytestConfig): number | undefined {
  if (config.port !== undefined && config.port > 0) return config.port;
  try {
    const parsed = new URL(config.url);
    return parsed.port === "" ? undefined : Number(parsed.port);
  } catch {
    return undefined;
  }
}

export function withPort(url: string, port: number): string {
  const parsed = new URL(url);
  parsed.port = String(port);
  const result = parsed.toString();
  return url.endsWith("/") ? result : result.replace(/\/$/u, "");
}

/**
 * A dev server can reload the page out from under the handshake — Vite issues a full reload
 * when it discovers a dependency it has not pre-bundled, which is common on the first load
 * after a server was killed mid-write. Playwright reports that as "Execution context was
 * destroyed", and it used to escape as the runner's unexplained-error catch-all.
 */
export const PAGE_NAVIGATED_PATTERN =
  /Execution context was destroyed|frame (?:was )?detached|Target (?:page|closed)/iu;

export const TEARDOWN_TIMED_OUT = Symbol("teardown-timed-out");

/**
 * Await one teardown step, but never longer than `timeoutMs`. Returns true when the step
 * finished (or there was nothing to do) and false when it ran out of time, so the caller can
 * escalate. Teardown runs after the report is written, so a step that hangs costs the process
 * its exit rather than costing the run its result.
 */
export async function boundedTeardownStep(
  step: Promise<unknown> | undefined,
  timeoutMs: number,
): Promise<boolean> {
  if (step === undefined) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TEARDOWN_TIMED_OUT>((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout(TEARDOWN_TIMED_OUT), timeoutMs);
  });
  try {
    return (await Promise.race([step.catch(() => undefined), timeout])) !== TEARDOWN_TIMED_OUT;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Await a resource that is still being created, but never longer than `timeoutMs`. Returns the
 * value when it arrives and `undefined` when it fails or runs out of time.
 *
 * Teardown needs this because a signal can land while the resource is mid-construction: the
 * variable holding it is still unassigned, so closing "whatever we have" closes nothing and the
 * process exits over the top of a live child. Waiting for the in-flight value first is what makes
 * the close reach it.
 */
export async function settledTeardownValue<T>(
  pending: Promise<T> | undefined,
  timeoutMs: number,
): Promise<T | undefined> {
  if (pending === undefined) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TEARDOWN_TIMED_OUT>((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout(TEARDOWN_TIMED_OUT), timeoutMs);
  });
  try {
    const settled = await Promise.race([pending.catch(() => undefined), timeout]);
    return settled === TEARDOWN_TIMED_OUT ? undefined : settled;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function isPageNavigatedRace(error: unknown): boolean {
  return error instanceof Error && PAGE_NAVIGATED_PATTERN.test(error.message);
}

export interface IPageLifecycle {
  closed: boolean;
  crashed: boolean;
  /** Every main-frame navigation, including the run's own initial one. */
  frameNavigations: string[];
  /** Main-frame navigations after the handshake settled — the ones that break a run. */
  navigations: string[];
  settled: boolean;
  /** The last console lines before the failure, which is where a device loss announces itself. */
  tail: string[];
}

/**
 * Playwright reports a crashed renderer and a navigated document with the same
 * "Execution context was destroyed" message, and the two have opposite fixes: a crash is an
 * environment or content problem, a navigation is the page moving under the run. The listeners
 * on the page record which one happened, so the report names it rather than falling through to
 * the unexplained-error catch-all. Returns undefined when the error is neither, leaving it to
 * propagate untouched.
 */
export function pageLifecycleDiagnostic(
  error: unknown,
  lifecycle: IPageLifecycle,
  url: string,
): IPlaytestProtocolDiagnostic | undefined {
  if (!lifecycle.crashed && !isPageNavigatedRace(error)) return undefined;
  const detail = error instanceof Error ? error.message : String(error);
  if (lifecycle.crashed) {
    return playtestDiagnostic(
      "TN_PLAYTEST_PAGE_CRASHED",
      `The browser page crashed while the scenario was running at '${url}'; runner error: ${detail}.`,
      "The renderer process died mid-run, so no assertion after that point was observed. Re-run with a smaller scene or a hardware GPU; under a virtual display the software WebGPU path is the usual cause.",
    );
  }
  const where = lifecycle.navigations.length === 0
    ? "an unrecorded location"
    : `'${lifecycle.navigations.join("', '")}'`;
  const observed = [
    `page closed: ${lifecycle.closed}`,
    `main-frame navigations: ${lifecycle.frameNavigations.length}`,
    ...(lifecycle.tail.length === 0 ? [] : [`last console: ${lifecycle.tail.join(" | ")}`]),
  ].join("; ");
  return playtestDiagnostic(
    "TN_PLAYTEST_PAGE_NAVIGATED",
    `The page navigated to ${where} while the scenario was running at '${url}'; runner error: ${detail}. Observed: ${observed}.`,
    "Something moved the document after the run started, so the observations after that point are from a different page. Remove the navigation from the game, or point --url at a server that does not reload itself mid-run.",
  );
}

/**
 * Navigate and complete the bridge handshake, re-navigating when the page reloads itself
 * before the handshake finishes. This never retries past the handshake: no observation has
 * been taken and no assertion has been evaluated yet, so a reattempt cannot hide a failure.
 * A bridge that is genuinely missing or incompatible still fails on its own diagnostic, and
 * an exhausted retry budget fails closed on TN_PLAYTEST_PAGE_NAVIGATED rather than passing.
 */
export async function openPageAndConnectBridge(
  page: Page,
  config: IStandalonePlaytestConfig,
  scenario: IPlaytestScenario,
): Promise<IPlaytestBridgeClient | undefined> {
  const attempts = 3;
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(config.url, { timeout: config.timeoutMs, waitUntil: "domcontentloaded" });
      await page.waitForLoadState("load", { timeout: config.timeoutMs }).catch(() => undefined);
      return await connectPlaytestBridge(page, scenario);
    } catch (error) {
      if (error instanceof PlaytestBridgeError || !isPageNavigatedRace(error)) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw new PlaytestBridgeError(playtestDiagnostic(
    "TN_PLAYTEST_PAGE_NAVIGATED",
    `The page navigated during the bridge handshake on all ${attempts} attempts at '${config.url}'; last runner error: ${lastError?.message ?? "unknown"}.`,
    "The served page is reloading itself while the run starts. With a Vite dev server this is usually dependency pre-bundling: run the project's build or dev command once before the scenario so the dependency cache is warm, or point --url at a preview server instead.",
    { nextCommand: config.server?.command },
  ));
}

export async function assertManagedUrlAvailable(url: string): Promise<void> {
  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(500) });
    await response.body?.cancel();
  } catch {
    return;
  }
  throw managedServerError("Managed server URL is already in use before startup.", url, 0, []);
}

export async function waitForUrl(url: string, timeoutMs: number, server: ChildProcess): Promise<void> {
  const started = Date.now();
  const output: string[] = [];
  server.stdout?.on("data", (chunk) => output.push(String(chunk)));
  server.stderr?.on("data", (chunk) => output.push(String(chunk)));
  while (Date.now() - started < timeoutMs) {
    if (server.exitCode !== null) {
      throw managedServerError(
        `Managed server exited with code ${server.exitCode}.`,
        url,
        timeoutMs,
        output,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server has not started listening yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw managedServerError(`Managed server did not become ready within ${timeoutMs}ms.`, url, timeoutMs, output);
}

export async function stopManagedServer(server: ChildProcess | undefined): Promise<void> {
  if (server?.pid === undefined || server.exitCode !== null || server.signalCode !== null) return;
  const stopped = waitForProcessExit(server, 2_000);
  if (process.platform === "win32") server.kill();
  else {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // The process group may have exited between the status check and teardown.
    }
  }
  if (await stopped) return;
  if (process.platform === "win32") server.kill("SIGKILL");
  else {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      // The process group may have exited between the timeout and forced teardown.
    }
  }
  await waitForProcessExit(server, 1_000);
}

export function waitForProcessExit(server: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (server.exitCode !== null || server.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const timeout = setTimeout(() => {
      server.off("exit", onExit);
      resolveExit(false);
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timeout);
      resolveExit(true);
    };
    server.once("exit", onExit);
  });
}

export function managedServerError(message: string, url: string, timeoutMs: number, output: readonly string[]): ManagedServerError {
  return new ManagedServerError(playtestDiagnostic(
    "TN_PLAYTEST_SERVER_FAILED",
    `${message} URL: ${url}. Timeout: ${timeoutMs}ms. Output: ${output.join("").slice(-4_000)}`,
    "Run the server command directly, fix its first error, then rerun the same playtest command.",
  ));
}

