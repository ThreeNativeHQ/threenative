import { describe, expect, test } from "vitest";

import {
  applyScenarioSetup,
} from "../src/runner/steps.js";
import { failureReport, requestedSetupRecords } from "../src/runner/shared.js";
import { buildReport } from "../src/runner/runner-support.js";
import type { IPlaytestBridgeClient, PlaytestBridgeError } from "../src/runner/bridgeClient.js";
import type {
  IPlaytestObservationSnapshot,
  IPlaytestScenario,
  IPlaytestSetupRequest,
} from "../src/index.js";
import type { PlaytestVec3 } from "../src/report.js";

const baseScenario = {
  name: "setup-reporting",
  schemaVersion: 1,
  subject: "player",
  target: "web" as const,
  viewport: { height: 720, width: 1280 },
  warmupFrames: 1,
  steps: [{ release: true, waitTicks: 1 }],
};

function scenarioWith(setup: unknown): IPlaytestScenario {
  return { ...baseScenario, setup } as unknown as IPlaytestScenario;
}

function stubBridge(samples: Record<string, PlaytestVec3 | undefined>, applyError?: Error) {
  const applied: IPlaytestSetupRequest[] = [];
  const bridge = {
    advance: async () => undefined,
    applySetup: async (request: IPlaytestSetupRequest) => {
      if (applyError !== undefined) throw applyError;
      applied.push(request);
    },
    close: async () => undefined,
    description: { capabilities: ["entity.setup"], limits: {}, name: "stub", protocolVersion: 1 },
    drainEvents: async () => [],
    sample: async (request: { entities?: readonly string[] }) => {
      const snapshot: IPlaytestObservationSnapshot = {
        clock: { mode: "fixed-step", tick: 0 },
        entities: (request.entities ?? []).flatMap((id) => {
          const position = samples[id];
          return position === undefined ? [] : [{ id, transform: { position } }];
        }),
      };
      return snapshot;
    },
  };
  return { applied, bridge: bridge as unknown as IPlaytestBridgeClient };
}

describe("requested vs applied setup records", () => {
  test("requestedSetupRecords names every override with entity ids", () => {
    const records = requestedSetupRecords(scenarioWith({
      aim: { pitch: 0.2, yaw: 1 },
      entities: [{ entity: "door", position: [1, 2, 3] }],
      place: [{ at: { x: 4, y: 0, z: 5 }, entity: "sentry", frozen: true }],
      resources: [{ id: "state", value: { gold: 5 } }],
      spawn: { x: 7, z: 9 },
    }));
    expect(records).toHaveLength(5);
    expect(records.map(({ kind }) => kind)).toEqual(["spawn", "aim", "entities", "place", "resources"]);
    expect(records.find(({ kind }) => kind === "place")).toMatchObject({ entity: "sentry", value: { frozen: true } });
    expect(records.find(({ kind }) => kind === "spawn")).toMatchObject({ entity: "player" });
  });

  test("a scenario without setup yields no records", () => {
    expect(requestedSetupRecords(baseScenario as unknown as IPlaytestScenario)).toEqual([]);
  });

  test("applyScenarioSetup preserves the sampled subject height for spawn without y", async () => {
    const { applied, bridge } = stubBridge({ player: [0, 1.6, 0] });
    const receipt = await applyScenarioSetup(bridge, scenarioWith({ spawn: { x: 3, z: -4 } }));

    expect(applied[0]?.entities?.[0]?.transform.position).toEqual([3, 1.6, -4]);
    expect(receipt.requested).toHaveLength(1);
    expect(receipt.applied).toEqual(receipt.requested);
  });

  test("spawn without y on an unobserved subject is a named error", async () => {
    const { bridge } = stubBridge({});
    await expect(applyScenarioSetup(bridge, scenarioWith({ spawn: { x: 3, z: -4 } })))
      .rejects.toThrow(/player.*height|height.*player/u);
  });

  test("an explicit spawn y is used verbatim without sampling", async () => {
    const { applied, bridge } = stubBridge({});
    await applyScenarioSetup(bridge, scenarioWith({ spawn: { x: 3, y: 12, z: -4 } }));
    expect(applied[0]?.entities?.[0]?.transform.position).toEqual([3, 12, -4]);
  });

  test("an apply-time registry miss becomes a named PlaytestBridgeError", async () => {
    const { bridge } = stubBridge({}, new Error("Setup entity 'ghost-sentry' is not registered."));
    const failure = applyScenarioSetup(bridge, scenarioWith({
      place: [{ at: { x: 1, y: 0, z: 1 }, entity: "ghost-sentry" }],
    }));
    await expect(failure).rejects.toThrow(/ghost-sentry/u);
    await expect(failure).rejects.toMatchObject({
      diagnostic: { code: "TN_PLAYTEST_SETUP_UNAPPLIED" },
    });
  });
});

describe("honest reporting in the run report", () => {
  const config = {
    artifactDirectory: "/tmp/artifacts",
    headless: false,
    url: "http://127.0.0.1:5173",
  } as Parameters<typeof buildReport>[0];

  test("failureReport carries the requested overrides with nothing applied and the named reason", () => {
    const scenario = scenarioWith({ spawn: { x: 1, z: 2 } });
    const report = failureReport(config, scenario, {
      code: "TN_PLAYTEST_SETUP_UNAPPLIED",
      fix: { instruction: "register the entity" },
      message: "setup.spawn could not apply.",
      severity: "error",
    });
    expect(report.pass).toBe(false);
    expect(report.diagnostics[0]?.code).toBe("TN_PLAYTEST_SETUP_UNAPPLIED");
    expect(report.setup?.applied).toEqual([]);
    expect(report.setup?.requested).toHaveLength(1);
  });

  test("buildReport records the applied placements next to what was requested", () => {
    const receipt = {
      applied: [{ entity: "player", kind: "spawn" as const, value: { x: 1, y: 0, z: 2 } }],
      requested: [{ entity: "player", kind: "spawn" as const, value: { x: 1, y: 0, z: 2 } }],
    };
    const report = buildReport(config, baseScenario as unknown as IPlaytestScenario, undefined, undefined, [], [], 0, {}, true, undefined, [], undefined, undefined, undefined, [], receipt);
    expect(report.setup).toEqual(receipt);
  });

  test("report.frames counts hold and wait time together like the runner waits it", () => {
    // The schema allows holdFrames + waitFrames in one step and runStep waits their sum;
    // the report must count the same elapsed frames or movement.velocity inflates.
    const scenario = {
      ...baseScenario,
      steps: [{ press: ["KeyW"], holdFrames: 10, waitFrames: 5 }, { waitFrames: 7 }],
    } as unknown as IPlaytestScenario;
    const report = buildReport(config, scenario, undefined, undefined, [], []);
    expect(report.frames).toBe(22);
  });
});
