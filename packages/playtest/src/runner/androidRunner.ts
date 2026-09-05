import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { assertCaptureNotBlank } from "../capture.js";
import {
  loadPlaytestScenario,
  playtestDiagnostic,
  playtestStepHoldTicks,
  playtestStepWaitTicks,
  type IPlaytestFramebufferCoverageObservation,
  type IPlaytestObservationSnapshot,
  type IPlaytestProtocolDiagnostic,
  type IPlaytestScenario,
  type IPlaytestSetupApplication,
  type PlaytestVec3,
} from "../index.js";
import {
  AdbAndroidDriver,
  type IAndroidDriver,
  type IAndroidPointer,
  type IAndroidPointerInjection,
} from "./android.js";
import {
  connectPlaytestBridgeTransport,
  PlaytestBridgeError,
  type IPlaytestBridgeClient,
} from "./bridgeClient.js";
import { waitForStartupReady } from "./startupReady.js";
import type { IStandalonePlaytestConfig } from "./config.js";
import { DeviceMetricsRecorder } from "./deviceMetrics.js";
import {
  androidMailboxPaths,
  DeviceBridgeTransport,
  DeviceMailboxTransport,
  deviceTimeoutDiagnostic,
  type IDevicePlaytestTransport,
  type IDeviceMailbox,
} from "./deviceTransport.js";
import { withTargetAbortSignal } from "./deviceSignal.js";
import { buildReport, playtestStepDrivesMovement, writeObservationArtifacts } from "./runner.js";
import { analyzeFramebufferCoverageRecording } from "./videoAnalysis.js";
import {
  accumulatedPathLength,
  appendPosition,
  failureReport,
  observedEntityIds,
  observedResourceIds,
  safePart,
  targetLabel,
  throwIfAborted,
} from "./shared.js";
import type { IStandalonePlaytestReport } from "./shared.js";

export interface IAndroidPlaytestDependencies {
  abortSignal?: AbortSignal;
  driver?: IAndroidDriver;
  transport?: IDevicePlaytestTransport;
}

export interface IDevicePlaytestDriver {
  captureConsole(): Promise<Array<{ text: string; type: string }>>;
  deviceSerial?(): string | undefined;
  isAlive(): Promise<boolean>;
  prepare(
    endpoint: string,
    mailboxRoot?: string,
    viewport?: { height: number; width: number },
  ): Promise<void>;
  readFile?(path: string): Promise<string | undefined>;
  removeFile?(path: string): Promise<void>;
  runAdb?(args: readonly string[]): Promise<string>;
  screenshot(path: string): Promise<void>;
  setPointers?(pointers: readonly IAndroidPointer[]): Promise<IAndroidPointerInjection>;
  tap?(x: number, y: number): Promise<void>;
  hideKeyboard?(): Promise<boolean>;
  startScreenRecording?(): Promise<void>;
  stop(): Promise<void>;
  stopScreenRecording?(path: string): Promise<void>;
  writeFile?(path: string, contents: string): Promise<void>;
}

export interface IDevicePlaytestTarget {
  abortCleanup?: () => Promise<void>;
  abortSignal?: AbortSignal;
  driver: IDevicePlaytestDriver;
  mailboxPaths: ReturnType<typeof androidMailboxPaths>;
  name: "android" | "desktop" | "ios";
  processName: string;
  transport?: IDevicePlaytestTransport;
}

interface IDevicePlaytestCleanupState {
  error?: Error;
}

export async function runAndroidPlaytest(
  config: IStandalonePlaytestConfig,
  dependencies: IAndroidPlaytestDependencies = {},
): Promise<IStandalonePlaytestReport> {
  const endpoint = config.endpoint ?? "http://127.0.0.1:41777/playtest";
  const android = config.android ?? {
    activity: ".MystralActivity",
    packageName: "com.mystral.engine",
  };
  const driver = dependencies.driver ?? new AdbAndroidDriver({
    ...android,
    ...(config.adbPath === undefined ? {} : { adbPath: config.adbPath }),
    ...(config.touchRotation === undefined ? {} : { touchRotation: config.touchRotation }),
    ...(config.device === undefined ? {} : { serial: config.device }),
  });
  const mailboxRoot = config.mailboxRoot ?? `/sdcard/Android/data/${android.packageName}/files`;
  return withTargetAbortSignal("android", (abortSignal) => runDevicePlaytest({ ...config, mailboxRoot }, {
    abortSignal: abortSignal,
    driver,
    mailboxPaths: androidMailboxPaths(android.packageName, mailboxRoot),
    name: "android",
    processName: android.packageName,
    ...(dependencies.transport === undefined ? {} : { transport: dependencies.transport }),
  }), dependencies.abortSignal);
}

