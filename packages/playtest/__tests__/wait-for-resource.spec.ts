import { expect, test } from "vitest";

import type { IPlaytestObservationSnapshot } from "../src/index.js";
import { PlaytestBridgeError } from "../src/runner/bridgeClient.js";
import { waitForResource } from "../src/runner/wait-for-resource.js";

function snapshot(value: unknown): IPlaytestObservationSnapshot {
  return {
    clock: { mode: "wall-clock", timeMs: 0 },
    resources: { state: value as never },
  };
}

test("waitForResource observes an asynchronous resource and advances at most one tick per poll", async () => {
  let elapsed = 0;
  let samples = 0;
  let advances = 0;

  const result = await waitForResource({
    advance: async () => { advances += 1; },
    id: "state",
    now: () => elapsed,
    path: "networkConnected",
    predicate: { equals: true },
    sample: async () => {
      samples += 1;
      return snapshot({ networkConnected: samples >= 3 });
    },
    sleep: async (milliseconds) => { elapsed += milliseconds; },
    timeoutMs: 100,
  });

  expect(result.resources?.state).toEqual({ networkConnected: true });
  expect(samples).toBe(3);
  expect(advances).toBe(2);
  expect(elapsed).toBe(32);
});

test("waitForResource times out with the predicate, elapsed time, and last observation", async () => {
  let elapsed = 0;

  const failure = await waitForResource({
    id: "state",
    now: () => elapsed,
    path: "networkConnected",
    predicate: { equals: true },
    sample: async () => snapshot({ networkConnected: false }),
    sleep: async (milliseconds) => { elapsed += milliseconds; },
    timeoutMs: 32,
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(PlaytestBridgeError);
  expect((failure as PlaytestBridgeError).diagnostic).toMatchObject({
    code: "TN_PLAYTEST_OBSERVATION_UNAVAILABLE",
    message: expect.stringContaining("last observation false"),
  });
  expect((failure as PlaytestBridgeError).diagnostic.message).toContain("after 32 ms");
});

test("waitForResource fails immediately when the requested resource is not observed", async () => {
  let sleeps = 0;

  const failure = await waitForResource({
    id: "state",
    path: "networkConnected",
    predicate: { equals: true },
    sample: async () => ({ clock: { mode: "wall-clock", timeMs: 0 }, resources: {} }),
    sleep: async () => { sleeps += 1; },
    timeoutMs: 100,
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(PlaytestBridgeError);
  expect((failure as PlaytestBridgeError).diagnostic).toMatchObject({
    message: expect.stringContaining("did not report 'state'"),
    path: "resources.state.networkConnected",
  });
  expect(sleeps).toBe(0);
});
