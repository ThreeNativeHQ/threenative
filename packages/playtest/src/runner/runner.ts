import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  evaluateRichPlaytestAssertions,
  loadPlaytestScenario,
  playtestDiagnostic,
  playtestStepHoldTicks,
  playtestStepWaitTicks,
  type IPlaytestAssertionResult,
  type IPlaytestDiagnostic,
  type IPlaytestObservationSnapshot,
  type IPlaytestProtocolDiagnostic,
  type IPlaytestReport,
  type IPlaytestScenario,
  type IPlaytestSetupRequest,
  type PlaytestVec3,
} from "../index.js";
import { chromium, type Page } from "playwright";

import { connectPlaytestBridge, PlaytestBridgeError, type IPlaytestBridgeClient } from "./bridgeClient.js";
import type { IStandalonePlaytestConfig } from "./config.js";

class ManagedServerError extends Error {
  constructor(readonly diagnostic: IPlaytestProtocolDiagnostic) {
    super(diagnostic.message);
  }
}

export interface IStandalonePlaytestReport extends IPlaytestReport {
  artifactDirectory: string;
  pass: boolean;
  runtime: "web";
  scenario: string;
  target: string;
  url: string;
}

export async function runStandalonePlaytest(config: IStandalonePlaytestConfig): Promise<IStandalonePlaytestReport> {
  const scenario = await loadPlaytestScenario(config.projectPath, config.scenarioPath);
  await mkdir(config.artifactDirectory, { recursive: true });
  const server = config.server === undefined ? undefined : startManagedServer(config);
  const browser = await chromium.launch({ headless: config.headless });
  let page: Page | undefined;
  try {
    if (server !== undefined) {
      await waitForUrl(config.url, config.server?.timeoutMs ?? config.timeoutMs, server);
    }
    const context = await browser.newContext({ viewport: scenario.viewport });
    if (config.trace) {
      await context.tracing.start({ screenshots: true, snapshots: true });
    }
    page = await context.newPage();
    const consoleEntries: Array<{ text: string; type: string }> = [];
    const networkEntries: Array<{ method: string; url: string }> = [];
    page.on("console", (entry) => consoleEntries.push({ text: entry.text(), type: entry.type() }));
    page.on("pageerror", (error) => consoleEntries.push({ text: error.message, type: "pageerror" }));
    page.on("requestfailed", (request) => networkEntries.push({ method: request.method(), url: request.url() }));
    await page.goto(config.url, { timeout: config.timeoutMs, waitUntil: "domcontentloaded" });
    const bridge = await connectPlaytestBridge(page, scenario);
    if (bridge !== undefined && scenario.setup !== undefined) {
      await bridge.applySetup(setupRequest(scenario));
    }
    await waitFrames(page, scenario.warmupFrames);
    const entityIds = observedEntityIds(scenario);
    const resourceIds = observedResourceIds(scenario);
    const beforeSnapshot = await bridge?.sample({ entities: entityIds, include: ["entities", "resources", "diagnostics"], resources: resourceIds });
    if (scenario.artifacts?.screenshots === "before-after") {
      await page.screenshot({ path: join(config.artifactDirectory, "before.png") });
    }
    for (const step of scenario.steps) {
      await runStep(page, bridge, step);
      if (step.screenshot !== undefined) {
        await page.screenshot({ path: join(config.artifactDirectory, `${safePart(step.screenshot)}.png`) });
      }
    }
    const afterSnapshot = await bridge?.sample({ entities: entityIds, include: ["entities", "resources", "diagnostics"], resources: resourceIds });
    if (scenario.artifacts?.screenshots !== false) {
      await page.screenshot({ path: join(config.artifactDirectory, "after.png") });
    }
    if (config.trace) {
      await context.tracing.stop({ path: join(config.artifactDirectory, "trace.zip") });
    }
    const report = buildReport(config, scenario, beforeSnapshot, afterSnapshot, consoleEntries, networkEntries);
    await context.close();
    return report;
  } catch (error) {
    if (error instanceof PlaytestBridgeError || error instanceof ManagedServerError) {
      return failureReport(config, scenario, error.diagnostic);
    }
    throw error;
  } finally {
    await page?.context().close().catch(() => undefined);
    await browser.close();
    stopManagedServer(server);
  }
}

