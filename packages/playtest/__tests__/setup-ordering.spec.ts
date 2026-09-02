import { expect, test } from "vitest";

import {
  PLAYTEST_PROTOCOL_LIMITS,
  PLAYTEST_PROTOCOL_VERSION,
  type IPlaytestBridgeDescription,
  type IPlaytestBridgeReady,
  type IPlaytestObservationSnapshot,
  type IPlaytestScenario,
  type IPlaytestSetupRequest,
} from "../src/index.js";
import { yawPitchToQuaternion } from "../src/scenario/orientation.js";
import { connectPlaytestBridgeTransport, type IBridgeTransport } from "../src/runner/bridgeClient.js";

test.each(["web", "desktop"] as const)(
  "%s requests scenario setup before the bridge description handshake",
  async (target) => {
    let appliedSetup: IPlaytestSetupRequest | undefined;
    const calls: string[] = [];
    const description: IPlaytestBridgeDescription = {
      capabilities: ["entity.setup", "runtime.resources"],
      limits: PLAYTEST_PROTOCOL_LIMITS,
      name: "ordering-test",
      protocolVersion: PLAYTEST_PROTOCOL_VERSION,
    };
    const scenario = {
      artifacts: { screenshots: false },
      name: "setup-ordering",
      schemaVersion: 1,
      setup: {
        aim: { pitch: 0.25, yaw: 0.5 },
        entities: [{ entity: "crate", position: [1, 2, 3] }],
        place: [{ at: { x: 4, y: 0, z: -2 }, entity: "sentry", facing: { yaw: -0.5 }, frozen: true }],
        resources: [{ id: "state", path: "score", value: 7 }],
        spawn: { x: 7, y: 2.5, z: -3 },
      },
      steps: [{ kind: "wait" }],
      subject: "player",
      target,
      viewport: { height: 720, width: 1280 },
      warmupFrames: 0,
    } as unknown as IPlaytestScenario;
    const transport: IBridgeTransport = {
      capabilities: [],
      call: async <T>(method: string, argument?: unknown): Promise<T> => {
        calls.push(method);
        if (method === "applySetup") {
          appliedSetup = argument as IPlaytestSetupRequest;
          return undefined as T;
        }
        if (method === "describe") return description as T;
        if (method === "ready") return { ready: true } satisfies IPlaytestBridgeReady as T;
        if (method === "sample") {
          return {
            clock: { mode: "render-frame", tick: 0 },
            entities: [{ id: "player", transform: { position: [0, 1.6, 0] } }],
          } satisfies IPlaytestObservationSnapshot as T;
        }
        throw new Error(`Unexpected bridge call '${method}'.`);
      },
      close: async () => undefined,
      waitForBridge: async () => true,
    };

    const bridge = await connectPlaytestBridgeTransport(transport, scenario);

    expect(calls.slice(0, 2)).toEqual(["applySetup", "describe"]);
    expect(appliedSetup).toEqual({
      entities: [
        { entity: "crate", transform: { position: [1, 2, 3] } },
        { entity: "player", transform: { position: [7, 2.5, -3] } },
        { entity: "player", transform: { rotation: yawPitchToQuaternion(0.5, 0.25) } },
        {
          entity: "sentry",
          frozen: true,
          transform: {
            position: [4, 0, -2],
            rotation: yawPitchToQuaternion(-0.5, 0),
          },
        },
      ],
      resources: [{ id: "state", path: "score", value: 7 }],
    });
    expect(bridge?.setupApplication?.requested.map(({ kind }) => kind)).toEqual([
      "spawn", "aim", "entities", "place", "resources",
    ]);
  },
);

test("a scenario without setup reaches describe without waiting for applySetup", async () => {
  const calls: string[] = [];
  const description: IPlaytestBridgeDescription = {
    capabilities: [],
    limits: PLAYTEST_PROTOCOL_LIMITS,
    name: "no-setup-ordering-test",
    protocolVersion: PLAYTEST_PROTOCOL_VERSION,
  };
  const transport: IBridgeTransport = {
    capabilities: [],
    call: async <T>(method: string): Promise<T> => {
      calls.push(method);
      if (method === "describe") return description as T;
      if (method === "ready") return { ready: true } satisfies IPlaytestBridgeReady as T;
      throw new Error(`Unexpected bridge call '${method}'.`);
    },
    close: async () => undefined,
    waitForBridge: async () => true,
  };
  const scenario = {
    artifacts: { screenshots: false },
    name: "no-setup-ordering",
    schemaVersion: 1,
    steps: [{ kind: "wait" }],
    target: "desktop",
    viewport: { height: 720, width: 1280 },
    warmupFrames: 0,
  } as unknown as IPlaytestScenario;

  const bridge = await connectPlaytestBridgeTransport(transport, scenario);

  expect(calls).toEqual(["describe", "ready"]);
  expect(bridge?.setupApplication).toBeUndefined();
});
