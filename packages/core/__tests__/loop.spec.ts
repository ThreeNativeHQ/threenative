import { describe, expect, it } from "vitest";
import {
  FixedStepLoop,
  type IRenderPerformanceMetrics,
  createAfterPhysicsPhase,
} from "../src/loop.js";
import { FRAME_PASS_KINDS, type IRenderPassSample } from "../src/render-pass-budget.js";

describe("FixedStepLoop", () => {
  it("should reject a maxSteps that can never run an update", () => {
    // A maxSteps of zero (or negative, or NaN) made the catch-up while-loop run
    // zero updates every frame, forever: the game rendered but never simulated,
    // with no error anywhere to name the cause.
    expect(() => new FixedStepLoop({ maxSteps: 0, onUpdate: () => undefined })).toThrow(
      /maxSteps/u,
    );
    expect(() => new FixedStepLoop({ maxSteps: -3, onUpdate: () => undefined })).toThrow(
      /maxSteps/u,
    );
    expect(() => new FixedStepLoop({ maxSteps: Number.NaN, onUpdate: () => undefined })).toThrow(
      /maxSteps/u,
    );
  });

  it("should reject a step that cannot make progress", () => {
    // A zero or negative step made the accumulator never shrink, so every frame
    // ran the full catch-up budget against time that had not passed.
    expect(() => new FixedStepLoop({ onUpdate: () => undefined, step: 0 })).toThrow(/step/u);
    expect(() => new FixedStepLoop({ onUpdate: () => undefined, step: -1 / 60 })).toThrow(/step/u);
    expect(() => new FixedStepLoop({ onUpdate: () => undefined, step: Number.NaN })).toThrow(
      /step/u,
    );
  });

  it("should call update exactly 60 times per simulated second", () => {
    let updates = 0;
    const loop = new FixedStepLoop({ onUpdate: () => updates++ });

    loop.stepFrame(0);
    for (let frame = 1; frame <= 60; frame++) loop.stepFrame((frame * 1_000) / 60);

    expect(updates).toBe(60);
  });

  it("should honor a configured step", () => {
    let updates = 0;
    const loop = new FixedStepLoop({ onUpdate: () => updates++, step: 1 / 30 });

    loop.stepFrame(0);
    for (let frame = 1; frame <= 60; frame++) loop.stepFrame((frame * 1_000) / 60);

    expect(updates).toBe(30);
  });

  it("should clamp catch-up to 5 steps after a long stall", () => {
    let updates = 0;
    const loop = new FixedStepLoop({ onUpdate: () => updates++ });

    loop.stepFrame(0);
    const catchUp = loop.stepFrame(10_000);

    expect(catchUp).toBe(5);
    expect(updates).toBe(5);
  });

  it("should absorb a backgrounded app's time jump without a burst of updates", () => {
    // The native host pauses the loop when the player leaves and resumes it when they return
    // (PRD-210). Resuming hands `stepFrame` a `now` that is minutes ahead, and a phone whose
    // clock was adjusted while the app was parked can hand it one that moved backwards. Both are
    // already handled here — the elapsed clamp and the maxSteps budget — so the host asserts this
    // rather than building its own catch-up.
    const steps: number[] = [];
    const loop = new FixedStepLoop({ onUpdate: (step) => steps.push(step) });

    loop.stepFrame(0);
    const afterTenMinutes = loop.stepFrame(600_000);
    expect(afterTenMinutes).toBe(5);
    expect(steps).toHaveLength(5);
    expect(steps.every((step) => step > 0)).toBe(true);

    // A clock that went backwards must produce no update at all, never a negative one...
    steps.length = 0;
    expect(loop.stepFrame(500_000)).toBe(0);
    expect(steps).toHaveLength(0);

    // ...and must not poison the frames after it. Without the clamp the accumulator goes 100 s
    // negative and the game stops simulating for a hundred seconds while still rendering, which
    // reads as a freeze with no error anywhere.
    for (let frame = 1; frame <= 4; frame++) loop.stepFrame(600_000 + (frame * 1_000) / 60);
    expect(steps.length).toBeGreaterThan(0);
  });

  it("should expose a finite render FPS that decays after a stall", () => {
    const loop = new FixedStepLoop({ onUpdate: () => undefined });
    loop.stepFrame(0);
    expect(Number.isFinite(loop.fps)).toBe(true);
    for (let frame = 1; frame <= 60; frame++) loop.stepFrame((frame * 1_000) / 60);
    const steady = loop.fps;
    loop.stepFrame(10_000);

    expect(steady).toBeGreaterThan(0);
    expect(loop.fps).toBeGreaterThanOrEqual(0);
    expect(loop.fps).toBeLessThan(steady);
  });

  it("should record frame timing and renderer metrics after each rendered frame", () => {
    const loop = new FixedStepLoop({
      // The collector itself under test — a diagnostics consumer's view.
      collectMetrics: true,
      onRender: () => ({ drawCalls: 3, triangles: 24 }),
      onUpdate: () => undefined,
    });

    loop.stepFrame(0);
    loop.stepFrame(16);
    loop.stepFrame(32);

    expect(loop.runtimeDiagnosticsSeries()).toEqual([
      { drawCalls: 3, frameMs: 16, triangles: 24 },
      { drawCalls: 3, frameMs: 16, triangles: 24 },
    ]);
  });

  it("should schedule the next frame when rendering throws", () => {
    const callbacks: Array<(time: number) => void> = [];
    const loop = new FixedStepLoop({
      onRender: () => {
        throw new Error("renderer failed");
      },
      onUpdate: () => undefined,
      requestFrame: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
    });

    loop.start(0);
    expect(() => callbacks.shift()?.(16)).toThrow("renderer failed");
    expect(loop.running).toBe(true);
    expect(callbacks).toHaveLength(1);
  });

  it("should reuse one request-frame callback across 120 frames", () => {
    const callbacks: Array<(time: number) => void> = [];
    const identities = new Set<(time: number) => void>();
    const loop = new FixedStepLoop({
      onUpdate: () => undefined,
      requestFrame: (callback) => {
        callbacks.push(callback);
        identities.add(callback);
        return callbacks.length;
      },
    });

    loop.start(0);
    for (let frame = 1; frame <= 120; frame += 1) {
      const callback = callbacks.shift();
      if (callback === undefined) throw new Error("The loop did not schedule a frame.");
      callback(frame * 16);
    }

    expect(identities).toHaveLength(1);
    loop.stop();
  });

  it("should advance fixed ticks only while the loop is running", () => {
    let updates = 0;
    const loop = new FixedStepLoop({ onUpdate: () => updates++ });

    expect(() => loop.advance(1)).toThrow("Cannot advance a stopped loop.");
    loop.start(0);

    expect(loop.advance(3)).toBe(3);
    expect(updates).toBe(3);
    expect(loop.tick()).toBe(3);
  });

  it("should ignore live frames after switching to the advanced clock", () => {
    let updates = 0;
    const loop = new FixedStepLoop({ onUpdate: () => updates++ });
    loop.start(0);

    loop.advance(10);
    expect(loop.stepFrame(20)).toBe(0);
    expect(loop.stepFrame(37)).toBe(0);
    expect(loop.stepFrame(10_000)).toBe(0);

    expect(updates).toBe(10);
    expect(loop.tick()).toBe(10);
  });

  it("should count wall-clock updates before the manual clock engages", () => {
    const loop = new FixedStepLoop({ onUpdate: () => undefined });
    loop.start(0);

    loop.stepFrame(20);
    loop.advance(2);

    expect(loop.tick()).toBe(3);
  });

  it("rejects an invalid settle count without freezing the clock", () => {
    const loop = new FixedStepLoop({ onUpdate: () => undefined });
    expect(() => loop.freezeClock(-1)).toThrow(/settleSteps/u);
    expect(() => loop.freezeClock(1.5)).toThrow(/settleSteps/u);
    expect(loop.clockFrozen).toBe(false);
  });

  it("advances no frames after the clock is frozen before the run", () => {
    // A browser playtest runner announces itself before the page loads and then pumps live frames
    // through the whole startup compile wait. Those frames used to advance a tick-counting
    // simulation by wall clock, so the run began with an arbitrary amount of game time already
    // spent -- and racing's `elapsed` DNFs a 90s race that the scenario needs only 47s to finish.
    const dts: number[] = [];
    const loop = new FixedStepLoop({ onUpdate: (dt) => dts.push(dt) });
    loop.freezeClock();
    expect(loop.clockFrozen).toBe(true);
    loop.start(0);

    // Two seconds of live frames at 60 Hz: 120 updates if the clock still drove the loop, and the
    // one fixed settling pass the freeze owes the world instead -- 60 steps, every one of them the
    // same 1/60s whatever the machine is doing.
    for (let frame = 1; frame <= 120; frame += 1) expect(loop.stepFrame(frame * 16.6667)).toBe(0);

    expect(dts).toHaveLength(60);
    expect(new Set(dts)).toEqual(new Set([1 / 60]));
    expect(loop.tick()).toBe(60);

    // The manual clock is still the one that moves the simulation, and it does not re-arm the
    // settle: a run must not gain a second world per step the runner counts.
    expect(loop.advance(3)).toBe(3);
    expect(loop.tick()).toBe(63);
    for (let frame = 121; frame <= 240; frame += 1) expect(loop.stepFrame(frame * 16.6667)).toBe(0);
    expect(dts).toHaveLength(63);
    expect(loop.tick()).toBe(63);
  });

  it("settles on the first live frame after the freeze, not on a held boot frame", () => {
    // The boot hold covers the load, and the scene has not entered while it is set, so a settle
    // spent there would settle nothing. The arm survives it and fires when the loop is live.
    const dts: number[] = [];
    const loop = new FixedStepLoop({ onUpdate: (dt) => dts.push(dt) });
    loop.freezeClock(3);
    loop.setHeld(true);
    loop.start(0);
    loop.stepFrame(16.6667);
    loop.stepFrame(33.3333);
    expect(dts).toEqual([]);

    loop.setHeld(false);
    loop.stepFrame(50);
    expect(dts).toHaveLength(3);
    loop.stepFrame(66.6667);
    expect(dts).toHaveLength(3);
  });

  it("settles nothing when the freeze is asked for no steps", () => {
    // The count is the knob, and zero is a real answer: a caller that wants the world exactly as
    // the game built it says so rather than having it settle anyway.
    const dts: number[] = [];
    const loop = new FixedStepLoop({ onUpdate: (dt) => dts.push(dt) });
    loop.freezeClock(0);
    loop.start(0);
    loop.stepFrame(16.6667);
    expect(dts).toEqual([]);
    expect(loop.tick()).toBe(0);
    expect(loop.clockFrozen).toBe(true);
    expect(() => loop.freezeClock(-1)).toThrow(/settleSteps/u);
    expect(() => loop.freezeClock(1.5)).toThrow(/settleSteps/u);
  });

  it("reports the actual callback duration separately from presentation timestamps", () => {
    let clock = 0;
    const frameDurations: number[] = [];
    const loop = new FixedStepLoop({
      now: () => clock,
      onFrame: (frameMs) => frameDurations.push(frameMs),
      onRender: () => {
        clock += 12;
        return undefined;
      },
      onUpdate: () => undefined,
    });

    loop.stepFrame(0);
    loop.stepFrame(1_000);

    expect(frameDurations).toEqual([12, 12]);
  });
});