export async function runDevicePlaytest(
  config: IStandalonePlaytestConfig,
  target: IDevicePlaytestTarget,
): Promise<IStandalonePlaytestReport> {
  const cleanupState: IDevicePlaytestCleanupState = {};
  let report: IStandalonePlaytestReport;
  try {
    report = await runDevicePlaytestInternal(config, target, cleanupState);
  } catch (error) {
    if (cleanupState.error === undefined) throw error;
    throw cleanupFailure([error, cleanupState.error]);
  }
  if (cleanupState.error !== undefined) throw cleanupState.error;
  return report;
}

async function runDevicePlaytestInternal(
  config: IStandalonePlaytestConfig,
  target: IDevicePlaytestTarget,
  cleanupState: IDevicePlaytestCleanupState,
): Promise<IStandalonePlaytestReport> {
  const scenario = await loadPlaytestScenario(config.projectPath, config.scenarioPath);
  await throwIfAborted(target);
  await mkdir(config.artifactDirectory, { recursive: true });
  await throwIfAborted(target);
  const unsupported = unsupportedAssertion(
    scenario,
    target.name,
    typeof target.driver.tap === "function",
  );
  if (unsupported !== undefined) return failureReport(config, scenario, unsupported, target.name);
  if (
    target.name === "android"
    && scenario.assert?.framebufferCoverage !== undefined
    && (typeof target.driver.startScreenRecording !== "function"
      || typeof target.driver.stopScreenRecording !== "function")
  ) {
    return failureReport(config, scenario, unsupportedDiagnostic(
      "framebuffer coverage recording",
      "Use the adb-backed Android driver; framebuffer coverage requires screenrecord and offline ffmpeg analysis.",
      target.name,
    ), target.name);
  }
  if (
    target.name === "android"
    && scenario.steps.some((step) => step.pointers !== undefined)
    && typeof target.driver.setPointers !== "function"
  ) {
    return failureReport(config, scenario, unsupportedDiagnostic(
      "complete held-pointer input",
      "Use the emulator-backed Android driver; multi-pointer steps cannot fall back to one-pointer bridge input.",
      target.name,
    ), target.name);
  }
  const endpoint = config.endpoint ?? "http://127.0.0.1:41777/playtest";
  const transport = target.transport ?? createDeviceTransport(
    target.driver,
    endpoint,
    target.mailboxPaths,
    config.timeoutMs,
  );
  let bridge: IPlaytestBridgeClient | undefined;
  let setupApplication: IPlaytestSetupApplication | undefined;
  let coverageRecordingStarted = false;
  let framebufferCoverage: IPlaytestFramebufferCoverageObservation | undefined;
  const coverageVideoPath = join(config.artifactDirectory, "framebuffer-coverage.mp4");
  const metrics = deviceMetricsRecorder(target);
  try {
    await throwIfAborted(target);
    await transport.start();
    await throwIfAborted(target);
    // Sampled before prepare(): prepare force-stops the app and clears logcat, so this is the
    // only point at which the device's pre-launch thermal baseline is still readable.
    await metrics?.sampleNow("before").catch(() => undefined);
    metrics?.start();
    await target.driver.prepare(endpoint, config.mailboxRoot, scenario.viewport);
    await throwIfAborted(target);
    bridge = await connectPlaytestBridgeTransport(transport, scenario, config.timeoutMs);
    await throwIfAborted(target);
    if (bridge === undefined) {
      return failureReport(config, scenario, playtestDiagnostic(
        "TN_PLAYTEST_BRIDGE_MISSING",
        `${targetLabel(target.name)} application did not expose a playtest bridge.`,
        "Install playtest() or installThreePlaytestBridge() in the device build.",
      ), target.name);
    }
    if (!bridge.description.capabilities.includes("runtime.fixedStep")) {
      return failureReport(config, scenario, unsupportedDiagnostic(
        "deterministic frame steps",
        "Install a bridge with runtime.fixedStep; device scenarios never fall back to wall-clock sleeps.",
        target.name,
      ), target.name);
    }
    await throwIfAborted(target);
    setupApplication = bridge.setupApplication;
    await throwIfAborted(target);
    if (scenario.warmupFrames > 0) await bridge.advance(scenario.warmupFrames);
    await throwIfAborted(target);
    // Same boundary as the browser lane: a fixed-step warmup is a tick count, not the clock the
    // application's launch runs on, so wait for the device to say its world is safe to observe.
    const attached = bridge;
    if (scenario.awaitStartup !== false)
      await waitForStartupReady({
        acceptCompileSettled: config.allowSoftwareAdapter === true,
        bridge: attached,
        pump: () => attached.advance(1),
      });
    await throwIfAborted(target);

    const entityIds = observedEntityIds(scenario);
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
      ],
      resources: observedResourceIds(scenario),
    } as const;
    const before = await bridge.sample(sampleRequest);
    const pathEntity = scenario.assert?.movement?.pathLength === undefined
      ? undefined
      : scenario.assert.movement.entity ?? scenario.subject;
    const pathPositions: PlaytestVec3[] = [];
    appendPosition(pathPositions, before, pathEntity);
    const capturesAnonymousMovement = scenario.assert?.movement !== undefined
      && scenario.assert.movement.entity === undefined
      && scenario.subject === undefined;
    const movementSamples: Array<{ after: IPlaytestObservationSnapshot; before: IPlaytestObservationSnapshot; inputDriven: boolean }> = [];
    let movementCursor = before;
    const labeledSamples: Array<{ label: string; signals: unknown[]; snapshot: IPlaytestObservationSnapshot }> = [];
    const heldKeys = new Set<string>();
    let pointerButtons = 0;
    let pointerCount = 0;
    for (const [index, step] of scenario.steps.entries()) {
      await throwIfAborted(target);
      const framebufferAssertion = scenario.assert?.framebufferCoverage;
      if (
        target.name === "android"
        && framebufferAssertion !== undefined
        && step.label === framebufferAssertion.window.startStep
      ) {
        try {
          await target.driver.startScreenRecording?.();
          coverageRecordingStarted = true;
          // Fixed-step calls can finish all eight scenario frames before Android's observed
          // ~15 fps recorder emits one. The opt-in pixel probe deliberately paces those renders.
          await delay(100);
        } catch (error) {
          framebufferCoverage = unreadableCoverageObservation(error);
        }
      }
      if (step.kind === "click") {
        await executeDeviceClickStep(target, bridge, step, scenario.viewport);
      }
      if (step.pointerPosition !== undefined) {
        const previousPointerButtons = pointerButtons;
        pointerButtons = step.pointerPosition.buttons ?? pointerButtons;
        await transport.call("input.pointer", {
          buttons: pointerButtons,
          type: pointerButtons === 0 ? "move" : previousPointerButtons === 0 ? "down" : "move",
          x: step.pointerPosition.x * scenario.viewport.width,
          y: step.pointerPosition.y * scenario.viewport.height,
        });
      }
      if (step.pointers !== undefined) {
        await setDevicePointers(target, transport, step.pointers, scenario.viewport);
        pointerCount = step.pointers.length;
      }
      const pressed = step.press;
      if (typeof pressed === "string") {
        if (!heldKeys.has(pressed)) {
          await transport.call("input.keyDown", { key: pressed });
          await sendAndroidTextInput(target, pressed);
          heldKeys.add(pressed);
        }
      } else if (pressed !== undefined) {
        for (const key of [...heldKeys]) {
          if (!pressed.includes(key)) {
            await transport.call("input.keyUp", { key });
            heldKeys.delete(key);
          }
        }
        for (const key of pressed) {
          if (!heldKeys.has(key)) {
            await transport.call("input.keyDown", { key });
            await sendAndroidTextInput(target, key);
            heldKeys.add(key);
          }
        }
      }
      const inputDriven = playtestStepDrivesMovement(
        step,
        heldKeys.size > 0 || pointerButtons !== 0 || pointerCount > 0,
      );
      const movementBefore = capturesAnonymousMovement ? movementCursor : undefined;
      const frames = Math.max(
        1,
        playtestStepHoldTicks(step, 0) + playtestStepWaitTicks(step),
        (step.holdFrames ?? 0) + (step.waitFrames ?? 0),
      );
      if (coverageRecordingStarted) {
        for (let frame = 0; frame < frames; frame += 1) {
          await bridge.advance(1);
          await delay(100);
        }
      } else {
        await bridge.advance(frames);
      }
      const afterInput = await bridge.sample(sampleRequest);
      appendPosition(pathPositions, afterInput, pathEntity);
      if (movementBefore !== undefined) {
        movementSamples.push({ after: afterInput, before: movementBefore, inputDriven });
      }
      let afterStep = afterInput;
      if (step.label !== undefined) {
        const snapshot = await bridge.sample({ ...sampleRequest, label: step.label });
        const signals = bridge.description.capabilities.includes("runtime.events")
          ? await bridge.drainEvents()
          : [];
        labeledSamples.push({ label: step.label, signals, snapshot });
      }
      if (step.screenshot !== undefined) {
        await captureDeviceScreenshot(
          target,
          join(config.artifactDirectory, `${safePart(step.screenshot)}.png`),
        );
      }
      if (step.release && pressed !== undefined) {
        const released = typeof pressed === "string" ? [pressed] : [...pressed];
        for (const key of released) {
          await transport.call("input.keyUp", { key });
          heldKeys.delete(key);
        }
        if (index !== scenario.steps.length - 1) {
          await bridge.advance(1);
          if (capturesAnonymousMovement) afterStep = await bridge.sample(sampleRequest);
        }
      }
      if (step.pointerPosition?.buttons !== undefined && step.release) {
        pointerButtons = 0;
        await transport.call("input.pointer", { buttons: 0, type: "up", x: 0, y: 0 });
      }
      if (step.pointers !== undefined && step.release) {
        await setDevicePointers(target, transport, [], scenario.viewport);
        pointerCount = 0;
        await bridge.advance(1);
        if (capturesAnonymousMovement) afterStep = await bridge.sample(sampleRequest);
      }
      if (
        movementBefore !== undefined
        && afterInput !== undefined
        && afterStep !== afterInput
      ) {
        movementSamples.push({ after: afterStep, before: afterInput, inputDriven: false });
      }
      if (capturesAnonymousMovement) movementCursor = afterStep;
      if (
        coverageRecordingStarted
        && target.name === "android"
        && framebufferAssertion !== undefined
        && step.label === framebufferAssertion.window.endStep
      ) {
        try {
          await target.driver.stopScreenRecording?.(coverageVideoPath);
          coverageRecordingStarted = false;
          framebufferCoverage = await analyzeFramebufferCoverageRecording(
            coverageVideoPath,
            config.artifactDirectory,
            framebufferAssertion,
            "scenario-steps",
          );
        } catch (error) {
          coverageRecordingStarted = false;
          framebufferCoverage = unreadableCoverageObservation(error);
        }
      }
    }
    const after = await bridge.sample(sampleRequest);
    appendPosition(pathPositions, after, pathEntity);
    metrics?.stop();
    await metrics?.sampleNow("after").catch(() => undefined);
    if (scenario.artifacts?.screenshots !== false) {
      await captureDeviceScreenshot(target, join(config.artifactDirectory, "after.png"));
    }
    if (!(await target.driver.isAlive())) {
      return failureReport(config, scenario, playtestDiagnostic(
        "TN_PLAYTEST_DEVICE_FAILED",
        `${targetLabel(target.name)} process '${target.processName}' exited before assertions were evaluated.`,
        `Inspect ${target.name === "android" ? "logcat" : "unified logs"}, fix the first native or JavaScript error, then rerun the same scenario.`,
      ), target.name);
    }
    const consoleEntries = await target.driver.captureConsole();
    const report = buildReport(
      config,
      scenario,
      before,
      after,
      consoleEntries,
      [],
      accumulatedPathLength(pathPositions),
      {},
      true,
      undefined,
      labeledSamples,
      framebufferCoverage,
      undefined,
      undefined,
      movementSamples,
      setupApplication,
      metrics?.observation(),
    );
    // Same artifacts as the browser target: a diagnostic that names console.json must find it
    // there whichever target produced the run.
    await writeObservationArtifacts(config.artifactDirectory, scenario.artifacts, {
      console: consoleEntries,
      network: [],
      runtimeTrace: undefined,
    });
    return {
      ...report,
      runtime: "native",
      target: target.name,
      url: target.name === "desktop" ? config.desktop?.executable ?? target.processName : endpoint,
    };
  } catch (error) {
    if (error instanceof PlaytestBridgeError) {
      let diagnostic = error.diagnostic;
      if (diagnostic.code === "TN_PLAYTEST_OPERATION_TIMEOUT") {
        // A timed-out operation must say what stopped answering: a host whose process exited is
        // a crash with evidence in its console tail, not a generic timeout (PRD-167).
        const hostAlive = await target.driver.isAlive().catch(() => undefined);
        const lastConsoleLines = hostAlive === false
          ? (await target.driver.captureConsole().catch(() => [])).slice(-6).map((entry) => entry.text)
          : [];
        diagnostic = deviceTimeoutDiagnostic(diagnostic, hostAlive, lastConsoleLines);
      }
      return failureReport(config, scenario, diagnostic, target.name);
    }
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    const attemptCleanup = async (cleanup: () => Promise<void>): Promise<void> => {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };
    if (scenario.steps.some((step) => step.pointers !== undefined)) {
      await attemptCleanup(async () => {
        if (target.name === "ios") {
          await transport.call("input.pointers", { pointers: [] });
        } else if (target.name === "android") {
          await target.driver.setPointers?.([]);
        }
      });
    }
    await attemptCleanup(() => target.driver.stop());
    await attemptCleanup(async () => {
      await bridge?.close();
    });
    await attemptCleanup(() => transport.close());
    metrics?.stop();
    if (cleanupErrors.length > 0) cleanupState.error = cleanupFailure(cleanupErrors);
  }
}

