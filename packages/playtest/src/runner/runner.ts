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
  finishFramebufferCoverageProbe,
  startFramebufferCoverageProbe,
} from "./framebufferCoverage.js";
import { STANDALONE_PLAYTEST_OBSERVATION_FIELDS } from "./observationFields.js";

export { STANDALONE_PLAYTEST_OBSERVATION_FIELDS } from "./observationFields.js";

class ManagedServerError extends Error {
  constructor(readonly diagnostic: IPlaytestProtocolDiagnostic) {
    super(diagnostic.message);
  }
}

export interface IStandalonePlaytestReport extends IPlaytestReport {
  artifactDirectory: string;
  pass: boolean;
  runtime: "native" | "web";
  scenario: string;
  target: string;
  url: string;
}

export async function handlePlaytestSignal(
  teardown: (stopManagedServer: boolean) => Promise<void>,
  setExitCode: (code: number) => void = (code) => {
    process.exitCode = code;
  },
  exit: (code: number) => void = (code) => {
    process.exit(code);
  },
): Promise<void> {
  await teardown(true).catch(() => undefined);
  setExitCode(2);
  exit(2);
}

export function failedDiagnosticsAssertion(policy: IPlaytestDiagnosticsPolicy): IPlaytestAssertionResult {
  return {
    details: {
      consoleErrors: 0,
      networkErrors: 0,
      policy,
      reason: "not-evaluated",
      runtimeDiagnostics: 0,
    },
    id: "diagnostics",
    pass: false,
  };
}

export async function writeCaptureProvenance(
  artifactDirectory: string,
  provenance: IPlaytestCaptureProvenance,
): Promise<void> {
  await writeFile(join(artifactDirectory, "capture.json"), `${JSON.stringify(provenance, null, 2)}\n`);
}

/**
 * Diagnostics name `console.json` and `runtime-trace.json`, and `artifacts.console`,
 * `artifacts.network` and `artifacts.runtimeTrace` accept a request for them. Neither was
 * written: a build hitting TN_PLAYTEST_CONSOLE_ERROR found the artifact directory holding
 * only `after.png` and `capture.json`, and had to reconstruct the errors from provenance.
 * A message that names a file the runner never writes sends the reader somewhere empty, so
 * write each one whenever it has content or was asked for.
 */
export async function writeObservationArtifacts(
  artifactDirectory: string,
  requested: IPlaytestArtifactRequest | undefined,
  observations: {
    console: readonly unknown[];
    network: readonly unknown[];
    runtimeTrace: { readonly recentRuntimeErrors?: readonly unknown[]; readonly [key: string]: unknown } | undefined;
  },
): Promise<readonly string[]> {
  const runtimeErrors = observations.runtimeTrace?.recentRuntimeErrors ?? [];
  const files: Array<[string, unknown, boolean]> = [
    ["console.json", observations.console, observations.console.length > 0 || requested?.console === true],
    ["network.json", observations.network, observations.network.length > 0 || requested?.network === true],
    ["runtime-trace.json", observations.runtimeTrace, runtimeErrors.length > 0 || requested?.runtimeTrace === true],
  ];
  const written: string[] = [];
  for (const [name, content, wanted] of files) {
    if (!wanted || content === undefined) continue;
    await writeFile(join(artifactDirectory, name), `${JSON.stringify(content, null, 2)}\n`);
    written.push(name);
  }
  return written;
}

interface ILabeledPlaytestSample {
  label: string;
  signals: unknown[];
  snapshot: IPlaytestObservationSnapshot;
}

type RunnerConsoleEntry = {
  source?: "browser-console" | "page-error" | "unhandled-rejection";
  text: string;
  type: string;
};

const UNHANDLED_REJECTION_PREFIX = "__THREENATIVE_PLAYTEST_UNHANDLED_REJECTION__:";

interface IMovementSampleInterval {
  after: IPlaytestObservationSnapshot;
  before: IPlaytestObservationSnapshot;
  inputDriven: boolean;
}

interface IRunStepSamples {
  afterInput?: IPlaytestObservationSnapshot;
  afterStep?: IPlaytestObservationSnapshot;
  inputDriven: boolean;
}

interface IStandalonePlaytestRunOptions {
  managedServer?: ChildProcess;
}

