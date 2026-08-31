import { PerspectiveCamera, Scene, type Vector2, type WebGLRenderer } from "three";
import { expect, test } from "vitest";

import { installThreePlaytestBridge } from "../src/three/bridge.js";
import { validatePlaytestScenario } from "../src/scenario/schema-validate.js";
import { PlaytestBridgeError } from "../src/runner/bridgeClient.js";
import { playtestDiagnostic } from "../src/diagnostics.js";
import { waitForStartupReady, type IStartupReadySource } from "../src/runner/startupReady.js";
import type { IPlaytestBridgeReady, IPlaytestStartupObservation } from "../src/protocol.js";

// The defect these cover: a fixed-step runner advances ticks as fast as the machine allows, so
// a scenario finished during a launch that had not. `starter-look` then read flagSteps 0 before
// and 0 after — the cloth had never been dispatched, because the game holds compute behind its
// loading layer — and failed TN_PLAYTEST_RESOURCE_ASSERTION_FAILED on a workstation and in CI.

const renderer = {
  getDrawingBufferSize(target: Vector2) {
    return target.set(1280, 720);
  },
} as WebGLRenderer;

function source(
  capabilities: readonly string[],
  readings: readonly (IPlaytestStartupObservation | undefined)[],
): IStartupReadySource & { calls: number } {
  let index = 0;
  return {
    calls: 0,
    description: { capabilities },
    readiness(): Promise<IPlaytestBridgeReady> {
      const startup = readings[Math.min(index, readings.length - 1)];
      index += 1;
      this.calls = index;
      return Promise.resolve(startup === undefined ? { ready: true } : { ready: true, startup });
    },
  };
}

const collapsing = { phase: "collapsing", progress: 0 } as const;
const ready = { phase: "ready", progress: 1 } as const;

test("holds until the application reports its world is safe to observe", async () => {
  const bridge = source(["runtime.startup"], [collapsing, collapsing, collapsing, ready]);
  let pumped = 0;
  const observed = await waitForStartupReady({
    bridge,
    pump: async () => {
      pumped += 1;
    },
  });
  expect(observed).toEqual({ rule: "sustained-frames", startup: ready });
  // Three not-ready readings, so three frames were pumped rather than the baseline being taken
  // against a game that had not finished loading.
  expect(pumped).toBe(3);
});

test("a game that never finishes starting fails with it named, never silently observed", async () => {
  let clock = 0;
  await expect(
    waitForStartupReady({
      bridge: source(["runtime.startup"], [collapsing]),
      now: () => clock,
      pump: async () => {
        clock += 100;
      },
      timeoutMs: 250,
    }),
  ).rejects.toMatchObject({ diagnostic: { code: "TN_PLAYTEST_STARTUP_NOT_READY" } });
});

test("an application that reports no startup at all is not waited on", async () => {
  const bridge = source([], [undefined]);
  // A plain Three.js page has no startup phase to report; the harness runs against those by
  // design, so the wait has to be invisible to them rather than a new requirement.
  await expect(waitForStartupReady({ bridge, pump: async () => undefined })).resolves.toBeUndefined();
  expect(bridge.calls).toBe(0);
});

test("advertising runtime.startup and then reporting none is malformed, not 'still loading'", async () => {
  await expect(
    waitForStartupReady({ bridge: source(["runtime.startup"], [undefined]), pump: async () => undefined }),
  ).rejects.toBeInstanceOf(PlaytestBridgeError);
});

test("the three bridge advertises and reports startup only when the application supplies it", async () => {
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
  const silent = installThreePlaytestBridge({ camera, renderer, scene });
  expect((await silent.bridge.describe()).capabilities).not.toContain("runtime.startup");
  expect(silent.bridge.ready()).toEqual({ ready: true });
  silent.dispose();

  let phase: IPlaytestStartupObservation["phase"] = "collapsing";
  const reporting = installThreePlaytestBridge({
    camera,
    renderer,
    scene,
    startup: () => ({ phase, progress: phase === "ready" ? 1 : 0 }),
  });
  expect((await reporting.bridge.describe()).capabilities).toContain("runtime.startup");
  expect(reporting.bridge.ready()).toEqual({ ready: true, startup: collapsing });
  phase = "ready";
  expect(reporting.bridge.ready()).toEqual({ ready: true, startup: ready });
  reporting.dispose();
});

test("a scenario whose subject is the launch can opt out, and the field is validated", () => {
  const base = {
    name: "loading-screen",
    schemaVersion: 1,
    steps: [{ kind: "wait", waitTicks: 1 }],
    target: "web",
    viewport: { height: 360, width: 640 },
    warmupFrames: 0,
  };
  // Default is to wait: an absent field must never read as "skip the wait".
  expect(validatePlaytestScenario(base, "s.json").awaitStartup).toBeUndefined();
  expect(validatePlaytestScenario({ ...base, awaitStartup: false }, "s.json").awaitStartup).toBe(false);
  // Fails closed rather than coercing a typo into an opt-out.
  expect(() => validatePlaytestScenario({ ...base, awaitStartup: "no" }, "s.json")).toThrow();
});


