import { expect, test } from "vitest";
import { PLAYTEST_PROTOCOL_LIMITS } from "../src/protocol.js";
import { advanceTimeoutMs } from "../src/runner/bridgeClient.js";


test("advance is budgeted by the ticks it was asked for, not by a fixed round trip", () => {
  // `starter-game-over` advances 600 ticks in one call and exceeded the 5s operation timeout on a
  // two-core CI runner, reported as TN_PLAYTEST_OPERATION_TIMEOUT — which reads as a hung page
  // rather than a slow one. Every other bridge method is a request and a reply; advance runs the
  // game loop N times before replying, so its bound has to grow with N.
  expect(advanceTimeoutMs(0)).toBe(PLAYTEST_PROTOCOL_LIMITS.operationTimeoutMs);
  expect(advanceTimeoutMs(600)).toBeGreaterThan(60_000);
  expect(advanceTimeoutMs(600)).toBeGreaterThan(advanceTimeoutMs(300));
  // A malformed count must not produce a shorter budget than the round trip alone.
  expect(advanceTimeoutMs(Number.NaN)).toBe(PLAYTEST_PROTOCOL_LIMITS.operationTimeoutMs);
  expect(advanceTimeoutMs(-5)).toBe(PLAYTEST_PROTOCOL_LIMITS.operationTimeoutMs);
});