describe("FixedStepLoop metrics collection", () => {
  function makeLoop(collectMetrics?: boolean) {
    const state = { renders: 0 };
    const loop = new FixedStepLoop({
      collectMetrics,
      onUpdate: () => undefined,
      onRender: () => {
        state.renders += 1;
        return { drawCalls: state.renders, triangles: state.renders * 3 };
      },
    });
    return { loop, state };
  }

  it("collects no samples by default - nothing reads them outside a diagnostics consumer", () => {
    const { loop } = makeLoop();
    loop.start(0);
    for (let index = 1; index <= 5; index += 1) loop.stepFrame(index * 16);
    expect(loop.runtimeDiagnosticsSeries()).toHaveLength(0);
  });

  it("does not create a disabled metrics record for a rendered frame", () => {
    const rendered: Array<undefined | IRenderPerformanceMetrics> = [];
    const loop = new FixedStepLoop({
      onUpdate: () => undefined,
      onRender: () => {
        const metrics = undefined;
        rendered.push(metrics);
        return metrics;
      },
    });

    loop.start(0);
    loop.stepFrame(16);

    expect(rendered).toEqual([undefined]);
  });

  it("still calls onRender every frame while collecting nothing", () => {
    const { loop, state } = makeLoop();
    loop.start(0);
    for (let index = 1; index <= 3; index += 1) loop.stepFrame(index * 16);
    expect(state.renders).toBe(3);
  });

  it("collects one sample per rendered frame when collectMetrics is true", () => {
    const { loop } = makeLoop(true);
    loop.start(0);
    // The first rendered frame only establishes the previous-render timestamp; sampling starts
    // with the second, exactly as the always-on collector behaved.
    for (let index = 1; index <= 5; index += 1) loop.stepFrame(index * 16);
    const series = loop.runtimeDiagnosticsSeries();
    expect(series).toHaveLength(4);
    expect(series[0]?.drawCalls).toBeGreaterThan(0);
  });

  it("starts collecting only from enablement when enabled mid-run", () => {
    const { loop } = makeLoop(false);
    loop.start(0);
    loop.stepFrame(16);
    expect(loop.runtimeDiagnosticsSeries()).toHaveLength(0);
    loop.setCollectMetrics(true);
    loop.stepFrame(32);
    expect(loop.runtimeDiagnosticsSeries()).toHaveLength(1);
  });

  it("renders but does not simulate, tick or bank time while held", () => {
    // Boot holds the loop so a loading screen can draw before the start scene has loaded. Three
    // things have to survive that hold: nothing is stepped, `tick()` still reads zero -- the
    // determinism contract every playtest hold rests on, and `#tick` advances inside the very
    // block a naive "skip the callback" gate would leave running -- and no elapsed time is
    // banked, or the first real tick arrives with a dt spanning the whole asset load.
    const steps: number[] = [];
    let renders = 0;
    const loop = new FixedStepLoop({
      onUpdate: (dt) => steps.push(dt),
      onRender: () => {
        renders += 1;
        return undefined;
      },
    });

    loop.setHeld(true);
    expect(loop.held).toBe(true);
    loop.start(0);
    // Two seconds of held frames: unheld, this is 120 updates.
    for (let frame = 1; frame <= 120; frame += 1) expect(loop.stepFrame(frame * 16.6667)).toBe(0);

    expect(renders).toBe(120);
    expect(steps).toHaveLength(0);
    expect(loop.tick()).toBe(0);

    loop.setHeld(false);
    expect(loop.held).toBe(false);
    // One ordinary frame after release. A loop that banked the hold would spend its whole
    // catch-up budget here instead of running the single step the frame is worth.
    expect(loop.stepFrame(121 * 16.6667)).toBe(1);
    expect(steps).toEqual([1 / 60]);
    expect(loop.tick()).toBe(1);
  });
});