async function captureDeviceScreenshot(
  target: IDevicePlaytestTarget,
  path: string,
): Promise<void> {
  await target.driver.screenshot(path);
  assertCaptureNotBlank(await readFile(path), path);
}

/**
 * Only the Android lane can measure the device: desktop and iOS have no adb passthrough, and a
 * driver without `runAdb` (a test double, or a transport-only driver) reports nothing rather
 * than reporting invented zeros. A scenario that *asserts* device metrics never reaches here on
 * those targets — `unsupportedAssertion` fails it and names android first.
 */
function deviceMetricsRecorder(target: IDevicePlaytestTarget): DeviceMetricsRecorder | undefined {
  if (target.name !== "android") return undefined;
  const runAdb = target.driver.runAdb?.bind(target.driver);
  if (runAdb === undefined) return undefined;
  const serial = target.driver.deviceSerial?.();
  return new DeviceMetricsRecorder({
    adb: runAdb,
    ...(serial === undefined ? {} : { serial }),
  });
}

function cleanupFailure(errors: readonly unknown[]): Error {
  if (errors.length === 1) {
    const error = errors[0];
    return error instanceof Error ? error : new Error(String(error));
  }
  return new AggregateError(errors, "Device playtest cleanup failed.");
}

function createDeviceTransport(
  driver: IDevicePlaytestDriver,
  endpoint: string,
  paths: ReturnType<typeof androidMailboxPaths>,
  operationTimeoutMs: number,
): IDevicePlaytestTransport {
  if (isMailboxDriver(driver)) {
    const mailbox: IDeviceMailbox = {
      read: (path) => driver.readFile(path),
      remove: (path) => driver.removeFile(path),
      write: (path, contents) => driver.writeFile(path, contents),
    };
    return new DeviceMailboxTransport(mailbox, paths, operationTimeoutMs);
  }
  return new DeviceBridgeTransport(endpoint);
}