export async function runStandalonePlaytest(
  config: IStandalonePlaytestConfig,
  options: IStandalonePlaytestRunOptions = {},
): Promise<IStandalonePlaytestReport> {
  const usesFreePort = config.server !== undefined && config.port === 0;
  const activeConfig = usesFreePort ? await resolveManagedServerConfig(config) : config;
  const scenario = await loadPlaytestScenario(activeConfig.projectPath, activeConfig.scenarioPath);
  const browserConfig = scenario.assert?.performance === undefined
    ? activeConfig
    : {
        ...activeConfig,
        browserArgs: [
          ...(activeConfig.browserArgs ?? []),
          ...PERFORMANCE_BROWSER_ARGS.filter((argument) => !activeConfig.browserArgs?.includes(argument)),
        ],
      };
  await mkdir(activeConfig.artifactDirectory, { recursive: true });
  let server: ChildProcess | undefined;
  const ownsServer = options.managedServer === undefined && activeConfig.server !== undefined;
  server = options.managedServer;
  let browser: Browser | undefined;
  let page: Page | undefined;
  let teardownPromise: Promise<void> | undefined;
  let serverTeardownPromise: Promise<void> | undefined;
  const pageLifecycle: IPageLifecycle = {
    closed: false,
    crashed: false,
    frameNavigations: [],
    navigations: [],
    settled: false,
    tail: [],
  };
  const stopServer = async (): Promise<void> => {
    serverTeardownPromise ??= stopManagedServer(server);
    await serverTeardownPromise;
  };
  const teardown = async (stopManagedServerOnTeardown = ownsServer): Promise<void> => {
    teardownPromise ??= (async () => {
      await boundedTeardownStep(page?.context().close(), 5_000);
      // Chromium does not always exit when asked — under a virtual display with a live GPU
      // process it can sit in close() forever. The report is already written by this point, so
      // teardown gives up rather than holding the run open; the CLI then exits explicitly.
      await boundedTeardownStep(browser?.close(), 10_000);
    })();
    await teardownPromise.catch(() => undefined);
    if (stopManagedServerOnTeardown) await stopServer();
  };
  const handleSignal = (): void => {
    void handlePlaytestSignal((stopManagedServerOnSignal) => teardown(stopManagedServerOnSignal));
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
  const preflight = preflightDisplay(activeConfig, scenario);
  if (preflight !== undefined) {
    process.stderr.write(`${JSON.stringify({ diagnostics: [preflight] })}\n`);
  }
  try {
    if (activeConfig.server !== undefined && server === undefined) {
      if (!usesFreePort) await assertManagedUrlAvailable(activeConfig.url);
      server = startManagedServer(activeConfig, usesFreePort ? activeConfig.port : undefined);
    }
    browser = await chromium.launch({
      ...(browserConfig.browserArgs === undefined ? {} : { args: resolveBrowserArguments(browserConfig.browserArgs) }),
      headless: activeConfig.headless,
    });
    if (server !== undefined && options.managedServer === undefined) {
      await waitForUrl(activeConfig.url, activeConfig.server?.timeoutMs ?? activeConfig.timeoutMs, server);
    }
    const context = await browser.newContext({ viewport: scenario.viewport });
    if (activeConfig.trace) {
      await context.tracing.start({ screenshots: true, snapshots: true });
    }
    page = await context.newPage();
    await page.addInitScript(() => {
      // Announce the runner before any game code evaluates, so an adapter can hold its loop
      // instead of racing this run's first observation.
      (globalThis as Record<string, unknown>).__THREENATIVE_PLAYTEST_RUNNER_EXPECTED__ = true;
      window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason instanceof Error
          ? event.reason.stack || event.reason.message
          : String(event.reason);
        console.error(`__THREENATIVE_PLAYTEST_UNHANDLED_REJECTION__:${reason}`);
      });
    });
    const consoleEntries: RunnerConsoleEntry[] = [];
    const networkEntries: Array<{ method: string; url: string }> = [];
    page.on("console", (entry) => {
      const text = entry.text();
      const unhandledRejection = text.startsWith(UNHANDLED_REJECTION_PREFIX);
      consoleEntries.push({
        source: unhandledRejection ? "unhandled-rejection" : "browser-console",
        text: unhandledRejection ? text.slice(UNHANDLED_REJECTION_PREFIX.length) : text,
        type: entry.type(),
      });
      pageLifecycle.tail.push(`${entry.type()}: ${text}`);
      if (pageLifecycle.tail.length > 8) pageLifecycle.tail.shift();
    });
    page.on("pageerror", (error) => consoleEntries.push({ source: "page-error", text: error.stack || error.message, type: "pageerror" }));
    page.on("requestfailed", (request) => networkEntries.push({ method: request.method(), url: request.url() }));
    // A renderer crash and a page navigation both surface as "Execution context was destroyed"
    // on the next evaluate, and the two need opposite fixes. Record which actually happened so
    // the report names it instead of emitting the unexplained-error catch-all.
    const observedPage = page;
    page.on("crash", () => {
      pageLifecycle.crashed = true;
    });
    page.on("framenavigated", (frame) => {
      if (frame !== observedPage.mainFrame()) return;
      pageLifecycle.frameNavigations.push(frame.url());
      if (pageLifecycle.settled) pageLifecycle.navigations.push(frame.url());
    });
    page.on("close", () => {
      pageLifecycle.closed = true;
    });
    const activePage = page;
    const bridge = await openPageAndConnectBridge(page, browserConfig, scenario);
    // From here on the page is expected to stay put; anything that moves it is evidence.
    pageLifecycle.settled = true;
    if (bridge !== undefined && scenario.setup !== undefined) {
      await bridge.applySetup(setupRequest(scenario));
    }
    await waitFrames(page, scenario.warmupFrames);
    const runtimeReady = await page.evaluate(() =>
      document.readyState !== "loading" && document.querySelector("canvas") !== null,
    ).catch(() => false);
    const entityIds = observedEntityIds(scenario);
    const resourceIds = observedResourceIds(scenario);
    const sampleRequest = {
      ...(entityIds === undefined ? {} : { entities: entityIds }),
      include: [
        "components",
        "diagnostics",
        "entities",
        "resources",
        ...(scenario.assert?.aerodynamics === undefined &&
        scenario.assert?.contacts === undefined &&
        scenario.assert?.settled === undefined
          ? []
          : ["physicsDebugSeries"]),
        ...(scenario.assert?.performance === undefined ? [] : ["runtimeDiagnosticsSeries"]),
      ],
      resources: resourceIds,
    } as const;
    const labeledSamples: ILabeledPlaytestSample[] = [];
    const capturesAnonymousMovement = isAnonymousMovementScenario(scenario);
    const movementSamples: IMovementSampleInterval[] = [];
    const wantsVisual = (scenario.assert?.visual?.length ?? 0) > 0;
    const needsCapture = scenario.artifacts?.screenshots !== false
      || scenario.steps.some((step) => step.screenshot !== undefined)
      || wantsVisual;
    const captureProvenance = needsCapture
      ? await readCaptureProvenance(page, browserConfig, scenario)
      : undefined;
    if (captureProvenance !== undefined) {
      await writeCaptureProvenance(activeConfig.artifactDirectory, captureProvenance);
    }
    let captureFailure: { code: "TN_CAPTURE_BLANK"; label: string; reason: string } | undefined;
    const capturePage = async (
      label: string,
      options: Parameters<Page["screenshot"]>[0],
    ): Promise<Buffer | undefined> => {
      let png: Buffer;
      try {
        png = await activePage.screenshot(options);
      } catch (error) {
        try {
          const fallback = await captureVisualSurface(
            activePage,
            typeof options?.path === "string" ? options.path : undefined,
          );
          if (fallback === undefined) throw error;
          png = fallback;
        } catch {
          throw error;
        }
      }
      try {
        assertCaptureNotBlank(png, label);
        return png;
      } catch (error) {
        if (!(error instanceof CaptureGuardError)) throw error;
        captureFailure ??= { code: error.code, label: error.label, reason: error.reason };
        return undefined;
      }
    };
    const captureVisualPage = async (
      label: string,
      artifactPath: string | undefined,
    ): Promise<Buffer | undefined> => {
      try {
        const png = await captureVisualSurface(activePage, artifactPath);
        if (png === undefined) {
          captureFailure ??= {
            code: "TN_CAPTURE_BLANK",
            label,
            reason: "no canvas was available for the visual capture",
          };
          return undefined;
        }
        assertCaptureNotBlank(png, label);
        return png;
      } catch (error) {
        if (!(error instanceof CaptureGuardError)) throw error;
        captureFailure ??= { code: error.code, label: error.label, reason: error.reason };
        return undefined;
      }
    };
    const beforeSnapshot = await bridge?.sample(sampleRequest);
    let movementCursor = beforeSnapshot;
    const pathEntity = scenario.assert?.movement?.pathLength === undefined
      ? undefined
      : scenario.assert.movement.entity ?? scenario.subject;
    const pathPositions = beforeSnapshot === undefined || pathEntity === undefined
      ? []
      : [entityPosition(beforeSnapshot, pathEntity)].filter((position): position is PlaytestVec3 => position !== undefined);
    const inputState: StepInputState = { heldKeys: new Set(), pointerButtons: 0, pointers: new Map() };
    const hudAssertions = scenario.assert?.hud ?? [];
    const beforeHud = await sampleHud(page, hudAssertions);
    const beforeScreenshot = scenario.artifacts?.screenshots === "before-after" || wantsVisual
      ? wantsVisual
        ? await captureVisualPage(
            "before.png",
            scenario.artifacts?.screenshots === "before-after"
              ? join(activeConfig.artifactDirectory, "before.png")
              : undefined,
          )
        : await capturePage("before.png", scenario.artifacts?.screenshots === "before-after"
          ? { path: join(activeConfig.artifactDirectory, "before.png") }
          : {})
      : undefined;
    let framebufferCoverage: IPlaytestFramebufferCoverageObservation | undefined;
    for (const [index, step] of scenario.steps.entries()) {
      const framebufferAssertion = scenario.assert?.framebufferCoverage;
      if (framebufferAssertion !== undefined
        && step.label === framebufferAssertion.window.startStep) {
        await startFramebufferCoverageProbe(page, framebufferAssertion);
      }
      const stepSamples = await runStep(
        page,
        bridge,
        step,
        scenario.viewport,
        pathEntity,
        pathPositions,
        inputState,
        capturesAnonymousMovement ? sampleRequest : undefined,
        index === scenario.steps.length - 1,
      );
      if (capturesAnonymousMovement && movementCursor !== undefined && stepSamples.afterInput !== undefined) {
        movementSamples.push({
          after: stepSamples.afterInput,
          before: movementCursor,
          inputDriven: stepSamples.inputDriven,
        });
      }
      if (
        capturesAnonymousMovement
        && stepSamples.afterInput !== undefined
        && stepSamples.afterStep !== undefined
        && stepSamples.afterStep !== stepSamples.afterInput
      ) {
        movementSamples.push({ after: stepSamples.afterStep, before: stepSamples.afterInput, inputDriven: false });
      }
      if (capturesAnonymousMovement && stepSamples.afterStep !== undefined) {
        movementCursor = stepSamples.afterStep;
      }
      if (step.label === scenario.assert?.framebufferCoverage?.window.endStep) {
        framebufferCoverage = await finishFramebufferCoverageProbe(page, activeConfig.artifactDirectory);
      }
      if (step.label !== undefined && bridge !== undefined) {
        const snapshot = await bridge.sample({ ...sampleRequest, label: step.label });
        const signals = bridge.description.capabilities.includes("runtime.events")
          ? await bridge.drainEvents()
          : [];
        labeledSamples.push({ label: step.label, signals, snapshot });
      }
      if (step.screenshot !== undefined) {
        await capturePage(`${safePart(step.screenshot)}.png`, { path: join(activeConfig.artifactDirectory, `${safePart(step.screenshot)}.png`) });
      }
    }
    const afterSnapshot = await bridge?.sample(sampleRequest);
    if (afterSnapshot !== undefined && pathEntity !== undefined) {
      const position = entityPosition(afterSnapshot, pathEntity);
      if (position !== undefined) pathPositions.push(position);
    }
    const afterHud = await sampleHud(page, hudAssertions);
    const afterScreenshot = scenario.artifacts?.screenshots !== false || wantsVisual
      ? wantsVisual
        ? await captureVisualPage(
            "after.png",
            scenario.artifacts?.screenshots === false
              ? undefined
              : join(activeConfig.artifactDirectory, "after.png"),
          )
        : await capturePage("after.png", scenario.artifacts?.screenshots === false
          ? {}
          : { path: join(activeConfig.artifactDirectory, "after.png") })
      : undefined;
    const visual = screenshotObservations(beforeScreenshot, afterScreenshot, scenario, captureFailure);
    if (activeConfig.trace) {
      await context.tracing.stop({ path: join(activeConfig.artifactDirectory, "trace.zip") });
    }
    const report = buildReport(
      browserConfig,
      scenario,
      beforeSnapshot,
      afterSnapshot,
      consoleEntries,
      networkEntries,
      accumulatedPathLength(pathPositions),
      pairObservations(beforeHud, afterHud),
      runtimeReady,
      visual,
      labeledSamples,
      framebufferCoverage,
      captureProvenance,
      captureFailure,
      movementSamples,
    );
    await writeObservationArtifacts(activeConfig.artifactDirectory, scenario.artifacts, {
      console: consoleEntries,
      network: networkEntries,
      runtimeTrace: normalizedRuntimeDiagnostics(afterSnapshot, scenario, consoleEntries),
    });
    await context.close();
    return addPreflightDiagnostic(report, preflight);
  } catch (error) {
    if (error instanceof PlaytestBridgeError || error instanceof ManagedServerError) {
      return addPreflightDiagnostic(failureReport(activeConfig, scenario, error.diagnostic), preflight);
    }
    const lifecycleDiagnostic = pageLifecycleDiagnostic(error, pageLifecycle, activeConfig.url);
    if (lifecycleDiagnostic !== undefined) {
      return addPreflightDiagnostic(failureReport(activeConfig, scenario, lifecycleDiagnostic), preflight);
    }
    throw error;
  } finally {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    await teardown();
  }
}

