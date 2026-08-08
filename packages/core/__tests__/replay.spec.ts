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

function runtime(
  fixedStep: (ticks: number) => number = () => 0,
  random = createRandom(1),
  rapier: string | null = null,
): GamePluginRuntime {
  return { fixedStep, random, rapier, seed: 90210, step: 1 / 60 };
}

async function recordThreeTicks(): Promise<{
  input: InputMap;
  plugin: ReturnType<typeof replay>;
  recording: Recording;
  trace: string[][];
}> {
  const target = new EventTarget();
  const input = new InputMap(undefined, target);
  const plugin = replay();
  const ctx = { input, random: createRandom(90210) } as unknown as Ctx;
  const trace: string[][] = [];
  await plugin.setup?.(ctx, runtime());
  target.dispatchEvent(keyEvent("keydown", "KeyW"));
  for (let tick = 0; tick < 3; tick += 1) {
    if (tick === 2) target.dispatchEvent(keyEvent("keyup", "KeyW"));
    input.tick();
    trace.push([...input.raw.keys].sort());
    plugin.update?.(ctx, 1 / 60);
  }
  const recording = plugin.recording;
  if (recording === undefined) throw new Error("Replay plugin did not produce a recording.");
  return { input, plugin, recording, trace };
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

  it("should restore random state before the replay driver's first step", async () => {
    const recorded = await recordThreeTicks();
    const replayRandom = createRandom(1);
    let stateAtFirstStep: number | undefined;
    const driver = createReplayDriver(recorded.recording, new EventTarget());

    driver(
      runtime(() => {
        stateAtFirstStep = replayRandom.state;
        return 1;
      }, replayRandom),
    );

    expect(stateAtFirstStep).toBe(recorded.recording.randomState);
    recorded.input.dispose();
  });

  it("should prepare random state before a replay scene is rebuilt", async () => {
    const recorded = await recordThreeTicks();
    const replayRandom = createRandom(1);
    const replayRuntime = runtime(() => 0, replayRandom);
    const driver = createReplayDriver(recorded.recording, new EventTarget());
    const expectedAfterSceneRandom = createRandom(1);
    expectedAfterSceneRandom.state = recorded.recording.randomState;
    expectedAfterSceneRandom();
    driver.prepare(replayRuntime);
    replayRandom();
    let stateAtFirstStep: number | undefined;
    driver({
      ...replayRuntime,
      fixedStep: () => {
        stateAtFirstStep = replayRandom.state;
        return 1;
      },
    });

    expect(stateAtFirstStep).toBe(expectedAfterSceneRandom.state);
    recorded.input.dispose();
  });

  it("should route pointer playback to the input map's pointer target", async () => {
    const recorded = await recordThreeTicks();
    const keyboardTarget = new EventTarget();
    const pointerTarget = new EventTarget();
    const input = new InputMap({ pulse: { pointer: true } }, keyboardTarget, pointerTarget);
    const pointerRecording = {
      ...recorded.recording,
      input: [
        { keys: [], pointer: [12, 34, 1] as [number, number, number], tick: 0 },
        { keys: [], pointer: [12, 34, 0] as [number, number, number], tick: 1 },
      ],
      ticks: 2,
    };
    const observed: Array<[number, boolean, number, number]> = [];
    const driver = createReplayDriver(pointerRecording, keyboardTarget, pointerTarget);
    driver(
      runtime(() => {
        input.tick();
        observed.push([
          input.raw.pointer.buttons,
          input.raw.pointer.down,
          input.raw.pointer.position.x,
          input.raw.pointer.position.y,
        ]);
        return 1;
      }),
    );

    expect(observed).toEqual([
      [1, true, 12, 34],
      [0, false, 12, 34],
    ]);
    recorded.input.dispose();
    input.dispose();
  });

  it("should record identities from the record and replay-driver runs", async () => {
    const recorded = await recordThreeTicks();
    const replayTarget = new EventTarget();
    const replayInput = new InputMap(undefined, replayTarget);
    const replayDriver = createReplayDriver(recorded.recording, replayTarget);
    const replayTrace = { runId: replayDriver.runId, values: [] as string[][] };
    const recordTrace = { runId: recorded.plugin.runId, values: recorded.trace };

    replayDriver(
      runtime(() => {
        replayInput.tick();
        replayTrace.values.push([...replayInput.raw.keys].sort());
        return 1;
      }),
    );

    expect(replayTrace.values).toEqual(recordTrace.values);
    expect(recordTrace.runId).not.toBe(replayTrace.runId);
    recorded.input.dispose();
    replayInput.dispose();
  });

  it("should clear live input before replaying the first tick", async () => {
    const recorded = await recordThreeTicks();
    const target = new EventTarget();
    const input = new InputMap(undefined, target);
    target.dispatchEvent(keyEvent("keydown", "KeyD"));
    target.dispatchEvent(
      Object.assign(new Event("pointerdown"), {
        buttons: 1,
        clientX: 12,
        clientY: 34,
        pointerId: 0,
      }),
    );
    const observed: Array<[string[], number]> = [];
    createReplayDriver(
      recorded.recording,
      target,
    )(
      runtime(() => {
        input.tick();
        observed.push([[...input.raw.keys].sort(), input.raw.pointer.buttons]);
        return 1;
      }),
    );

    expect(observed[0]).toEqual([["KeyW"], 0]);
    recorded.input.dispose();
    input.dispose();
  });

  it("should throw when the recording has no input samples", async () => {
    const { input, recording } = await recordThreeTicks();
    expect(() => createReplayDriver({ ...recording, input: [] }, new EventTarget())).toThrow(
      /TN_REPLAY_EMPTY/u,
    );
    input.dispose();
  });

  it("should reject malformed pointer samples at load", async () => {
    const { input, recording } = await recordThreeTicks();
    expect(() =>
      createReplayDriver(
        {
          ...recording,
          input: [{ keys: ["KeyW"], pointer: [0, 0, 0.5], tick: 0 }],
          ticks: 1,
        },
        new EventTarget(),
      ),
    ).toThrow(/TN_REPLAY_INVALID/u);
    input.dispose();
  });

  it("should throw when the runtime fingerprint does not match", async () => {
    const { input, recording } = await recordThreeTicks();
    const mismatched = {
      ...recording,
      runtime: { ...recording.runtime, rapier: "0.19.3" },
    };

    expect(() => createReplayDriver(mismatched, new EventTarget())(runtime())).toThrow(
      /TN_REPLAY_RUNTIME_MISMATCH/u,
    );
    input.dispose();
  });

  it("should accept a matching non-null Rapier fingerprint", async () => {
    const { input, recording } = await recordThreeTicks();
    const physicsRecording = {
      ...recording,
      runtime: { ...recording.runtime, rapier: "0.30.1" },
    };

    expect(() =>
      createReplayDriver(
        physicsRecording,
        new EventTarget(),
      )(runtime(() => 0, undefined, "0.30.1")),
    ).not.toThrow();
    input.dispose();
  });
});