async function setDevicePointers(
  target: IDevicePlaytestTarget,
  transport: IDevicePlaytestTransport,
  pointers: NonNullable<IPlaytestScenario["steps"][number]["pointers"]>,
  viewport: IPlaytestScenario["viewport"],
): Promise<void> {
  if (target.name === "ios") {
    // iOS simulator and device transports already carry playtest requests into the native host.
    // The host's touch PointerEvent seam preserves the complete held set without depending on an
    // external HID injector that is unavailable on the supported Xcode transport.
    await transport.call("input.pointers", {
      pointers: pointers.map((pointer) => ({
        ...(pointer.buttons === undefined ? {} : { buttons: pointer.buttons }),
        id: pointer.id,
        x: pointer.x * viewport.width,
        y: pointer.y * viewport.height,
      })),
    });
    return;
  }
  await target.driver.setPointers?.(pointers);
}

async function executeDeviceClickStep(
  target: IDevicePlaytestTarget,
  bridge: IPlaytestBridgeClient | undefined,
  step: IPlaytestScenario["steps"][number],
  viewport: IPlaytestScenario["viewport"],
): Promise<void> {
  if (target.name !== "android" || typeof target.driver.tap !== "function") {
    throw new PlaytestBridgeError(unsupportedDiagnostic(
      "click steps",
      "Run click steps on --target browser, or use an Android driver with OS pointer injection; native targets never fall back to keyboard input.",
      target.name,
    ));
  }
  const point = await deviceClickPoint(bridge, step);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0
    || point.x > viewport.width || point.y > viewport.height) {
    throw new PlaytestBridgeError(unsupportedDiagnostic(
      "click steps",
      `Resolve the click target inside the ${viewport.width}x${viewport.height} viewport; Android touch injection uses viewport pixels.`,
      target.name,
    ));
  }
  // The soft keyboard first, and never as a nicety. On a physical device, focusing a text field
  // opens an IME window over the bottom of the screen and the page reflows into what is left, so
  // the menu rides up and this coordinate now points at a key. The tap would not miss quietly —
  // it types into the field it was meant to submit. The emulator raises no IME, which is exactly
  // why this went unseen there.
  await target.driver.hideKeyboard?.();
  await target.driver.tap(point.x, point.y);
}