export async function runStandalonePlaytests(
  config: IStandalonePlaytestConfig,
): Promise<readonly IStandalonePlaytestReport[]> {
  const scenarioPaths = config.scenarioPaths ?? [config.scenarioPath];
  if (scenarioPaths.length <= 1) {
    return [await runStandalonePlaytest({ ...config, scenarioPath: scenarioPaths[0]! })];
  }
  if (config.server === undefined) {
    const reports: IStandalonePlaytestReport[] = [];
    for (const [index, scenarioPath] of scenarioPaths.entries()) {
      reports.push(await runStandalonePlaytest({
        ...config,
        artifactDirectory: batchArtifactDirectory(config.artifactDirectory, scenarioPath, index),
        scenarioPath,
        scenarioPaths: undefined,
      }));
    }
    return reports;
  }

  const usesFreePort = config.port === 0;
  const activeConfig = usesFreePort ? await resolveManagedServerConfig(config) : config;
  const scenarios = [] as IPlaytestScenario[];
  for (const scenarioPath of scenarioPaths) {
    scenarios.push(await loadPlaytestScenario(activeConfig.projectPath, scenarioPath));
  }
  let server: ChildProcess | undefined;
  try {
    if (!usesFreePort) await assertManagedUrlAvailable(activeConfig.url);
    server = startManagedServer(activeConfig, usesFreePort ? activeConfig.port : undefined);
    await waitForUrl(activeConfig.url, activeConfig.server?.timeoutMs ?? activeConfig.timeoutMs, server);
    const reports: IStandalonePlaytestReport[] = [];
    for (const [index, scenarioPath] of scenarioPaths.entries()) {
      reports.push(await runStandalonePlaytest({
        ...activeConfig,
        artifactDirectory: batchArtifactDirectory(activeConfig.artifactDirectory, scenarioPath, index),
        scenarioPath,
        scenarioPaths: undefined,
      }, { managedServer: server }));
    }
    return reports;
  } catch (error) {
    if (!(error instanceof ManagedServerError)) throw error;
    return scenarios.map((scenario, index) => failureReport({
      ...activeConfig,
      artifactDirectory: batchArtifactDirectory(activeConfig.artifactDirectory, scenarioPaths[index]!, index),
      scenarioPath: scenarioPaths[index]!,
      scenarioPaths: undefined,
    }, scenario, error.diagnostic));
  } finally {
    await stopManagedServer(server);
  }
}