describe("FixedStepLoop retained render samples", () => {
  // One frame of 30 nested render() calls across all four kinds: a shadow-casting cathedral with a
  // post chain. The retained sample used to carry one entry per call, so a full window no longer
  // fitted the playtest bridge's payload and `assert.performance` died before frame 0.
  function nestedPasses(): IRenderPassSample[] {
    return Array.from({ length: 30 }, (_, index) => ({
      draws: index + 1,
      kind: FRAME_PASS_KINDS[index % 4] ?? "nested",
      triangles: (index + 1) * 10,
    }));
  }
  function makeNestedLoop() {
    return new FixedStepLoop({
      collectMetrics: true,
      onRender: () => ({ drawCalls: 465, passes: nestedPasses(), triangles: 4_650 }),
      onUpdate: () => undefined,
    });
  }

  it("keeps one entry per pass kind, summed over that frame's render calls", () => {
    const loop = makeNestedLoop();
    loop.start(0);
    // The first frame only establishes the previous-render timestamp; samples start from the second.
    loop.stepFrame(16);
    loop.stepFrame(32);

    // Summed per kind, not the first call of each: 1+5+...+29 draws is the whole main lane.
    expect(loop.runtimeDiagnosticsSeries()[0]?.passes).toEqual([
      { draws: 120, kind: "main", triangles: 1_200 },
      { draws: 128, kind: "shadow", triangles: 1_280 },
      { draws: 105, kind: "reflection", triangles: 1_050 },
      { draws: 112, kind: "nested", triangles: 1_120 },
    ]);
  });

  it("serialises a full 1,024-sample window under the bridge's 1 MB payload ceiling", () => {
    // The ceiling the runner enforces on every observation (`assertBoundedPayload`), restated
    // rather than imported: core does not depend on the playtest package.
    const loop = makeNestedLoop();
    loop.start(0);
    // One frame only establishes the previous-render timestamp, so samples start from the second.
    for (let frame = 1; frame <= 1_026; frame += 1) loop.stepFrame(frame * 16);
    const series = loop.runtimeDiagnosticsSeries();

    expect(series).toHaveLength(1_024);
    expect(JSON.stringify(series).length).toBeLessThan(1_000_000);
  });
});

