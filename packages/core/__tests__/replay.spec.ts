import { describe, expect, it } from "vitest";
import type { GamePluginRuntime } from "../src/game.js";
import { InputMap } from "../src/input.js";
import { createRandom } from "../src/random.js";
import { type Recording, createReplayDriver, replay } from "../src/replay.js";
import type { Ctx } from "../src/scene.js";

function keyEvent(type: "keydown" | "keyup", code: string): Event {
  const event = new Event(type);
  Object.defineProperty(event, "code", { value: code });
  return event;
}

function runtime(fixedStep: (ticks: number) => number = () => 0): GamePluginRuntime {
  return { fixedStep, seed: 90210, step: 1 / 60 };
}

async function recordThreeTicks(): Promise<{
  input: InputMap;
  plugin: ReturnType<typeof replay>;
  recording: Recording;
}> {
  const target = new EventTarget();
  const input = new InputMap(undefined, target);
  const plugin = replay();
  const ctx = { input, random: createRandom(90210) } as unknown as Ctx;
  await plugin.setup?.(ctx, runtime());
  target.dispatchEvent(keyEvent("keydown", "KeyW"));
  for (let tick = 0; tick < 3; tick += 1) {
    if (tick === 2) target.dispatchEvent(keyEvent("keyup", "KeyW"));
    input.tick();
    plugin.update?.(ctx, 1 / 60);
  }
  const recording = plugin.recording;
  if (recording === undefined) throw new Error("Replay plugin did not produce a recording.");
  return { input, plugin, recording };
}

describe("replay", () => {
  it("should align recorded tick N with replayed tick N", async () => {
    const recorded = await recordThreeTicks();
    const target = new EventTarget();
    const input = new InputMap(undefined, target);
    const held: string[][] = [];
    const driver = createReplayDriver(recorded.recording, target);

    driver(
      runtime(() => {
        input.tick();
        held.push([...input.raw.keys].sort());
        return 1;
      }),
    );

    expect(held).toEqual([["KeyW"], ["KeyW"], []]);
    recorded.input.dispose();
    input.dispose();
  });

  it("should reproduce the trace when the recording is replayed", async () => {
    const recorded = await recordThreeTicks();
    const originalTrace = [1, 2, 2];
    const target = new EventTarget();
    const input = new InputMap(undefined, target);
    const replayTrace: number[] = [];
    let position = 0;
    const driver = createReplayDriver(recorded.recording, target);

    driver(
      runtime(() => {
        input.tick();
        if (input.pressed("move")) position += 1;
        replayTrace.push(position);
        return 1;
      }),
    );

    expect(replayTrace).toEqual(originalTrace);
    const stripped = {
      ...recorded.recording,
      input: recorded.recording.input.map((sample) => ({ ...sample, keys: [] })),
    };
    const strippedTarget = new EventTarget();
    const strippedInput = new InputMap(undefined, strippedTarget);
    const strippedTrace: number[] = [];
    const strippedDriver = createReplayDriver(stripped, strippedTarget);
    strippedDriver(
      runtime(() => {
        strippedInput.tick();
        if (strippedInput.pressed("move")) strippedTrace.push(1);
        else strippedTrace.push(0);
        return 1;
      }),
    );

    expect(strippedTrace).not.toEqual(originalTrace);
    recorded.input.dispose();
    input.dispose();
    strippedInput.dispose();
  });

  it("should record identities that differ between the two runs", () => {
    expect(replay().runId).not.toBe(replay().runId);
  });

  it("should throw when the recording has no input samples", async () => {
    const { input, recording } = await recordThreeTicks();
    expect(() => createReplayDriver({ ...recording, input: [] }, new EventTarget())).toThrow(
      /TN_REPLAY_EMPTY/u,
    );
    input.dispose();
  });

  it("should throw when the runtime fingerprint does not match", async () => {
    const { input, recording } = await recordThreeTicks();
    const mismatched = {
      ...recording,
      runtime: { ...recording.runtime, rapier: "0.19.3" },
    };

    expect(() => createReplayDriver(mismatched, new EventTarget())).toThrow(
      /TN_REPLAY_RUNTIME_MISMATCH/u,
    );
    input.dispose();
  });
});