function batchArtifactDirectory(base: string, scenarioPath: string, index: number): string {
  return join(base, `${String(index + 1).padStart(2, "0")}-${safePart(scenarioPath)}`);
}

async function resolveManagedServerConfig(
  config: IStandalonePlaytestConfig,
): Promise<IStandalonePlaytestConfig> {
  if (config.server === undefined || config.port !== 0) return config;
  const port = await findFreePort();
  return { ...config, port, url: withPort(config.url, port) };
}

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
      ? "Headless Linux cannot provide trusted per-frame WebGPU pixels without a display; use xvfb-run -a -s '-screen 0 1600x900x24'."
      : "Headless Linux visual runs may render WebGPU blank without a display; use xvfb-run -a -s '-screen 0 1600x900x24'.",
    severity: evaluatesFramebuffer ? "error" : "warning",
    suggestion: "Prefix the command with xvfb-run -a -s '-screen 0 1600x900x24'.",
  };
}

function addPreflightDiagnostic(
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
      ...(afterSnapshot?.gameplay === undefined && labeledSamples.every(({ snapshot }) => snapshot.gameplay === undefined)
        ? {}
        : {
            runtimeObservations: {
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
      runtimeDiagnostics: normalizedRuntimeDiagnostics(afterSnapshot, scenario, consoleEntries),
      ...(visual === undefined ? {} : { visual }),
    }),
  };
  if (scenario.assert?.camera !== undefined) {
    base.follow = cameraReport(scenario, beforeSnapshot, afterSnapshot);
  }
  const evaluated = evaluateRichPlaytestAssertions({ report: base, scenario });
  const cameraResult = evaluateCamera(scenario, afterSnapshot);
  const assertionResults = [...evaluated.assertions, ...(cameraResult === undefined ? [] : [cameraResult])];
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
    url: config.url,
  };
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

