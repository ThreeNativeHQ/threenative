import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  loadPlaytestScenario,
  playtestDiagnostic,
  playtestStepHoldTicks,
  playtestStepWaitTicks,
  type IPlaytestDiagnostic,
  type IPlaytestObservationSnapshot,
  type IPlaytestProtocolDiagnostic,
  type IPlaytestScenario,
  type IPlaytestSetupRequest,
  type PlaytestVec3,
} from "../index.js";
import { AdbAndroidDriver, type IAndroidDriver } from "./android.js";
import {
  connectPlaytestBridgeTransport,
  PlaytestBridgeError,
  type IPlaytestBridgeClient,
} from "./bridgeClient.js";
import type { IStandalonePlaytestConfig } from "./config.js";
import { DeviceBridgeTransport } from "./deviceTransport.js";
import { buildReport, type IStandalonePlaytestReport } from "./runner.js";

export interface IAndroidPlaytestDependencies {
  driver?: IAndroidDriver;
  transport?: DeviceBridgeTransport;
}

export async function runAndroidPlaytest(
  config: IStandalonePlaytestConfig,
  dependencies: IAndroidPlaytestDependencies = {},
): Promise<IStandalonePlaytestReport> {
  const scenario = await loadPlaytestScenario(config.projectPath, config.scenarioPath);
  await mkdir(config.artifactDirectory, { recursive: true });
  const unsupported = unsupportedAssertion(scenario);
  if (unsupported !== undefined) return failureReport(config, scenario, unsupported);
  const endpoint = config.endpoint ?? "http://127.0.0.1:41777/playtest";
  const transport = dependencies.transport ?? new DeviceBridgeTransport(endpoint);
  const android = config.android ?? {
    activity: ".MystralActivity",
    packageName: "com.mystral.engine",
  };
  const driver = dependencies.driver ?? new AdbAndroidDriver({
    ...android,
    ...(config.adbPath === undefined ? {} : { adbPath: config.adbPath }),
    ...(config.device === undefined ? {} : { serial: config.device }),
  });
  let bridge: IPlaytestBridgeClient | undefined;
  try {
    await transport.start();
    await driver.prepare(endpoint);
    bridge = await connectPlaytestBridgeTransport(transport, scenario, config.timeoutMs);
    if (bridge === undefined) {
      return failureReport(config, scenario, playtestDiagnostic(
        "TN_PLAYTEST_BRIDGE_MISSING",
        "Android application did not expose a playtest bridge.",
        "Install playtest() or installThreePlaytestBridge() in the device build.",
      ));
    }
    if (!bridge.description.capabilities.includes("runtime.fixedStep")) {
      return failureReport(config, scenario, unsupportedDiagnostic(
        "deterministic frame steps",
        "Install a bridge with runtime.fixedStep; device scenarios never fall back to wall-clock sleeps.",
      ));
    }
    if (scenario.setup !== undefined) await bridge.applySetup(setupRequest(scenario));
    if (scenario.warmupFrames > 0) await bridge.advance(scenario.warmupFrames);

    const sampleRequest = {
      entities: observedEntityIds(scenario),
      include: ["components", "diagnostics", "entities", "resources"],
      resources: observedResourceIds(scenario),
    } as const;
    const before = await bridge.sample(sampleRequest);
    const pathEntity = scenario.assert?.movement?.pathLength === undefined
      ? undefined
      : scenario.assert.movement.entity ?? scenario.subject;
    const pathPositions: PlaytestVec3[] = [];
    appendPosition(pathPositions, before, pathEntity);
    const labeledSamples: Array<{ label: string; signals: unknown[]; snapshot: IPlaytestObservationSnapshot }> = [];
    const heldKeys = new Set<string>();
    let pointerButtons = 0;
    for (const step of scenario.steps) {
      if (step.pointerPosition !== undefined) {
        pointerButtons = step.pointerPosition.buttons ?? pointerButtons;
        await transport.call("input.pointer", {
          buttons: pointerButtons,
          type: pointerButtons === 0 ? "move" : "down",
          x: step.pointerPosition.x * scenario.viewport.width,
          y: step.pointerPosition.y * scenario.viewport.height,
        });
      }
      const pressed = typeof step.press === "string" ? [step.press] : step.press ?? [];
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
      const frames = Math.max(
        1,
        playtestStepHoldTicks(step, 0) + playtestStepWaitTicks(step),
        (step.holdFrames ?? 0) + (step.waitFrames ?? 0),
      );
      await bridge.advance(frames);
      appendPosition(pathPositions, await bridge.sample(sampleRequest), pathEntity);
      if (step.label !== undefined) {
        const snapshot = await bridge.sample(sampleRequest);
        const signals = bridge.description.capabilities.includes("runtime.events")
          ? await bridge.drainEvents()
          : [];
        labeledSamples.push({ label: step.label, signals, snapshot });
      }
      if (step.screenshot !== undefined) {
        await driver.screenshot(join(config.artifactDirectory, `${safePart(step.screenshot)}.png`));
      }
      if (step.release) {
        for (const key of pressed) {
          await transport.call("input.keyUp", { key });
          heldKeys.delete(key);
        }
        if (pointerButtons !== 0) {
          pointerButtons = 0;
          await transport.call("input.pointer", { buttons: 0, type: "up", x: 0, y: 0 });
        }
      }
    }
    const after = await bridge.sample(sampleRequest);
    appendPosition(pathPositions, after, pathEntity);
    if (scenario.artifacts?.screenshots !== false) {
      await driver.screenshot(join(config.artifactDirectory, "after.png"));
    }
    if (!(await driver.isAlive())) {
      return failureReport(config, scenario, playtestDiagnostic(
        "TN_PLAYTEST_DEVICE_FAILED",
        `Android process '${android.packageName}' exited before assertions were evaluated.`,
        "Inspect logcat, fix the first native or JavaScript error, then rerun the same scenario.",
      ));
    }
    const consoleEntries = await driver.captureConsole();
    if (consoleEntries.some(({ type }) => type === "error" || type === "pageerror")) {
      return failureReport(config, scenario, playtestDiagnostic(
        "TN_PLAYTEST_DEVICE_FAILED",
        "Android logcat contained a runtime error before assertions were evaluated.",
        "Inspect logcat, fix the first native or JavaScript error, then rerun the same scenario.",
      ));
    }
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
    );
    return { ...report, runtime: "native", target: "android", url: endpoint };
  } catch (error) {
    if (error instanceof PlaytestBridgeError) return failureReport(config, scenario, error.diagnostic);
    throw error;
  } finally {
    await driver.stop().catch(() => undefined);
    await bridge?.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

function unsupportedAssertion(scenario: IPlaytestScenario): IPlaytestProtocolDiagnostic | undefined {
  if (scenario.assert?.diagnostics?.noNetworkErrors === true) {
    return unsupportedDiagnostic(
      "network assertions",
      "Run this assertion on --target browser; Android device transport has no CDP network observer.",
    );
  }
  if ((scenario.assert?.hud?.length ?? 0) > 0 || (scenario.assert?.overlayNodes?.length ?? 0) > 0) {
    return unsupportedDiagnostic(
      "DOM assertions",
      "Use runtime resources/components for a cross-target scenario; Android has no DOM observer.",
    );
  }
  if ((scenario.assert?.visual?.length ?? 0) > 0) {
    return unsupportedDiagnostic(
      "visual assertions",
      "Android screenshots are captured as artifacts, but visual metric evaluation is not supported yet.",
    );
  }
  return undefined;
}

function unsupportedDiagnostic(subject: string, fix: string): IPlaytestProtocolDiagnostic {
  return playtestDiagnostic(
    "TN_PLAYTEST_UNSUPPORTED_ON_TARGET",
    `Android device target does not support ${subject}.`,
    fix,
  );
}

function failureReport(
  config: IStandalonePlaytestConfig,
  scenario: IPlaytestScenario,
  diagnostic: IPlaytestProtocolDiagnostic,
): IStandalonePlaytestReport {
  const item: IPlaytestDiagnostic = { ...diagnostic, suggestion: diagnostic.fix.instruction };
  return {
    artifactDirectory: config.artifactDirectory,
    diagnostics: [item],
    distance: 0,
    entity: scenario.subject ?? "",
    expectMoved: false,
    frames: 0,
    pass: false,
    runtime: "native",
    scenario: scenario.name,
    target: "android",
    url: config.endpoint ?? "http://127.0.0.1:41777/playtest",
  } as IStandalonePlaytestReport;
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