describe("after-physics phase dispatch", () => {
  it("runs a callback registered during dispatch on the next run only", () => {
    const phase = createAfterPhysicsPhase();
    const seen: string[] = [];
    phase.register(() => {
      seen.push("first");
      phase.register(() => seen.push("late"));
    });
    phase.run(1 / 60);
    expect(seen).toEqual(["first"]);
    phase.run(1 / 60);
    expect(seen).toEqual(["first", "first", "late"]);
  });

  it("still runs a snapshotted callback removed by an earlier one", () => {
    const phase = createAfterPhysicsPhase();
    const seen: string[] = [];
    let removeSecond: () => void = () => undefined;
    phase.register(() => {
      seen.push("first");
      removeSecond();
    });
    removeSecond = phase.register(() => seen.push("second"));
    phase.run(1 / 60);
    expect(seen).toEqual(["first", "second"]);
  });

  it("drops cleared callbacks before the next run", () => {
    const phase = createAfterPhysicsPhase();
    let calls = 0;
    phase.register(() => {
      calls += 1;
    });
    phase.clear();
    phase.run(1 / 60);
    expect(calls).toBe(0);
  });

  it("keeps a nested dispatch from clobbering the outer snapshot", () => {
    const phase = createAfterPhysicsPhase();
    const seen: string[] = [];
    let nested = false;
    phase.register(() => {
      seen.push("outer");
      if (!nested) {
        nested = true;
        phase.run(1 / 60);
      }
    });
    phase.register(() => seen.push("second"));
    phase.run(1 / 60);
    expect(seen).toEqual(["outer", "outer", "second", "second"]);
  });

  it("leaves the deep pool clean after a callback throws", () => {
    const phase = createAfterPhysicsPhase();
    const seen: string[] = [];
    phase.register(() => {
      throw new Error("callback failed");
    });
    expect(() => phase.run(1 / 60)).toThrow("callback failed");
    phase.clear();
    phase.register(() => seen.push("after"));
    phase.run(1 / 60);
    expect(seen).toEqual(["after"]);
  });
});
