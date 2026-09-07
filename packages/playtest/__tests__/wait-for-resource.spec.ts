import { expect, test } from "vitest";

import type { IPlaytestObservationSnapshot } from "../src/index.js";
import { waitForResource } from "../src/runner/wait-for-resource.js";

/**
 * `now` and `sleep` are injectable, so elapsed time is exact here rather than raced. A clock
 * that only moves when the wait samples is enough to place an observation on either side of
 * the deadline.
 */
function clock(): { advance: (ms: number) => void; now: () => number } {
  let current = 0;
  return { advance: (ms) => { current += ms; }, now: () => current };
}

function snapshot(connected: boolean): IPlaytestObservationSnapshot {
  return { clock: { now: 0 }, resources: { state: { networkConnected: connected } } } as unknown as IPlaytestObservationSnapshot;
}

test("a resource that satisfies the predicate within its budget passes", async () => {
  const time = clock();
  let samples = 0;
  const result = await waitForResource({
    id: "state",
    now: time.now,
    path: "networkConnected",
    predicate: { equals: true },
    sample: async () => {
      samples += 1;
      // Ready on the second sample, 16 ms in, comfortably inside the 100 ms budget.
      time.advance(16);
      return snapshot(samples >= 2);
    },
    sleep: async () => undefined,
    timeoutMs: 100,
  });

  expect(result).toEqual(snapshot(true));
  expect(samples).toBe(2);
});

test("a resource that only becomes true after its timeout is a timeout, not a pass", async () => {
  // The wait returned as soon as the predicate held, before comparing elapsed time to the
  // budget, so an observation that arrived late still passed. A scenario asking for a
  // transition "within 32 ms" was satisfied by one that took 100.
  const time = clock();
  await expect(
    waitForResource({
      id: "state",
      now: time.now,
      path: "networkConnected",
      predicate: { equals: true },
      // The observation satisfies the predicate, but only after 100 ms have elapsed against
      // a 32 ms budget. Accepting it is the false green.
      sample: async () => {
        time.advance(100);
        return snapshot(true);
      },
      sleep: async () => undefined,
      timeoutMs: 32,
    }),
  ).rejects.toThrow(/timed out/iu);
});
