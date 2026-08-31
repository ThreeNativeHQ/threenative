import { waitFrames, captureVisualSurface, runStep, screenshotObservations, sampleAfterTransition } from "./steps.js";
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
  IRunnerConsoleEntry,
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
import type { IPlaytestObservationSnapshot } from "../protocol.js";
import { assertCaptureNotBlank, CaptureGuardError } from "../capture.js";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";

import { connectPlaytestBridge, PlaytestBridgeError, type IPlaytestBridgeClient } from "./bridgeClient.js";
import { waitForStartupReady } from "./startupReady.js";
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
  playwrightProfileDirectories,
  removeStrandedProfiles,
  teardownBrowserSession,
  type IRemoteBrowserSession,
} from "./browserSession.js";

/** How long a single screenshot may take before the runner calls it a failure. */
const SCREENSHOT_TIMEOUT_MS = 120_000;

export { preflightDisplay, buildReport } from './runner-support.js';
export { captureVisualSurface } from './steps.js';
export { advanceFixedStep, playtestStepDrivesMovement } from './steps.js';
export { isRuntimeReadout } from './sampling.js';
export { ManagedServerError, failedDiagnosticsAssertion } from './shared.js';
export { resolveManagedServerCommand, substituteManagedPort, boundedTeardownStep, pageLifecycleDiagnostic } from './server.js';
export type { IStandalonePlaytestReport, ILabeledPlaytestSample, IMovementSampleInterval, IRunStepSamples, IRunnerConsoleEntry } from './shared.js';
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
  let profilesBeforeLaunch: readonly string[] | undefined;
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
      // Teardown above is deliberately bounded, and the CLI exits as soon as it returns — so
      // Playwright's own removal of the profile directory may never run. Reclaim what this run
      // launched and nothing else; the orphan gate reports whatever is left.
      if (profilesBeforeLaunch !== undefined) {
        const removed = removeStrandedProfiles(profilesBeforeLaunch);
        if (removed.length > 0) {
          process.stderr.write(
            `${JSON.stringify({ reclaimedBrowserProfiles: removed.length })}\n`,
          );
        }
      }
    })();
    await teardownPromise.catch(() => undefined);
    if (stopManagedServerOnTeardown) await stopServer();
  };
  let tearingDown = false;
  const handleSignal = (): void => {
    // Read by the startup wait so it yields to teardown instead of polling to its own deadline.
    tearingDown = true;
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
    // Snapshot the profiles that already exist, so teardown can tell this run's from a sibling's.
    profilesBeforeLaunch = playwrightProfileDirectories();
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
    const consoleEntries: IRunnerConsoleEntry[] = [];
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
    const setupApplication = bridge?.setupApplication;
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
    }
    await waitFrames(page, scenario.warmupFrames);
    // `warmupFrames` is a fixed count, so whether it covers the application's launch depends on
    // the machine. Where the application reports its own startup, wait for that instead: the
    // baseline below must be read from a game that is running, not from one still loading.
    // `allowSoftwareAdapter` is the operator saying out loud that this machine has no GPU. It is
    // the only thing that relaxes the rule; nothing infers it from a slow run.
    const startupOutcome = bridge === undefined || scenario.awaitStartup === false
      ? undefined
      : await waitForStartupReady({
          aborted: () => tearingDown,
          acceptCompileSettled: activeConfig.allowSoftwareAdapter === true,
          bridge,
          pump: () => waitFrames(activePage, 1),
        });
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
        ...(scenario.assert?.renderChain === undefined ? [] : ["renderChain"]),
      ],
      resources: resourceIds,
    } as const;
    const labeledSamples: ILabeledPlaytestSample[] = [];
    const capturesAnonymousMovement = isAnonymousMovementScenario(scenario);
    // Per-step samples used to be collected only for anonymous movement scenarios. A named entity
    // needs them too, but only as a fallback: when the whole-run window cannot see it — a scenario
    // that opens on a menu has no player at its first snapshot — the report measures the entity
    // between its first and last observation instead of reporting a distance of zero it never
    // measured. Collected whenever a movement assertion exists, which is what pays for them.
    const capturesMovementSamples = capturesAnonymousMovement || scenario.assert?.movement !== undefined;
    const movementSamples: IMovementSampleInterval[] = [];
    const wantsVisual = (scenario.assert?.visual?.length ?? 0) > 0;
    const needsCapture = scenario.artifacts?.screenshots !== false
      || scenario.steps.some((step) => step.screenshot !== undefined)
      || wantsVisual;
    const requiresWebGpuProvenance = browserConfig.browserArgs?.includes("--enable-unsafe-webgpu") === true;
    const captureProvenance = scenario.bootFailure === undefined && (needsCapture || requiresWebGpuProvenance)
      ? await readCaptureProvenance(page, browserConfig, scenario)
      : undefined;
    if (captureProvenance !== undefined) {
      await writeCaptureProvenance(activeConfig.artifactDirectory, captureProvenance);
    }
    let captureFailure: { code: "TN_CAPTURE_BLANK"; label: string; reason: string } | undefined;
    /**
     * One blank-capture grace window. An accelerated canvas can legitimately present nothing at
     * the sampled instant — shader prewarm still settling, HMR re-present, a busy GPU — while the
     * world is one present away from its first visible frame. Wait for two more animation frames
     * (bounded by 500 ms) before the caller shoots again. Not a skip: whatever the second shot
     * shows is final, so a genuinely blank surface still fails closed.
     */
    const presentationGrace = async (): Promise<void> => {
      if (page === undefined || page.isClosed?.()) return;
      await Promise.race([
        page.evaluate(() => new Promise<void>((resolveFrames) => {
          let remaining = 2;
          const tick = (): void => {
            remaining -= 1;
            if (remaining <= 0) resolveFrames();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        })),
        new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 500)),
      ]);
    };
    const capturePage = async (
      label: string,
      requested: Parameters<Page["screenshot"]>[0],
    ): Promise<Buffer | undefined> => {
      // Playwright's 30s default is sized for a machine with a GPU. A CPU rasteriser — SwiftShader
      // on a CI runner, llvmpipe on a headless box — composites the same frame one to two orders
      // of magnitude slower, and the shot times out with `page.screenshot: Timeout 30000ms
      // exceeded` after reporting `fonts loaded`, which reads as a broken game rather than a slow
      // one. The scenario's own timeout still bounds the run; this only stops a slow machine from
      // being reported as a failed capture.
      const options = { timeout: SCREENSHOT_TIMEOUT_MS, ...requested };
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
        await presentationGrace();
        try {
          png = await activePage.screenshot(options);
        } catch {
          // The first shot stands; its blank verdict is what gets reported below.
        }
        try {
          assertCaptureNotBlank(png, label);
          return png;
        } catch (error2) {
          if (!(error2 instanceof CaptureGuardError)) throw error2;
          captureFailure ??= { code: error2.code, label: error2.label, reason: error2.reason };
          return undefined;
        }
      }
    };
    const captureVisualPage = async (
      label: string,
      artifactPath: string | undefined,
    ): Promise<Buffer | undefined> => {
      if (scenario.bootFailure !== undefined) {
        return capturePage(label, artifactPath === undefined ? {} : { path: artifactPath });
      }
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
        await presentationGrace();
        try {
          const retry = await captureVisualSurface(activePage, artifactPath);
          if (retry !== undefined) {
            assertCaptureNotBlank(retry, label);
            return retry;
          }
        } catch (error2) {
          if (!(error2 instanceof CaptureGuardError)) throw error2;
          captureFailure ??= { code: error2.code, label: error2.label, reason: error2.reason };
          return undefined;
        }
        captureFailure ??= { code: error.code, label: error.label, reason: error.reason };
        return undefined;
      }
    };
    const beforeSnapshot = await bridge?.sample(sampleRequest);
    let movementCursor = beforeSnapshot;
    const movementEntity = scenario.assert?.movement?.entity ?? scenario.subject;
    const movementNeedsBaseline = scenario.assert?.movement !== undefined
      && movementEntity !== undefined
      && entityPosition(beforeSnapshot, movementEntity) === undefined;
    let movementBaselineSnapshot: IPlaytestObservationSnapshot | undefined;
    const transitionEntity = scenario.subject ?? movementEntity;
    let transitionSubjectNeedsSettle = transitionEntity !== undefined
      && entityPosition(beforeSnapshot, transitionEntity) === undefined;
    const establishSceneSubject = async (): Promise<void> => {
      if (!transitionSubjectNeedsSettle || bridge === undefined || transitionEntity === undefined || page === undefined) return;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const snapshot = await bridge.sample(sampleRequest);
        if (entityPosition(snapshot, transitionEntity) !== undefined) {
          transitionSubjectNeedsSettle = false;
          if (movementNeedsBaseline && movementBaselineSnapshot === undefined) {
            movementBaselineSnapshot = snapshot;
          }
          return;
        }
        await waitFrames(page, 1);
      }
    };
    const pathEntity = scenario.assert?.movement?.pathLength === undefined
      ? undefined
      : scenario.assert.movement.entity ?? scenario.subject;
    const pathPositions = beforeSnapshot === undefined || pathEntity === undefined
      ? []
      : [entityPosition(beforeSnapshot, pathEntity)].filter((position): position is PlaytestVec3 => position !== undefined);
    const inputState: StepInputState = { heldKeys: new Set(), pointerButtons: 0, pointers: new Map() };
    const hudAssertions = scenario.assert?.hud ?? [];
    const beforeHud = await sampleHud(page, hudAssertions);
    // `--no-screenshots` drops the convenience frames a run takes whether or not anything reads
    // them. A scenario that asserts on a frame keeps `wantsVisual` true and still captures one, so
    // this can never turn a visual assertion into a silent pass.
    const artifactFrames = activeConfig.captureArtifactScreenshots !== false;
    const beforeScreenshot = (scenario.artifacts?.screenshots === "before-after" && artifactFrames) || wantsVisual
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
        capturesMovementSamples || movementNeedsBaseline ? sampleRequest : undefined,
        index === scenario.steps.length - 1,
        scenario.subject,
      );
      if (movementBaselineSnapshot === undefined && movementNeedsBaseline && movementEntity !== undefined) {
        const candidate = stepSamples.afterStep ?? stepSamples.afterInput;
        if (entityPosition(candidate, movementEntity) !== undefined) movementBaselineSnapshot = candidate;
      }
      if (capturesMovementSamples && movementCursor !== undefined && stepSamples.afterInput !== undefined) {
        movementSamples.push({
          after: stepSamples.afterInput,
          before: movementCursor,
          inputDriven: stepSamples.inputDriven,
        });
      }
      if (
        capturesMovementSamples
        && stepSamples.afterInput !== undefined
        && stepSamples.afterStep !== undefined
        && stepSamples.afterStep !== stepSamples.afterInput
      ) {
        movementSamples.push({ after: stepSamples.afterStep, before: stepSamples.afterInput, inputDriven: false });
      }
      if (capturesMovementSamples && stepSamples.afterStep !== undefined) {
        movementCursor = stepSamples.afterStep;
      }
      if (step.label === scenario.assert?.framebufferCoverage?.window.endStep) {
        framebufferCoverage = await finishFramebufferCoverageProbe(page, activeConfig.artifactDirectory);
      }
      await establishSceneSubject();
      if (step.label !== undefined && bridge !== undefined) {
        const snapshot = await bridge.sample({ ...sampleRequest, label: step.label });
        if (movementBaselineSnapshot === undefined && movementNeedsBaseline && movementEntity !== undefined
          && entityPosition(snapshot, movementEntity) !== undefined) {
          movementBaselineSnapshot = snapshot;
        }
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
    const afterScreenshot = (scenario.artifacts?.screenshots !== false && artifactFrames) || wantsVisual
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
      movementBaselineSnapshot,
      startupOutcome === undefined
        ? undefined
        : { ...startupOutcome.startup, rule: startupOutcome.rule },
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
      const report = await runStandalonePlaytestInternal({
        ...activeConfig,
        artifactDirectory: batchArtifactDirectory(activeConfig.artifactDirectory, scenarioPath, index),
        scenarioPath,
        scenarioPaths: undefined,
      }, { managedServer: server });
      reports.push(report);
      // A batch prints one JSON document at the end, and a CI log viewer truncates it — a run of
      // sixteen scenarios reported `"pass": false` with only the first scenario's report readable,
      // so the failing one could not be named at all. One line per scenario, to stderr, as each
      // finishes: the verdict survives truncation and arrives while the run is still going.
      const failedAssertions = (report.assertionResults ?? [])
        .filter(({ pass }) => pass === false)
        .map(({ id }) => id);
      const codes = report.diagnostics.map(({ code }) => code);
      // The code alone made a reader guess. `TN_PLAYTEST_OPERATION_TIMEOUT` says an operation
      // exceeded its budget and not which one, so diagnosing a CI-only failure meant reasoning
      // from `frames: 0` to a conclusion the diagnostic already knew — and the full report, which
      // does carry the message, is exactly what a CI log truncates. Carry the messages of the
      // failing diagnostics on the line that survives.
      const reasons = report.diagnostics
        .filter(({ severity }) => severity === "error")
        .map(({ message }) => message);
      process.stderr.write(
        `${JSON.stringify({
          scenarioSummary: {
            diagnostics: codes,
            failed: failedAssertions,
            ...(reasons.length === 0 ? {} : { reasons }),
            // A fixed-step scenario should reach the same tick on any machine, so a run that
            // disagrees with a developer's is saying the loop did not step the same way — which is
            // a harness or engine property rather than a slow computer. Carried here because the
            // full report is what a CI log truncates, and this line is what survives.
            firstTick: report.before?.tick,
            frames: report.frames,
            lastTick: report.after?.tick,
            pass: report.pass,
            scenario: report.scenario,
          },
        })}\n`,
      );
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
