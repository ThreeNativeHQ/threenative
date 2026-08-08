import {
  PLAYTEST_BRIDGE_GLOBAL,
  PLAYTEST_ASSERTION_REGISTRY,
  PLAYTEST_PROTOCOL_LIMITS,
  PLAYTEST_PROTOCOL_VERSION,
  assertJsonSafe,
  jsonByteLength,
  missingPlaytestCapabilities,
  playtestDiagnostic,
  unknownPlaytestCapabilities,
  type IPlaytestBridgeDescription,
  type IPlaytestObservationSnapshot,
  type IPlaytestProtocolDiagnostic,
  type IPlaytestSampleRequest,
  type IPlaytestScenario,
  type IPlaytestSetupRequest,
  requiredPlaytestCapabilities,
} from "../index.js";
import type { Page } from "playwright";

import { STANDALONE_PLAYTEST_OBSERVATION_FIELDS } from "./observationFields.js";

const STANDALONE_OBSERVATION_FIELD_SET: readonly string[] = STANDALONE_PLAYTEST_OBSERVATION_FIELDS;

const BROWSER_CAPABILITIES = [
  "browser.canvas",
  "browser.console",
  "browser.dom",
  "browser.input",
  "browser.network",
  "browser.screenshot",
  "browser.trace",
  "runtime.ui",
] as const;

export class PlaytestBridgeError extends Error {
  constructor(readonly diagnostic: IPlaytestProtocolDiagnostic) {
    super(diagnostic.message);
  }
}

export interface IPlaytestBridgeClient {
  advance(ticks: number): Promise<void>;
  applySetup(request: IPlaytestSetupRequest): Promise<void>;
  drainEvents(limit?: number): Promise<import("../protocol.js").JsonValue[]>;
  description: IPlaytestBridgeDescription;
  sample(request: IPlaytestSampleRequest): Promise<IPlaytestObservationSnapshot>;
}

export async function connectPlaytestBridge(
  page: Page,
  scenario: IPlaytestScenario,
  timeoutMs = PLAYTEST_PROTOCOL_LIMITS.operationTimeoutMs,
): Promise<IPlaytestBridgeClient | undefined> {
  const required = requiredPlaytestCapabilities(scenario);
  const semanticRequired = required.filter(
    (capability) => !capability.startsWith("browser.")
      && capability !== "runtime.ui"
      && (capability !== "runtime.diagnostics" || scenario.assert?.diagnostics?.noRuntimeDiagnostics === true),
  );
  const exists = await page
    .waitForFunction((globalName) => globalName in globalThis, PLAYTEST_BRIDGE_GLOBAL, { timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    if (semanticRequired.length === 0) {
      return undefined;
    }
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_BRIDGE_MISSING",
      `Scenario requires semantic capabilities but '${PLAYTEST_BRIDGE_GLOBAL}' is not installed.`,
      "Install an adapter before application startup and register the asserted entities.",
    ));
  }
  const description = await bridgeCall<IPlaytestBridgeDescription>(page, "describe");
  const unknown = unknownPlaytestCapabilities(description.capabilities);
  if (unknown.length > 0) {
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_BRIDGE_CAPABILITY_UNKNOWN",
      `Bridge advertises capability '${unknown[0]}' that runner protocol ${PLAYTEST_PROTOCOL_VERSION} does not define.`,
      `Remove '${unknown[0]}' from the bridge description or register it in PLAYTEST_CAPABILITY_REGISTRY before running the scenario.`,
      { capability: unknown[0] },
    ));
  }
  if (description.protocolVersion !== PLAYTEST_PROTOCOL_VERSION) {
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_BRIDGE_INCOMPATIBLE",
      `Bridge protocol ${description.protocolVersion} is incompatible with runner protocol ${PLAYTEST_PROTOCOL_VERSION}.`,
      "Install matching @threenative/playtest and adapter package versions.",
    ));
  }
  const ready = await bridgeCall<{ ready: boolean; reason?: string }>(page, "ready");
  if (!ready.ready) {
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_BRIDGE_NOT_READY",
      `Playtest bridge is not ready${ready.reason === undefined ? "." : `: ${ready.reason}`}`,
      "Wait for scene, camera, renderer, and entity registration before exposing bridge readiness.",
    ));
  }
  const missing = missingPlaytestCapabilities(required, [...BROWSER_CAPABILITIES, ...description.capabilities]);
  if (missing.length > 0) {
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_CAPABILITY_MISSING",
      `Scenario requires missing capability '${missing[0]}'.`,
      `Register a provider for '${missing[0]}' or remove the assertion that requires it.`,
      { capability: missing[0] },
    ));
  }
  const unavailable = unavailableObservation(scenario);
  if (unavailable !== undefined) {
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_OBSERVATION_UNAVAILABLE",
      `Assertion '${unavailable.assertion}' requires observation '${unavailable.path}', but this runner does not produce it.`,
      unavailable.reason,
      { path: unavailable.path },
    ));
  }
  return {
    advance: async (ticks) => {
      await bridgeCall(page, "advance", ticks);
    },
    applySetup: async (request) => {
      assertBoundedPayload(request);
      await bridgeCall(page, "applySetup", request);
    },
    drainEvents: async (limit) => {
      const events = await bridgeCall<import("../protocol.js").JsonValue[]>(page, "drainEvents", limit);
      if (!Array.isArray(events)) throw new Error("Bridge drainEvents must return an array.");
      assertBoundedPayload(events);
      return events;
    },
    description,
    sample: async (request) => {
      assertBoundedPayload(request);
      const snapshot = await bridgeCall<IPlaytestObservationSnapshot>(page, "sample", request);
      assertBoundedPayload(snapshot);
      return snapshot;
    },
  };
}

