import { PerspectiveCamera, Scene, type Vector2, type WebGLRenderer } from "three";
import { expect, test } from "vitest";

import { installThreePlaytestBridge } from "../src/three/bridge.js";
import { validatePlaytestScenario } from "../src/scenario/schema-validate.js";
import { PlaytestBridgeError } from "../src/runner/bridgeClient.js";
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
  expect(observed).toEqual(ready);
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