function buildReport(
  config: IStandalonePlaytestConfig,
  scenario: IPlaytestScenario,
  beforeSnapshot: IPlaytestObservationSnapshot | undefined,
  afterSnapshot: IPlaytestObservationSnapshot | undefined,
  consoleEntries: Array<{ text: string; type: string }>,
  networkEntries: Array<{ method: string; url: string }>,
): IStandalonePlaytestReport {
  const entity = scenario.assert?.movement?.entity ?? scenario.subject ?? "";
  const beforePosition = entityPosition(beforeSnapshot, entity);
  const afterPosition = entityPosition(afterSnapshot, entity);
  const beforeRotation = entityRotation(beforeSnapshot, entity);
  const afterRotation = entityRotation(afterSnapshot, entity);
  const movementDelta = beforePosition === undefined || afterPosition === undefined
    ? undefined
    : subtract(afterPosition, beforePosition);
  const distance = movementDelta === undefined ? 0 : length(movementDelta);
  const diagnostics: IPlaytestDiagnostic[] = [];
  const base: IPlaytestReport = {
    ...(afterPosition === undefined ? {} : { after: { frame: scenario.steps.length, position: afterPosition, ...(afterRotation === undefined ? {} : { rotation: afterRotation }), tick: afterSnapshot?.clock.tick ?? 0 } }),
    ...(beforePosition === undefined ? {} : { before: { frame: 0, position: beforePosition, ...(beforeRotation === undefined ? {} : { rotation: beforeRotation }), tick: beforeSnapshot?.clock.tick ?? 0 } }),
    diagnostics,
    distance,
    entity,
    expectMoved: scenario.assert?.movement?.minDistance !== undefined,
    frames: scenario.steps.reduce((total, step) => total + (step.holdFrames ?? step.waitFrames ?? step.holdTicks ?? step.waitTicks ?? 1), 0),
    ...(movementDelta === undefined ? {} : { movementDelta }),
    observations: {
      console: consoleEntries,
      hud: {},
      network: networkEntries,
      resources: resourceObservations(beforeSnapshot, afterSnapshot),
      runtimeDiagnostics: normalizedRuntimeDiagnostics(afterSnapshot, scenario),
    },
  };
  if (scenario.assert?.camera !== undefined) {
    base.follow = cameraReport(scenario, beforeSnapshot, afterSnapshot);
  }
  const evaluated = evaluateRichPlaytestAssertions({ report: base, scenario });
  const cameraResult = evaluateCamera(scenario, afterSnapshot);
  const assertionResults = [...evaluated.assertions, ...(cameraResult === undefined ? [] : [cameraResult])];
  const allDiagnostics = [...diagnostics, ...evaluated.diagnostics];
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
    assertionResults,
    diagnostics: allDiagnostics,
    pass: assertionResults.every(({ pass }) => pass) && allDiagnostics.every(({ severity }) => severity !== "error"),
    runtime: "web",
    scenario: scenario.name,
    target: scenario.target,
    url: config.url,
  };
}

function failureReport(config: IStandalonePlaytestConfig, scenario: IPlaytestScenario, diagnostic: IPlaytestProtocolDiagnostic): IStandalonePlaytestReport {
  return {
    artifactDirectory: config.artifactDirectory,
    debugColliders: false,
    diagnostics: [{ ...diagnostic, suggestion: diagnostic.fix.instruction }],
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
    url: config.url,
  } as IStandalonePlaytestReport;
}

function setupRequest(scenario: IPlaytestScenario): IPlaytestSetupRequest {
  return {
    entities: scenario.setup?.entities?.map(({ entity, position, rotation, scale }) => ({
      entity,
      transform: { position, rotation, scale },
    })),
    resources: scenario.setup?.resources?.map(({ id, path, value }) => ({ id, path, value: value as never })),
  };
}

async function runStep(page: Page, bridge: IPlaytestBridgeClient | undefined, step: IPlaytestScenario["steps"][number]): Promise<void> {
  if (step.pointerPosition !== undefined) {
    await page.mouse.move(step.pointerPosition.x, step.pointerPosition.y);
  }
  if (step.press !== undefined) {
    await page.keyboard.down(step.press);
  }
  const ticks = playtestStepHoldTicks(step, 0) + playtestStepWaitTicks(step);
  const frames = (step.holdFrames ?? 0) + (step.waitFrames ?? 0);
  if (ticks > 0 && bridge?.description.capabilities.includes("runtime.fixedStep") === true) {
    await bridge.advance(ticks);
  } else {
    await waitFrames(page, Math.max(frames, ticks, 1));
  }
  if (step.press !== undefined && step.release) {
    await page.keyboard.up(step.press);
  }
}

