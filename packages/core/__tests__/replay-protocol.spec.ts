import { describe, expect, it } from "vitest";
import { type IReplayRecording, parseReplayRecording } from "../src/replay-protocol.js";

function recording(): IReplayRecording {
  return {
    input: [
      { keys: ["Space"], tick: 0 },
      { keys: ["W"], pointer: [0, 0, 4, 120, 80], tick: 10 },
    ],
    randomState: 42,
    runtime: {
      agent: "playtest",
      core: "1.0.0",
      portable: true,
      rapier: null,
      step: 1 / 60,
    },
    seed: 1234,
    ticks: 300,
    version: 1,
  };
}

describe("parseReplayRecording", () => {
  it("parses a valid recording", () => {
    const parsed = parseReplayRecording(recording());

    expect(parsed).toEqual(recording());
    expect(parsed.version).toBe(1);
    expect(parsed.ticks).toBe(300);
    expect(parsed.seed).toBe(1234);
    expect(parsed.randomState).toBe(42);
    expect(parsed.input).toHaveLength(2);
    expect(parsed.input[0]?.tick).toBe(0);
    expect(parsed.input[0]?.keys).toEqual(["Space"]);
    expect(parsed.input[1]?.tick).toBe(10);
    expect(parsed.input[1]?.pointer).toEqual([0, 0, 4, 120, 80]);
    expect(parsed.runtime).toEqual({
      agent: "playtest",
      core: "1.0.0",
      portable: true,
      rapier: null,
      step: 1 / 60,
    });
  });

  it("throws TN_REPLAY_EMPTY when the input is empty", () => {
    expect(() => parseReplayRecording({ ...recording(), input: [] } as never)).toThrow(
      "TN_REPLAY_EMPTY",
    );
  });

  it("throws TN_REPLAY_INVALID when the top level has an unknown key", () => {
    expect(() => parseReplayRecording({ ...recording(), bogus: "nope" } as never)).toThrow(
      "TN_REPLAY_INVALID",
    );
  });
});
