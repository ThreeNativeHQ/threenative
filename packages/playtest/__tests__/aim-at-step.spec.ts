import { describe, expect, test } from "vitest";
import type { Page } from "playwright";

import { runStep } from "../src/runner/steps.js";
import { aimAngles, yawPitchToQuaternion } from "../src/scenario/orientation.js";
import type { IPlaytestBridgeClient } from "../src/runner/bridgeClient.js";
import type { IPlaytestObservationSnapshot, IPlaytestSetupRequest, PlaytestVec3 } from "../src/index.js";

describe("aim math", () => {
  test("yaw zero faces down -Z and positive pitch looks up", () => {
    expect(yawPitchToQuaternion(0, 0)).toEqual([0, 0, 0, 1]);
    const [px] = yawPitchToQuaternion(0, Math.PI / 2);
    expect(px).toBeCloseTo(Math.SQRT2 / 2, 6);
    const [, qy, , qw] = yawPitchToQuaternion(Math.PI / 2, 0);
    expect(qy).toBeCloseTo(Math.SQRT2 / 2, 6);
    expect(qw).toBeCloseTo(Math.SQRT2 / 2, 6);
  });

  test("aimAngles resolves cardinal directions with level pitch", () => {
    // East (+X): forward is -Z at yaw 0, so east is yaw = -PI/2.
    expect(aimAngles([0, 0, 0], [10, 0, 0])).toEqual({ pitch: 0, yaw: -Math.PI / 2 });
    // West (-X).
    expect(aimAngles([0, 0, 0], [-10, 0, 0])).toEqual({ pitch: 0, yaw: Math.PI / 2 });
    // North (-Z) is the zero-yaw direction.
    const north = aimAngles([0, 0, 0], [0, 0, -7]);
    expect(north.yaw).toBeCloseTo(0, 6);
    expect(north.pitch).toBeCloseTo(0, 6);
  });

  test("aimAngles derives pitch from height difference", () => {
    const angles = aimAngles([0, 1, 0], [3, 4, 0]);
    // Horizontal distance 3, rise 3 → pitch = atan(1).
    expect(angles.pitch).toBeCloseTo(Math.atan(1), 6);
    expect(angles.yaw).toBeCloseTo(-Math.PI / 2, 6);
  });

  test("a target coincident with the subject is a named error, not a NaN quaternion", async () => {
    expect(() => aimAngles([2, 1, 3], [2, 1, 3])).toThrow(/coincides/u);
  });
});

interface RecordedCall {
  request: IPlaytestSetupRequest;
}

function stubBridge(samples: Record<string, PlaytestVec3 | undefined>) {
  const applied: RecordedCall[] = [];
  const bridge = {
    advance: async () => undefined,
    applySetup: async (request: IPlaytestSetupRequest) => {
      applied.push({ request });
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

function stubPage(): Page {
  return {
    context: () => ({ newCDPSession: async () => ({ send: async () => undefined }) }),
    evaluate: async () => undefined,
    keyboard: { down: async () => undefined, up: async () => undefined },
    mouse: { down: async () => undefined, move: async () => undefined, up: async () => undefined },
  } as unknown as Page;
}

const viewport = { height: 720, width: 1280 };

async function runAimStep(step: Record<string, unknown>, bridge: IPlaytestBridgeClient, subject = "player") {
  return runStep(stubPage(), bridge, step as never, viewport, undefined, [], {
    heldKeys: new Set(),
    pointerButtons: 0,
    pointers: new Map(),
  }, undefined, true, subject);
}

describe("the runner-native aimAt step", () => {
  test("aims the subject from its sampled position toward an xz target", async () => {
    const { applied, bridge } = stubBridge({ player: [0, 1.6, 0] });
    await runAimStep({ kind: "aimAt", target: { x: 8, z: 0 } }, bridge);

    expect(applied).toHaveLength(1);
    const entry = applied[0]?.request.entities?.[0];
    expect(entry?.entity).toBe("player");
    expect(entry?.transform.position).toBeUndefined();
    // East target from the origin: yaw -PI/2, level pitch.
    expect(entry?.transform.rotation).toEqual(yawPitchToQuaternion(-Math.PI / 2, 0));
  });

  test("resolves an entity target by sampling it and derives pitch from the delta", async () => {
    const { applied, bridge } = stubBridge({ beacon: [3, 4, 0], player: [0, 1, 0] });
    await runAimStep({ kind: "aimAt", target: { entity: "beacon" } }, bridge);

    const angles = aimAngles([0, 1, 0], [3, 4, 0]);
    const rotation = applied[0]?.request.entities?.[0]?.transform.rotation;
    expect(rotation).toEqual(yawPitchToQuaternion(angles.yaw, angles.pitch));
  });

  test("an explicit pitch overrides the derived one", async () => {
    const { applied, bridge } = stubBridge({ player: [0, 0, 0] });
    await runAimStep({ kind: "aimAt", pitch: 0.35, target: { x: 5, z: 5 } }, bridge);

    expect(applied[0]?.request.entities?.[0]?.transform.rotation)
      .toEqual(yawPitchToQuaternion((-3 * Math.PI) / 4, 0.35));
  });

  test("an unobserved subject fails closed with a named error", async () => {
    const { bridge } = stubBridge({});
    await expect(runAimStep({ kind: "aimAt", target: { x: 1, z: 2 } }, bridge))
      .rejects.toThrow(/player/u);
  });

  test("a target that coincides with the subject fails instead of writing NaN", async () => {
    const { applied, bridge } = stubBridge({ player: [4, 0, 4] });
    await expect(runAimStep({ kind: "aimAt", target: { x: 4, z: 4 } }, bridge))
      .rejects.toThrow(/coincides/u);
    expect(applied).toHaveLength(0);
  });

  test("the aim application rides applySetup, so an unregistered subject names it", async () => {
    const failing = stubBridge({});
    const raw = failing.bridge as unknown as {
      applySetup: () => Promise<never>;
      sample: () => Promise<IPlaytestObservationSnapshot>;
    };
    raw.applySetup = async () => {
      throw new Error("Setup entity 'player' is not registered.");
    };
    raw.sample = async () => ({
      clock: { mode: "fixed-step" },
      entities: [{ id: "player", transform: { position: [0, 0, 0] } }],
    });
    await expect(runAimStep({ kind: "aimAt", target: { x: 1, z: 0 } }, failing.bridge))
      .rejects.toThrow(/player/u);
  });
});