async function deviceClickPoint(
  bridge: IPlaytestBridgeClient | undefined,
  step: IPlaytestScenario["steps"][number],
): Promise<{ x: number; y: number }> {
  const target = step.at;
  if (target === undefined) {
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_UNSUPPORTED_ON_TARGET",
      "Click step has no target.",
      "Declare at as viewport pixels ({ x, y }) or a registered entity ({ entity }).",
    ));
  }
  if (!("entity" in target)) return { x: target.x, y: target.y };
  if (bridge === undefined) {
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_UNSUPPORTED_ON_TARGET",
      `Click target entity '${target.entity}' cannot be resolved without a playtest bridge.`,
      "Install the playtest bridge and register the clickable entity, or use explicit viewport pixels.",
    ));
  }
  const snapshot = await bridge.sample({ entities: [target.entity] });
  const bounds = snapshot.entities?.find((candidate) => candidate.id === target.entity)?.bounds;
  if (bounds === undefined) {
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_UNSUPPORTED_ON_TARGET",
      `Click target entity '${target.entity}' has no observed screen bounds.`,
      "Register a visible entity with the playtest bridge, or use explicit viewport pixels.",
    ));
  }
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

async function sendAndroidTextInput(target: IDevicePlaytestTarget, key: string): Promise<void> {
  if (target.name !== "android" || target.driver.runAdb === undefined) return;
  const keyEvent = androidKeyEventCode(key);
  if (keyEvent === undefined) return;
  // The game mailbox still receives input.keyDown above. This OS-level text event is the
  // companion path for a focused WebView input; it never replaces the touch used to focus it.
  await target.driver.runAdb(["shell", "input", "keyevent", keyEvent]);
}