test("a bridge too busy to answer is still starting, not broken", async () => {
  // `ready` carries the protocol operation timeout, and this wait is the one caller that makes
  // that call while first-use work is compiling — the moment the page's main thread is most
  // likely to block past it. Observed for real: "Bridge operation 'ready' exceeded 5000ms".
  const timeout = new PlaytestBridgeError(
    playtestDiagnostic("TN_PLAYTEST_OPERATION_TIMEOUT", "Bridge operation 'ready' exceeded 5000ms.", "x"),
  );
  let call = 0;
  const bridge: IStartupReadySource = {
    description: { capabilities: ["runtime.startup"] },
    readiness: () => {
      call += 1;
      if (call <= 2) return Promise.reject(timeout);
      return Promise.resolve({ ready: true, startup: ready });
    },
  };
  let pumped = 0;
  await expect(
    waitForStartupReady({
      bridge,
      pump: async () => {
        pumped += 1;
      },
    }),
  ).resolves.toEqual({ rule: "sustained-frames", startup: ready });
  expect(pumped).toBe(2);
});

test("a bridge that only ever times out still fails, by name", async () => {
  let clock = 0;
  const timeout = new PlaytestBridgeError(
    playtestDiagnostic("TN_PLAYTEST_OPERATION_TIMEOUT", "Bridge operation 'ready' exceeded 5000ms.", "x"),
  );
  await expect(
    waitForStartupReady({
      bridge: {
        description: { capabilities: ["runtime.startup"] },
        readiness: () => Promise.reject(timeout),
      },
      now: () => clock,
      pump: async () => {
        clock += 100;
      },
      timeoutMs: 250,
    }),
  ).rejects.toMatchObject({ diagnostic: { code: "TN_PLAYTEST_STARTUP_NOT_READY" } });
});

test("an error that is not a timeout is never swallowed", async () => {
  const boom = new Error("bridge exploded");
  await expect(
    waitForStartupReady({
      bridge: {
        description: { capabilities: ["runtime.startup"] },
        readiness: () => Promise.reject(boom),
      },
      pump: async () => undefined,
    }),
  ).rejects.toBe(boom);
});

// (c): a lane that has declared a software adapter has already conceded it is not measuring the
// player's experience, so it must not wait for a smoothness window a CPU rasteriser can never
// meet. What must NOT change is compile settlement — that is the part that makes a run observe
// the game instead of the loading screen.
const collapsingCompiled = { compileSettled: true, phase: "collapsing", progress: 0 } as const;
const collapsingCompiling = { compileSettled: false, phase: "collapsing", progress: 0 } as const;

test("a declared software adapter resolves on compile settlement, and says so", async () => {
  const bridge = source(["runtime.startup"], [collapsingCompiling, collapsingCompiled]);
  await expect(
    waitForStartupReady({ acceptCompileSettled: true, bridge, pump: async () => undefined }),
  ).resolves.toEqual({ rule: "compile-settled", startup: collapsingCompiled });
});

test("compile settlement is still required — the relaxation never skips it", async () => {
  let clock = 0;
  // Compilation never settles: the run must fail rather than observe a loading screen, software
  // adapter or not. This is the half of the wait that (c) must not weaken.
  await expect(
    waitForStartupReady({
      acceptCompileSettled: true,
      bridge: source(["runtime.startup"], [collapsingCompiling]),
      now: () => clock,
      pump: async () => {
        clock += 100;
      },
      timeoutMs: 250,
    }),
  ).rejects.toMatchObject({ diagnostic: { code: "TN_PLAYTEST_STARTUP_NOT_READY" } });
});

test("without the operator's declaration, compile settlement is not enough", async () => {
  let clock = 0;
  // The same observation that resolves the software lane must NOT resolve a hardware one. An
  // implicit relaxation would silently apply the day something else on a GPU lane got slow.
  await expect(
    waitForStartupReady({
      bridge: source(["runtime.startup"], [collapsingCompiled]),
      now: () => clock,
      pump: async () => {
        clock += 100;
      },
      timeoutMs: 250,
    }),
  ).rejects.toMatchObject({ diagnostic: { code: "TN_PLAYTEST_STARTUP_NOT_READY" } });
});

test("a game that reports no compileSettled cannot be relaxed against", async () => {
  let clock = 0;
  // Relaxing on a missing signal would be inferring it. Fails closed instead.
  await expect(
    waitForStartupReady({
      acceptCompileSettled: true,
      bridge: source(["runtime.startup"], [collapsing]),
      now: () => clock,
      pump: async () => {
        clock += 100;
      },
      timeoutMs: 250,
    }),
  ).rejects.toMatchObject({ diagnostic: { code: "TN_PLAYTEST_STARTUP_NOT_READY" } });
});

test("a software lane that does reach full readiness still reports the stricter rule", async () => {
  const bridge = source(["runtime.startup"], [ready]);
  await expect(
    waitForStartupReady({ acceptCompileSettled: true, bridge, pump: async () => undefined }),
  ).resolves.toEqual({ rule: "sustained-frames", startup: ready });
});

test("yields to teardown instead of polling to its own deadline", async () => {
  // The orphan gate kills a run on purpose and then asserts the browser profile is gone. With a
  // 180s deadline and a poll that treats a busy bridge as "still starting", a signal arriving
  // mid-wait left this loop running for minutes while the teardown behind it waited — observed in
  // CI as "before 1, after 3 ... no process holds these directories".
  let tearingDown = false;
  let polls = 0;
  const bridge = {
    description: { capabilities: ["runtime.startup"] },
    readiness: async () => {
      polls += 1;
      if (polls === 2) tearingDown = true;
      return { startup: { phase: "collapsing", compileSettled: false } } as never;
    },
  };
  await expect(
    waitForStartupReady({
      aborted: () => tearingDown,
      bridge: bridge as never,
      pump: async () => undefined,
      timeoutMs: 180_000,
    }),
  ).rejects.toMatchObject({ diagnostic: { code: "TN_PLAYTEST_STARTUP_ABORTED" } });
  expect(polls).toBeLessThanOrEqual(2);
});
