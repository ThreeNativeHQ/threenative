import { describe, expect, it } from "vitest";

import { judgeCadence, judgePointerLatency } from "../scripts/verify-native-ui-cadence.mjs";

/**
 * The lanes' judges, exercised without a display, a game or a GPU.
 *
 * Why these exist: a judge is the thing that decides whether a run passed, and every one of them
 * answers "pass" by default when handed nothing to judge — an empty failure list is the natural
 * result of an empty measurement. `verify-native-ui-cadence.mjs`'s pointer lane met exactly that on
 * the reported game: 32 native actions reached the host, the page never changed, and the lane
 * reported a pass and then crashed printing the null median. A gate that is green when it measured
 * nothing is worse than one that is red, so the empty case is asserted here.
 */

/** One composited frame: `uploaded` marks the frames that carried a new page picture. */
const frame = (atMs, uploaded = false) => ({ atMs, counter: atMs, uploaded });

/** The judging helpers need a rate, not a rhythm: frames arrive every `stepMs`. */
function framesEvery(stepMs, count, uploadedAt = []) {
  return Array.from({ length: count }, (_, index) =>
    frame(index * stepMs, uploadedAt.includes(index * stepMs)),
  );
}

const pointerActions = (times) =>
  times.map((atMs) => ({ atMs, detail: "pointerdown", event: "pointer" }));

/** The lane drives `POINTER_ACTIONS` actions; the judge refuses fewer as a lost-action failure. */
const ACTIONS = 32;
const ACTION_TIMES = Array.from({ length: ACTIONS }, (_, index) => 1_000 + index * 100);

describe("judgePointerLatency", () => {
  it("fails when no action produced a paired visible response", () => {
    // Every action arrived, the game presented throughout, and the page never changed: the failure
    // that used to be reported as a pass.
    const frames = framesEvery(16, 300);
    const latency = pointerActions(ACTION_TIMES);
    const verdict = judgePointerLatency(frames, latency);
    expect(verdict.failures.join("\n")).toContain("no native pointer action produced a paired visible response");
    expect(verdict.summary.samples).toBe(0);
    expect(verdict.summary.medianMs).toBeNull();
  });

  it("passes when each action's response reaches the next frame", () => {
    const uploaded = ACTION_TIMES.map((atMs) => Math.ceil((atMs + 30) / 16) * 16);
    const frames = framesEvery(16, 300, uploaded);
    const latency = pointerActions(ACTION_TIMES);
    const verdict = judgePointerLatency(frames, latency);
    expect(verdict.failures).toEqual([]);
    expect(verdict.summary.samples).toBe(ACTIONS);
    expect(verdict.summary.p95Ms).toBeLessThanOrEqual(verdict.summary.boundMs);
  });
});

describe("judgeCadence", () => {
  it("fails closed when the page never reached the game's frame", () => {
    const verdict = judgeCadence(framesEvery(16, 300));
    expect(verdict.failures.join("\n")).toContain("did not reach the game's frame enough to measure a rate");
  });
});