async function waitFrames(page: Page, frames: number): Promise<void> {
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

function observedEntityIds(scenario: IPlaytestScenario): string[] {
  return [...new Set([
    scenario.subject,
    scenario.assert?.movement?.entity,
    scenario.assert?.camera?.entity,
    scenario.assert?.camera?.follows,
    ...(scenario.assert?.visibility ?? []).map(({ entity }) => entity),
  ].filter((value): value is string => value !== undefined))];
}

function observedResourceIds(scenario: IPlaytestScenario): string[] {
  return [...new Set([
    ...(scenario.assert?.resources ?? []).map(({ id }) => id),
    ...(scenario.setup?.resources ?? []).map(({ id }) => id),
  ])];
}

function entityPosition(snapshot: IPlaytestObservationSnapshot | undefined, id: string): PlaytestVec3 | undefined {
  return snapshot?.entities?.find((entity) => entity.id === id)?.transform?.position;
}

function entityRotation(snapshot: IPlaytestObservationSnapshot | undefined, id: string): [number, number, number, number] | undefined {
  return snapshot?.entities?.find((entity) => entity.id === id)?.transform?.rotation;
}

function resourceObservations(before: IPlaytestObservationSnapshot | undefined, after: IPlaytestObservationSnapshot | undefined) {
  const ids = new Set([...Object.keys(before?.resources ?? {}), ...Object.keys(after?.resources ?? {})]);
  return Object.fromEntries([...ids].map((id) => [id, { before: before?.resources?.[id], after: after?.resources?.[id] }]));
}

function normalizedRuntimeDiagnostics(snapshot: IPlaytestObservationSnapshot | undefined, scenario: IPlaytestScenario): unknown {
  return {
    recentRuntimeErrors: snapshot?.diagnostics ?? [],
    scene: {
      renderedEntities: (snapshot?.entities ?? []).map((entity) => ({
        id: entity.id,
        projectedBounds: entity.bounds === undefined ? undefined : pixelBoundsToNdc(entity.bounds, scenario.viewport),
      })),
    },
  };
}

function pixelBoundsToNdc(bounds: { height: number; width: number; x: number; y: number }, viewport: { height: number; width: number }) {
  return {
    max: [2 * (bounds.x + bounds.width) / viewport.width - 1, 1 - 2 * bounds.y / viewport.height],
    min: [2 * bounds.x / viewport.width - 1, 1 - 2 * (bounds.y + bounds.height) / viewport.height],
  };
}

function cameraReport(scenario: IPlaytestScenario, before: IPlaytestObservationSnapshot | undefined, after: IPlaytestObservationSnapshot | undefined) {
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

function evaluateCamera(scenario: IPlaytestScenario, snapshot: IPlaytestObservationSnapshot | undefined): IPlaytestAssertionResult | undefined {
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

function subtract(a: PlaytestVec3, b: PlaytestVec3): PlaytestVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length(vector: PlaytestVec3): number {
  return Math.hypot(...vector);
}

function safePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function startManagedServer(config: IStandalonePlaytestConfig): ChildProcess {
  const server = spawn(config.server!.command, {
    cwd: resolve(config.server!.cwd ?? config.projectPath),
    detached: process.platform !== "win32",
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return server;
}

async function waitForUrl(url: string, timeoutMs: number, server: ChildProcess): Promise<void> {
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

function stopManagedServer(server: ChildProcess | undefined): void {
  if (server?.pid === undefined || server.exitCode !== null) return;
  if (process.platform === "win32") server.kill();
  else process.kill(-server.pid, "SIGTERM");
}

function managedServerError(message: string, url: string, timeoutMs: number, output: readonly string[]): ManagedServerError {
  return new ManagedServerError(playtestDiagnostic(
    "TN_PLAYTEST_SERVER_FAILED",
    `${message} URL: ${url}. Timeout: ${timeoutMs}ms. Output: ${output.join("").slice(-4_000)}`,
    "Run the server command directly, fix its first error, then rerun the same playtest command.",
  ));
}