function buildObservations(candidate: Partial<IPlaytestObservations>): IPlaytestObservations {
  const observations = {} as IPlaytestObservations;
  for (const field of STANDALONE_PLAYTEST_OBSERVATION_FIELDS) {
    const value = candidate[field];
    if (value !== undefined) Object.assign(observations, { [field]: value });
  }
  return observations;
}

function componentObservations(
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

function screenshotObservations(
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

function regionMetrics(
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

function failureReport(config: IStandalonePlaytestConfig, scenario: IPlaytestScenario, diagnostic: IPlaytestProtocolDiagnostic): IStandalonePlaytestReport {
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
    url: config.url,
  } as IStandalonePlaytestReport;
}

// Every key here is optional in the scenario, and the payload crosses assertJsonSafe
// on the way to the page. An explicit `undefined` is not JSON-safe, so spreading a
// partially-specified transform verbatim aborted the whole run before it started.
// Absent keys must stay absent.
function setupRequest(scenario: IPlaytestScenario): IPlaytestSetupRequest {
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

async function runStep(
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
      await bridge.advance(Math.min(sampleTicks, ticks - index));
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
        await bridge.advance(1);
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
      await bridge.advance(1);
    } else {
      await waitFrames(page, 1);
    }
    if (bridge !== undefined && movementSampleRequest !== undefined) {
      afterStep = await bridge.sample(movementSampleRequest);
    }
  }
  return { afterInput, afterStep, inputDriven };
}

type StepInputState = {
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

function inputActive(inputState: StepInputState): boolean {
  return inputState.heldKeys.size > 0 || inputState.pointerButtons !== 0 || inputState.pointers.size > 0;
}

async function setBrowserPointers(
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

const POINTER_BUTTONS = [
  { button: "left", mask: 1 },
  { button: "right", mask: 2 },
  { button: "middle", mask: 4 },
] as const;

async function setPointerButtons(
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

async function samplePathPosition(
  bridge: IPlaytestBridgeClient | undefined,
  entity: string | undefined,
  positions: PlaytestVec3[],
): Promise<void> {
  if (bridge === undefined || entity === undefined) return;
  const snapshot = await bridge.sample({ entities: [entity] });
  const position = entityPosition(snapshot, entity);
  if (position !== undefined) positions.push(position);
}

function accumulatedPathLength(positions: readonly PlaytestVec3[]): number | undefined {
  if (positions.length < 2) return undefined;
  return positions.slice(1).reduce(
    (total, position, index) => total + length(subtract(position, positions[index] ?? position)),
    0,
  );
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

function observedEntityIds(scenario: IPlaytestScenario): string[] | undefined {
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

function observedResourceIds(scenario: IPlaytestScenario): string[] {
  return [...new Set([
    ...(scenario.assert?.resources ?? []).map(({ id }) => id),
    ...(scenario.setup?.resources ?? []).map(({ id }) => id),
  ])];
}

async function sampleHud(page: Page, assertions: readonly IPlaytestPathAssertion[]): Promise<Record<string, unknown>> {
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

function pairObservations(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { after?: unknown; before?: unknown }> {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Object.fromEntries([...ids].map((id) => [id, {
    ...(before[id] === undefined ? {} : { before: before[id] }),
    ...(after[id] === undefined ? {} : { after: after[id] }),
  }]));
}

function entityPosition(snapshot: IPlaytestObservationSnapshot | undefined, id: string): PlaytestVec3 | undefined {
  return snapshot?.entities?.find((entity) => entity.id === id)?.transform?.position;
}

function isAnonymousMovementScenario(scenario: IPlaytestScenario): boolean {
  return scenario.assert?.movement !== undefined
    && scenario.assert.movement.entity === undefined
    && scenario.subject === undefined;
}

function observedMovementSample(
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

function observedMovementEntities(
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

function movementRate(sample: IMovementSampleInterval, entity: string): number | undefined {
  const beforePosition = entityPosition(sample.before, entity);
  const afterPosition = entityPosition(sample.after, entity);
  if (beforePosition === undefined || afterPosition === undefined) return undefined;
  const duration = movementDuration(sample);
  return duration === undefined ? undefined : length(subtract(afterPosition, beforePosition)) / duration;
}

function movementDuration(sample: IMovementSampleInterval): number | undefined {
  if (sample.before.clock.mode !== sample.after.clock.mode) return undefined;
  const duration = sample.before.clock.mode === "fixed-step"
    ? positiveFiniteDelta(sample.before.clock.tick, sample.after.clock.tick)
    : positiveFiniteDelta(sample.before.clock.timeMs, sample.after.clock.timeMs);
  return duration;
}

function positiveFiniteDelta(before: number | undefined, after: number | undefined): number | undefined {
  if (
    typeof before !== "number"
    || typeof after !== "number"
    || !Number.isFinite(before)
    || !Number.isFinite(after)
  ) return undefined;
  const delta = after - before;
  return Number.isFinite(delta) && delta > 0 ? delta : undefined;
}

function entityRotation(snapshot: IPlaytestObservationSnapshot | undefined, id: string): [number, number, number, number] | undefined {
  return snapshot?.entities?.find((entity) => entity.id === id)?.transform?.rotation;
}

function resourceObservations(before: IPlaytestObservationSnapshot | undefined, after: IPlaytestObservationSnapshot | undefined) {
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

function normalizedRuntimeDiagnostics(
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

async function readCaptureProvenance(
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

function startManagedServer(config: IStandalonePlaytestConfig, dynamicPort?: number): ChildProcess {
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

async function findFreePort(): Promise<number> {
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

function managedPort(config: IStandalonePlaytestConfig): number | undefined {
  if (config.port !== undefined && config.port > 0) return config.port;
  try {
    const parsed = new URL(config.url);
    return parsed.port === "" ? undefined : Number(parsed.port);
  } catch {
    return undefined;
  }
}

function withPort(url: string, port: number): string {
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
const PAGE_NAVIGATED_PATTERN =
  /Execution context was destroyed|frame (?:was )?detached|Target (?:page|closed)/iu;

const TEARDOWN_TIMED_OUT = Symbol("teardown-timed-out");

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

function isPageNavigatedRace(error: unknown): boolean {
  return error instanceof Error && PAGE_NAVIGATED_PATTERN.test(error.message);
}

interface IPageLifecycle {
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

async function assertManagedUrlAvailable(url: string): Promise<void> {
  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(500) });
    await response.body?.cancel();
  } catch {
    return;
  }
  throw managedServerError("Managed server URL is already in use before startup.", url, 0, []);
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

async function stopManagedServer(server: ChildProcess | undefined): Promise<void> {
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

function waitForProcessExit(server: ChildProcess, timeoutMs: number): Promise<boolean> {
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

function managedServerError(message: string, url: string, timeoutMs: number, output: readonly string[]): ManagedServerError {
  return new ManagedServerError(playtestDiagnostic(
    "TN_PLAYTEST_SERVER_FAILED",
    `${message} URL: ${url}. Timeout: ${timeoutMs}ms. Output: ${output.join("").slice(-4_000)}`,
    "Run the server command directly, fix its first error, then rerun the same playtest command.",
  ));
}
