import { applyScenarioSetup, waitFrames, captureVisualSurface, runStep, screenshotObservations, sampleAfterTransition } from "./steps.js";
import type { StepInputState } from "./steps.js";
import { preflightDisplay, acquireRunnerCaptureLock, provideRunDisplay, buildReport, addPreflightDiagnostic } from "./runner-support.js";
import type { IPageLifecycle } from "./server.js";
import { stopManagedServer, boundedTeardownStep, settledTeardownValue, assertManagedUrlAvailable, startManagedServer, waitForUrl, openPageAndConnectBridge, pageLifecycleDiagnostic, findFreePort, withPort } from "./server.js";
import { readCaptureProvenance, sampleHud, pairObservations, normalizedRuntimeDiagnostics } from "./sampling.js";
import { accumulatedPathLength, entityPosition, failureReport, interruptedPlaytestError, isAnonymousMovementScenario, observedEntityIds, observedResourceIds, safePart } from "./shared.js";
import {
  failedDiagnosticsAssertion,
  ManagedServerError,
  MAX_FIXED_STEP_STARTUP_RETRIES,
  STOPPED_LOOP_ERROR,
  UNHANDLED_REJECTION_PREFIX,
} from "./shared.js";
import type {
  IRunStepSamples,
  IStandalonePlaytestReport,
  ILabeledPlaytestSample,
  IMovementSampleInterval,
  RunnerConsoleEntry,
} from "./shared.js";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import {
  evaluateRichPlaytestAssertions,
  loadPlaytestScenario,
  playtestDiagnostic,
  playtestStepHoldTicks,
  playtestStepWaitTicks,
  resolveDiagnosticsPolicy,
  type IPlaytestArtifactRequest,
  type IPlaytestCaptureProvenance,
  type IPlaytestFramebufferCoverageObservation,
  type IPlaytestScenario,
  type IPlaytestSetupApplication,
  type PlaytestVec3,
} from "../index.js";
import { assertCaptureNotBlank, CaptureGuardError } from "../capture.js";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";

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
import {
  openRunnerPage,
  remoteBrowserFor,
  teardownBrowserSession,
  type IRemoteBrowserSession,
} from "./browserSession.js";

export { preflightDisplay, buildReport } from './runner-support.js';
export { captureVisualSurface } from './steps.js';
export { advanceFixedStep, playtestStepDrivesMovement } from './steps.js';
export { isRuntimeReadout } from './sampling.js';
export { ManagedServerError, failedDiagnosticsAssertion } from './shared.js';
export { resolveManagedServerCommand, substituteManagedPort, boundedTeardownStep, pageLifecycleDiagnostic } from './server.js';
export type { IStandalonePlaytestReport, ILabeledPlaytestSample, IMovementSampleInterval, IRunStepSamples, RunnerConsoleEntry } from './shared.js';
export { STANDALONE_PLAYTEST_OBSERVATION_FIELDS } from "./observationFields.js";

