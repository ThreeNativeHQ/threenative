import type { IGameConfig } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { PLAYTEST_BRIDGE_GLOBAL, PLAYTEST_CLOCK_GLOBAL } from "@threenative/playtest/protocol";
import { PerspectiveCamera, Scene } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IAnimalsState } from "../../../examples/procedural-animals/src/Animals.js";
import { FrameBudget } from "../../core/src/frame-budget.js";

const captured = vi.hoisted(() => ({
  config: undefined as IGameConfig<IAnimalsState, IPhysicsContext> | undefined,
}));
// Capture authored configuration without starting a DOM/GPU game; the report sink, collector,
// public Three callbacks and FrameBudget are real. GPU destruction alone is stubbed.
vi.mock("../../core/dist/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@threenative/core")>()),
  defineGame: (config: IGameConfig<IAnimalsState, IPhysicsContext>) => {
    captured.config = config;
    return {};
  },
}));
import { makeAnimalPerformanceGame } from "../../../examples/procedural-animals/src/performance-game.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function admission() {
  makeAnimalPerformanceGame("baseline");
  const config = captured.config;
  if (!config || !config.frameBudget) throw new Error("Missing authored benchmark");
  const plugin = config.plugins?.[2];
  if (!plugin || typeof plugin === "function" || !plugin.setup)
    throw new Error("Missing authored plugin");
  let beforeRender: (() => void) | undefined;
  const state: Record<string, unknown> = {};
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const dispose = vi.fn();
  const observer = { status: () => ({ state: "active", generation: 1 }), stop: vi.fn(), dispose };
  const ctx = {
    startup: { phase: "ready" },
    input: { justPressed: () => true },
    renderer: { compiling: false, compileCount: 0, observeGpuFrames: () => observer },
    state: { set: (patch: Record<string, unknown>) => Object.assign(state, patch) },
    beforeRender: (callback: () => void) => {
      beforeRender = callback;
      return () => {};
    },
    scene,
    camera,
  };
  const restoreScene = scene.onBeforeRender;
  const budget = new FrameBudget(config.frameBudget);
  // Establish a presented timestamp before the benchmark is armed.
  budget.beginFrame(0, 0);
  budget.markSimulationEnd(0, 0);
  budget.endFrame(0);
  const cleanup = await plugin.setup(ctx as never, { tick: () => 10 } as never);
  vi.stubGlobal(PLAYTEST_CLOCK_GLOBAL, "wall-clock");
  vi.stubGlobal(PLAYTEST_BRIDGE_GLOBAL, {
    sample: async () => ({ clock: { mode: "wall-clock", tick: 10, timeMs: 20 } }),
  });
  plugin.beforeUpdate?.(ctx as never, 1 / 60);
  if (!beforeRender) throw new Error("Missing frame admission");
  beforeRender();
  await Promise.resolve();
  await Promise.resolve();
  beforeRender();
  expect(state.performanceStarted).toBe(true);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  return { budget, state, scene, camera, restoreScene, cleanup, dispose, error };
}

describe("animal benchmark hitch attribution", () => {
  it("rejects and releases an armed collector on the exact public hitch marker before another render", async () => {
    const s = await admission();
    const renderer = { info: { frame: 1, update: () => {} } };
    s.budget.beginFrame(2500, 2500);
    s.scene.onBeforeRender(
      renderer as never,
      s.scene,
      s.camera,
      null as never,
      undefined as never,
      undefined as never,
    );
    s.scene.onAfterRender(renderer as never, s.scene, s.camera);
    s.budget.markSimulationEnd(2501, 1);
    s.budget.endFrame(2502);
    expect(s.state.performanceFinished).toBe(true);
    expect(s.state.performanceDone).toBe(false);
    expect(s.state.performanceError).toContain("TN_ANIMAL_PERFORMANCE_FRAME_HITCH:TN_FRAME_HITCH:");
    expect(s.state.performanceError).toContain('"gapMs":2500');
    expect(s.scene.onBeforeRender).toBe(s.restoreScene);
    expect(s.dispose).toHaveBeenCalled();
    expect(s.error.mock.calls).toHaveLength(1);
    s.cleanup?.();
  });
});