function unavailableObservation(
  scenario: IPlaytestScenario,
): { assertion: string; path: string; reason: string } | undefined {
  for (const entry of PLAYTEST_ASSERTION_REGISTRY) {
    if (scenario.assert?.[entry.kind] === undefined) continue;
    if (!entry.supportedOn.includes(scenario.target)) {
      return {
        assertion: entry.kind,
        path: entry.observationPath,
        reason: `Assertion '${entry.kind}' is not supported on target '${scenario.target}'.`,
      };
    }
    for (const path of requiredObservationPaths(scenario, entry.kind, entry.observationPath)) {
      if (!STANDALONE_OBSERVATION_FIELD_SET.includes(path)) {
        return {
          assertion: entry.kind,
          path,
          reason: `The standalone runner does not produce an ${path} observation required by this assertion.`,
        };
      }
    }
  }
  const movement = scenario.assert?.movement;
  if (movement !== undefined) {
    const effectLogAssertion = movement.notFacing !== undefined
      ? "movement.notFacing"
      : movement.notFacingPosition !== undefined
        ? "movement.notFacingPosition"
        : movement.facesMovementWithinDegrees !== undefined
          ? "movement.facesMovementWithinDegrees"
          : movement.minResolvedAxisDelta !== undefined
            ? "movement.minResolvedAxisDelta"
            : undefined;
    if (effectLogAssertion !== undefined) {
      return {
        assertion: effectLogAssertion,
        path: "effectLog",
        reason: "The standalone runner does not produce an effect log.",
      };
    }
  }
  return undefined;
}

function requiredObservationPaths(
  scenario: IPlaytestScenario,
  kind: string,
  defaultPath: string,
): readonly string[] {
  const movementStep = scenario.assert?.movement?.reachesPositionWithin?.atStep;
  if (kind === "movement" && movementStep !== undefined && scenario.steps.at(-1)?.label !== movementStep) {
    return ["effectLogSeries"];
  }
  if (kind === "contacts" && scenario.assert?.contacts?.some(({ atStep }) => atStep !== undefined) === true) {
    return ["physicsDebugSeries"];
  }
  return [defaultPath];
}

function assertBoundedPayload(value: unknown): void {
  assertJsonSafe(value);
  if (jsonByteLength(value) > PLAYTEST_PROTOCOL_LIMITS.maxPayloadBytes) {
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_PAYLOAD_TOO_LARGE",
      `Bridge payload exceeds ${PLAYTEST_PROTOCOL_LIMITS.maxPayloadBytes} bytes.`,
      "Request fewer entities or return smaller provider observations.",
    ));
  }
}

async function bridgeCall<T = void>(page: Page, method: string, argument?: unknown): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      page.evaluate(
        async ({ argument, globalName, method }) => {
          const bridge = (globalThis as Record<string, unknown>)[globalName] as Record<string, unknown> | undefined;
          const operation = bridge?.[method];
          if (typeof operation !== "function") {
            throw new Error(`Bridge operation '${method}' is unavailable.`);
          }
          return operation.call(bridge, argument);
        },
        { argument, globalName: PLAYTEST_BRIDGE_GLOBAL, method },
      ) as Promise<T>,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new PlaytestBridgeError(playtestDiagnostic(
          "TN_PLAYTEST_OPERATION_TIMEOUT",
          `Bridge operation '${method}' exceeded ${PLAYTEST_PROTOCOL_LIMITS.operationTimeoutMs}ms.`,
          "Bound the provider work or return a smaller observation payload.",
        ))), PLAYTEST_PROTOCOL_LIMITS.operationTimeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
