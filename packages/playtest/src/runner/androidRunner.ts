import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  loadPlaytestScenario,
  playtestDiagnostic,
  playtestStepHoldTicks,
  playtestStepWaitTicks,
  resolveDiagnosticsPolicy,
  type IPlaytestDiagnostic,
  type IPlaytestFramebufferCoverageObservation,
  type IPlaytestObservationSnapshot,
  type IPlaytestProtocolDiagnostic,
  type IPlaytestScenario,
  type IPlaytestSetupRequest,
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
import type { IStandalonePlaytestConfig } from "./config.js";
import {
  androidMailboxPaths,
  DeviceBridgeTransport,
  DeviceMailboxTransport,
  type IDevicePlaytestTransport,
  type IDeviceMailbox,
} from "./deviceTransport.js";
import { buildReport, failedDiagnosticsAssertion, playtestStepDrivesMovement, writeObservationArtifacts, type IStandalonePlaytestReport } from "./runner.js";
import { analyzeFramebufferCoverageRecording } from "./videoAnalysis.js";

export interface IAndroidPlaytestDependencies {
  driver?: IAndroidDriver;
  transport?: IDevicePlaytestTransport;
}

export interface IDevicePlaytestDriver {
  captureConsole(): Promise<Array<{ text: string; type: string }>>;
  isAlive(): Promise<boolean>;
  prepare(endpoint: string, mailboxRoot?: string): Promise<void>;
  readFile?(path: string): Promise<string | undefined>;
  removeFile?(path: string): Promise<void>;
  screenshot(path: string): Promise<void>;
  setPointers?(pointers: readonly IAndroidPointer[]): Promise<IAndroidPointerInjection>;
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
    ...(config.device === undefined ? {} : { serial: config.device }),
  });
  const mailboxRoot = config.mailboxRoot ?? `/sdcard/Android/data/${android.packageName}/files`;
  return runDevicePlaytest({ ...config, mailboxRoot }, {
    driver,
    mailboxPaths: androidMailboxPaths(android.packageName, mailboxRoot),
    name: "android",
    processName: android.packageName,
    ...(dependencies.transport === undefined ? {} : { transport: dependencies.transport }),
  });
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
  const unsupported = unsupportedAssertion(scenario, target.name);
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
  const transport = target.transport ?? createDeviceTransport(target.driver, endpoint, target.mailboxPaths);
  let bridge: IPlaytestBridgeClient | undefined;
  let coverageRecordingStarted = false;
  let framebufferCoverage: IPlaytestFramebufferCoverageObservation | undefined;
  const coverageVideoPath = join(config.artifactDirectory, "framebuffer-coverage.mp4");
  try {
    await throwIfAborted(target);
    await transport.start();
    await throwIfAborted(target);
    await target.driver.prepare(endpoint, config.mailboxRoot);
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
    if (scenario.setup !== undefined) await bridge.applySetup(setupRequest(scenario));
    await throwIfAborted(target);
    if (scenario.warmupFrames > 0) await bridge.advance(scenario.warmupFrames);
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
        await target.driver.screenshot(join(config.artifactDirectory, `${safePart(step.screenshot)}.png`));
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
    if (scenario.artifacts?.screenshots !== false) {
      await target.driver.screenshot(join(config.artifactDirectory, "after.png"));
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
      return failureReport(config, scenario, error.diagnostic, target.name);
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
    if (cleanupErrors.length > 0) cleanupState.error = cleanupFailure(cleanupErrors);
  }
}

async function throwIfAborted(target: IDevicePlaytestTarget): Promise<void> {
  if (!target.abortSignal?.aborted) return;
  await target.abortCleanup?.();
  throw new Error("Desktop playtest interrupted by signal.");
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
): IDevicePlaytestTransport {
  if (isMailboxDriver(driver)) {
    const mailbox: IDeviceMailbox = {
      read: (path) => driver.readFile(path),
      remove: (path) => driver.removeFile(path),
      write: (path, contents) => driver.writeFile(path, contents),
    };
    return new DeviceMailboxTransport(mailbox, paths);
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
): IPlaytestProtocolDiagnostic | undefined {
  const hasMultiPointerInput = scenario.steps.some((step) => step.pointers !== undefined);
  if (hasMultiPointerInput && target === "desktop") {
    return unsupportedDiagnostic(
      "complete held-pointer input",
      "Run this scenario on --target browser or --target android; the desktop mailbox host exposes one pointer.",
      target,
    );
  }
  if (scenario.assert?.diagnostics?.noNetworkErrors === true) {
    return unsupportedDiagnostic(
      "network assertions",
      `Run this assertion on --target browser; ${targetLabel(target)} device transport has no CDP network observer.`,
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

function failureReport(
  config: IStandalonePlaytestConfig,
  scenario: IPlaytestScenario,
  diagnostic: IPlaytestProtocolDiagnostic,
  target: "android" | "desktop" | "ios",
): IStandalonePlaytestReport {
  const item: IPlaytestDiagnostic = { ...diagnostic, suggestion: diagnostic.fix.instruction };
  const diagnosticsPolicy = resolveDiagnosticsPolicy(scenario.assert?.diagnostics);
  return {
    artifactDirectory: config.artifactDirectory,
    assertionResults: [failedDiagnosticsAssertion(diagnosticsPolicy)],
    diagnostics: [item],
    diagnosticsPolicy,
    distance: 0,
    entity: scenario.subject ?? "",
    expectMoved: false,
    frames: 0,
    pass: false,
    runtime: "native",
    scenario: scenario.name,
    target,
    trivialityOptOutCount: 0,
    trivialityOptOuts: [],
    url: target === "desktop"
      ? config.desktop?.executable ?? "desktop"
      : config.endpoint ?? "http://127.0.0.1:41777/playtest",
  } as IStandalonePlaytestReport;
}

function targetLabel(target: "android" | "desktop" | "ios"): string {
  if (target === "android") return "Android";
  if (target === "ios") return "iOS";
  return "Desktop";
}

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

function observedEntityIds(scenario: IPlaytestScenario): string[] | undefined {
  if (
    scenario.assert?.movement !== undefined
    && scenario.assert.movement.entity === undefined
    && scenario.subject === undefined
  ) return undefined;
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

function appendPosition(
  positions: PlaytestVec3[],
  snapshot: IPlaytestObservationSnapshot,
  entity: string | undefined,
): void {
  const position = snapshot.entities?.find(({ id }) => id === entity)?.transform?.position;
  if (position !== undefined) positions.push(position);
}

function accumulatedPathLength(positions: readonly PlaytestVec3[]): number | undefined {
  if (positions.length < 2) return undefined;
  return positions.slice(1).reduce((total, position, index) => {
    const before = positions[index] ?? position;
    return total + Math.hypot(
      position[0] - before[0],
      position[1] - before[1],
      position[2] - before[2],
    );
  }, 0);
}

function safePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
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