function androidKeyEventCode(key: string): string | undefined {
  if (key === " ") return "KEYCODE_SPACE";
  const normalized = key.toUpperCase();
  return /^[A-Z0-9]$/u.test(normalized) ? `KEYCODE_${normalized}` : undefined;
}

function isMailboxDriver(
  driver: IDevicePlaytestDriver,
): driver is IDevicePlaytestDriver & Required<Pick<IDevicePlaytestDriver, "readFile" | "removeFile" | "writeFile">> {
  return typeof driver.readFile === "function"
    && typeof driver.removeFile === "function"
    && typeof driver.writeFile === "function";
}

function unsupportedAssertion(
  scenario: IPlaytestScenario,
  target: "android" | "desktop" | "ios",
  hasPointerTransport: boolean,
): IPlaytestProtocolDiagnostic | undefined {
  if (scenario.steps.some((step) => step.wheel !== undefined)) {
    return unsupportedDiagnostic(
      "wheel input steps",
      "Run wheel input steps on --target browser; Android, desktop, and iOS runners have no wheel injector and will not skip the sample.",
      target,
    );
  }
  if (scenario.steps.some((step) => step.kind === "click")
    && (target !== "android" || !hasPointerTransport)) {
    return unsupportedDiagnostic(
      "click steps",
      "Run click steps on --target browser, or use an Android driver with OS pointer injection; native targets never fall back to keyboard input.",
      target,
    );
  }
  const hasMultiPointerInput = scenario.steps.some((step) => step.pointers !== undefined);
  if (hasMultiPointerInput && target === "desktop") {
    return unsupportedDiagnostic(
      "complete held-pointer input",
      "Run this scenario on --target browser or --target android; the desktop mailbox host exposes one pointer.",
      target,
    );
  }
  if (scenario.assert?.deviceMetrics !== undefined && target !== "android") {
    return unsupportedDiagnostic(
      "device thermal and power assertions",
      `Run this assertion on --target android; ${targetLabel(target)} has no battery, thermal or power-rail probe.`,
      target,
    );
  }
  // Only an explicit `true`. The omitted case is no longer the same question: since
  // `resolveDiagnosticsPolicy` learned the run target, a device lane defaults the network channel
  // *off* with the reason recorded, rather than defaulting it on and comparing it to an
  // observation that is hardwired empty. A scenario that spells out `true` is still asking the
  // target for something it cannot do, and still fails here by name.
  if (scenario.assert?.diagnostics?.noNetworkErrors === true) {
    return unsupportedDiagnostic(
      "network assertions",
      `Run this assertion on --target browser; ${targetLabel(target)} device transport has no CDP network observer. Declare "diagnostics": { "noNetworkErrors": false, "networkErrorsOptOutReason": "..." } to say so in the scenario — the default is on, so omitting it asserts the lane rather than waiving it.`,
      target,
    );
  }
  if ((scenario.assert?.hud?.length ?? 0) > 0 || (scenario.assert?.overlayNodes?.length ?? 0) > 0) {
    return unsupportedDiagnostic(
      "DOM assertions",
      `Use runtime resources/components for a cross-target scenario; ${targetLabel(target)} has no DOM observer.`,
      target,
    );
  }
  if ((scenario.assert?.visual?.length ?? 0) > 0) {
    return unsupportedDiagnostic(
      "visual assertions",
      `${targetLabel(target)} screenshots are captured as artifacts, but visual metric evaluation is not supported yet.`,
      target,
    );
  }
  if (scenario.assert?.framebufferCoverage !== undefined && target === "ios") {
    return unsupportedDiagnostic(
      "framebuffer coverage recording",
      "Run this assertion on --target browser or --target android; the iOS transport has no per-frame recorder observer.",
      target,
    );
  }
  if (scenario.assert?.framebufferCoverage !== undefined && target === "desktop") {
    return unsupportedDiagnostic(
      "framebuffer coverage recording",
      "Run this assertion on --target browser or --target android; the desktop mailbox exposes screenshots, not a per-frame recorder observer.",
      target,
    );
  }
  return undefined;
}

function unsupportedDiagnostic(
  subject: string,
  fix: string,
  target: "android" | "desktop" | "ios",
): IPlaytestProtocolDiagnostic {
  return playtestDiagnostic(
    "TN_PLAYTEST_UNSUPPORTED_ON_TARGET",
    `${targetLabel(target)} ${target === "desktop" ? "desktop" : "device"} target does not support ${subject}.`,
    fix,
  );
}

function unreadableCoverageObservation(error: unknown): IPlaytestFramebufferCoverageObservation {
  return {
    boundarySource: "scenario-steps",
    frameCount: 0,
    unreadableReason: error instanceof Error ? error.message : String(error),
    windowCompleted: false,
    windowStarted: false,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