export async function handlePlaytestSignal(
  teardown: (stopManagedServer: boolean) => Promise<void>,
  setExitCode: (code: number) => void = (code) => {
    process.exitCode = code;
  },
  exit: (code: number) => void = (code) => {
    process.exit(code);
  },
  target = "browser",
  writeMessage: (message: string) => void = (message) => {
    process.stderr.write(`${message}\n`);
  },
): Promise<void> {
  await teardown(true).catch(() => undefined);
  writeMessage(interruptedPlaytestError(target).message);
  setExitCode(2);
  exit(2);
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

export interface IStandalonePlaytestRunOptions {
  managedServer?: ChildProcess;
}

interface IStandalonePlaytestInternalOptions extends IStandalonePlaytestRunOptions {
  remoteBrowser?: IRemoteBrowserSession;
}

export async function runStandalonePlaytest(
  config: IStandalonePlaytestConfig,
  options: IStandalonePlaytestRunOptions = {},
): Promise<IStandalonePlaytestReport> {
  return runStandalonePlaytestInternal(config, {
    ...options,
    remoteBrowser: remoteBrowserFor(config),
  });
}

async function runStandalonePlaytestInternal(
  config: IStandalonePlaytestConfig,
  options: IStandalonePlaytestInternalOptions = {},
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
  let browserLaunch: Promise<Browser> | undefined;
  let context: BrowserContext | undefined;
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
      // Chromium does not always exit when asked — under a virtual display with a live GPU
      // process it can sit in close() forever. The report is already written by this point, so
      // teardown gives up rather than holding the run open; the CLI then exits explicitly.
      // A signal can arrive while chromium.launch() is still in flight, when `browser` is not
      // yet assigned. Closing only the assigned handle would close nothing and exit the process
      // over a live Chromium, stranding it and its profile directory — which is the orphan the
      // suite gate catches. Wait for the launch to settle, then close whatever it produced.
      await teardownBrowserSession(page, context, browser, browserLaunch, options.remoteBrowser);
    })();
    await teardownPromise.catch(() => undefined);
    if (stopManagedServerOnTeardown) await stopServer();
  };
  const handleSignal = (): void => {
    void handlePlaytestSignal(
      (stopManagedServerOnSignal) => teardown(stopManagedServerOnSignal),
      undefined,
      undefined,
      activeConfig.target ?? "browser",
    );
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
  // Pixel-producing runs have their display handled by the runner itself now (a private Xvfb
  // whenever Linux offers no usable X display), so the wrapper-only preflight advice is
  // muted exactly where provisioning answers it; every other run keeps it.
  const needsPixels = options.remoteBrowser === undefined && runNeedsPixels(activeConfig, scenario);
  const preflight = needsPixels ? undefined : preflightDisplay(activeConfig, scenario);
  if (preflight !== undefined) {
    process.stderr.write(`${JSON.stringify({ diagnostics: [preflight] })}\n`);
  }
  let providedDisplay: IProvidedDisplay | undefined;
  let captureLease: ICaptureLease | undefined;
  try {
    if (needsPixels) {
      captureLease = await acquireRunnerCaptureLock();
      providedDisplay = await provideRunDisplay();
    }
    if (activeConfig.server !== undefined && server === undefined) {
      if (!usesFreePort) await assertManagedUrlAvailable(activeConfig.url);
      server = startManagedServer(activeConfig, usesFreePort ? activeConfig.port : undefined);
    }
    if (options.remoteBrowser !== undefined && server !== undefined && options.managedServer === undefined) {
      await waitForUrl(activeConfig.url, activeConfig.server?.timeoutMs ?? activeConfig.timeoutMs, server);
    }
    await options.remoteBrowser?.prepare(activeConfig);
    browserLaunch = options.remoteBrowser === undefined
      ? chromium.launch({
          ...(browserConfig.browserArgs === undefined ? {} : { args: resolveBrowserArguments(browserConfig.browserArgs) }),
          ...(providedDisplay === undefined ? {} : { env: providedDisplay.env }),
          headless: activeConfig.headless,
        })
      : options.remoteBrowser.connect(activeConfig);
    browser = await browserLaunch;
    if (options.remoteBrowser === undefined && server !== undefined && options.managedServer === undefined) {
      await waitForUrl(activeConfig.url, activeConfig.server?.timeoutMs ?? activeConfig.timeoutMs, server);
    }
    context = options.remoteBrowser === undefined
      ? await browser.newContext({ viewport: scenario.viewport })
      : await options.remoteBrowser.context(browser);
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
    const bridge = await openRunnerPage(page, browserConfig, scenario, options.remoteBrowser);
    // From here on the page is expected to stay put; anything that moves it is evidence.
    pageLifecycle.settled = true;
    let setupApplication: IPlaytestSetupApplication | undefined;
    if (scenario.setup !== undefined) {
      // The capability handshake already failed the run when the page has no bridge but
      // setup requires one; this guard keeps that promise explicit instead of relying on
      // registry drift never happening.
      if (bridge === undefined) {
        throw new PlaytestBridgeError(playtestDiagnostic(
          "TN_PLAYTEST_BRIDGE_MISSING",
          "Scenario declares setup overrides but no playtest bridge is installed to receive them.",
          "Install the playtest bridge before application startup.",
        ));
      }
      // A placement that cannot apply throws a named diagnostic; requested vs applied
      // rides into the report either way.
      setupApplication = await applyScenarioSetup(bridge, scenario);
    }
    await waitFrames(page, scenario.warmupFrames);
    const runtimeReady = await page.evaluate(() =>
      document.readyState !== "loading" && document.querySelector("canvas") !== null,
    ).catch(() => false);
    // Vite can abort dependency-prefetch requests while the first document is settling. Those
    // cold-start failures are not gameplay evidence; diagnostics begin at the readiness boundary.
    if (runtimeReady) networkEntries.length = 0;
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
    const requiresWebGpuProvenance = browserConfig.browserArgs?.includes("--enable-unsafe-webgpu") === true;
    const captureProvenance = needsCapture || requiresWebGpuProvenance
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
        scenario.subject,
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
    const afterSnapshot = await sampleAfterTransition(page, bridge, sampleRequest);
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
    const deviceMetrics = await options.remoteBrowser?.finish();
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
      setupApplication,
      deviceMetrics,
    );
    await writeObservationArtifacts(activeConfig.artifactDirectory, scenario.artifacts, {
      console: consoleEntries,
      network: networkEntries,
      runtimeTrace: normalizedRuntimeDiagnostics(afterSnapshot, scenario, consoleEntries),
    });
    if (options.remoteBrowser === undefined) await context.close();
    else await page.close();
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
    // Released last-in-first-out: the browser dies before the display it rendered on, and the
    // display before the lock that serialises displays. Both releases swallow their own errors.
    await providedDisplay?.release().catch(() => undefined);
    await captureLease?.release().catch(() => undefined);
  }
}

export async function runStandalonePlaytests(
  config: IStandalonePlaytestConfig,
): Promise<readonly IStandalonePlaytestReport[]> {
  const scenarioPaths = config.scenarioPaths ?? [config.scenarioPath];
  if (scenarioPaths.length <= 1) {
    return [await runStandalonePlaytestInternal({ ...config, scenarioPath: scenarioPaths[0]! })];
  }
  if (config.server === undefined) {
    const reports: IStandalonePlaytestReport[] = [];
    for (const [index, scenarioPath] of scenarioPaths.entries()) {
      reports.push(await runStandalonePlaytestInternal({
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
      reports.push(await runStandalonePlaytestInternal({
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

export function batchArtifactDirectory(base: string, scenarioPath: string, index: number): string {
  return join(base, `${String(index + 1).padStart(2, "0")}-${safePart(scenarioPath)}`);
}

export async function resolveManagedServerConfig(
  config: IStandalonePlaytestConfig,
): Promise<IStandalonePlaytestConfig> {
  if (config.server === undefined || config.port !== 0) return config;
  const port = await findFreePort();
  return { ...config, port, url: withPort(config.url, port) };
}

export { openPageAndConnectBridge } from './server.js';
