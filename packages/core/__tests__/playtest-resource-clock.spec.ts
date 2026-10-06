import type { Page } from "playwright";
import { PerspectiveCamera, Scene } from "three";
import { expect, test, vi } from "vitest";
import {
  type IBridgeTransport,
  connectPlaytestBridgeTransport,
} from "../../playtest/src/runner/bridgeClient.js";
import { runStep } from "../../playtest/src/runner/steps.js";
import { validatePlaytestScenario } from "../../playtest/src/scenario.js";
import { installThreePlaytestBridge } from "../../playtest/src/three/bridge.js";
import { FixedStepLoop } from "../src/loop.js";

test.each([false, true])(
  "resource waits preserve the real bridge/loop liveClock=%s",
  async (liveClock) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const loop = new FixedStepLoop({
      step: 0.01,
      onUpdate: () => {},
      requestFrame: (callback) => Number(setTimeout(() => callback(performance.now()), 10)),
      cancelFrame: (handle) => clearTimeout(handle),
    });
    if (!liveClock) loop.freezeClock(0);
    loop.start(0);
    const installed = installThreePlaytestBridge({
      camera: new PerspectiveCamera(),
      scene: new Scene(),
      renderer: { getDrawingBufferSize: (target) => target.set(1280, 720) },
      clockMode: liveClock ? "wall-clock" : "fixed-step",
      fixedStep: (ticks) => loop.advance(ticks),
      tick: loop.tick,
      resources: { read: () => ({ state: { tick: loop.tick() } }) },
    });
    const transport: IBridgeTransport = {
      capabilities: [],
      waitForBridge: async () => true,
      close: async () => {},
      async call<T>(method: string, argument?: unknown): Promise<T> {
        const operation: unknown = Reflect.get(installed.bridge, method);
        if (typeof operation !== "function")
          throw new Error(`Unknown real bridge method '${method}'.`);
        return (await Reflect.apply(operation, installed.bridge, [argument])) as T;
      },
    };
    const scenario = validatePlaytestScenario(
      {
        schemaVersion: 1,
        name: "resource-clock",
        artifacts: { screenshots: false },
        steps: [{ timeoutMs: 100, waitForResource: { id: "state", path: "tick", gte: 3 } }],
        assert: { resources: [{ id: "state", path: "tick", gte: 3, changed: true }] },
      },
      "clock.json",
    );
    try {
      const client = await connectPlaytestBridgeTransport(transport, scenario);
      if (client === undefined) throw new Error("Actual bridge handshake did not connect.");
      const waitStep = scenario.steps[0];
      if (waitStep === undefined) throw new Error("Actual clock scenario has no resource wait.");
      const input = { heldKeys: new Set<string>(), pointerButtons: 0, pointers: new Map() };
      const pending = runStep(
        {} as Page,
        client,
        waitStep,
        scenario.viewport,
        undefined,
        [],
        input,
        { include: ["resources"] },
        true,
        undefined,
        liveClock,
      );
      await vi.advanceTimersByTimeAsync(64);
      const observed = (await pending).afterStep;
      expect(observed?.clock.mode).toBe(liveClock ? "wall-clock" : "fixed-step");
      expect(loop.clockFrozen).toBe(!liveClock);
      expect((observed?.resources?.state as { tick: number }).tick).toBeGreaterThanOrEqual(3);
      const completedTick = loop.tick();
      await vi.advanceTimersByTimeAsync(20);
      expect(loop.tick()).toBe(liveClock ? completedTick + 2 : completedTick);

      // The same real resource path must still fail at its deadline, rather than wait indefinitely.
      const timeout = runStep(
        {} as Page,
        client,
        {
          ...waitStep,
          timeoutMs: 20,
          waitForResource: { id: "state", path: "tick", gte: 1_000_000 },
        },
        scenario.viewport,
        undefined,
        [],
        input,
        { include: ["resources"] },
        true,
        undefined,
        liveClock,
      );
      const rejected = expect(timeout).rejects.toThrow(/timed out.*20 ms/i);
      await vi.advanceTimersByTimeAsync(20);
      await rejected;
      expect(loop.clockFrozen).toBe(!liveClock);

      // Holding and stopping remain authoritative even when resource polling uses the live clock.
      loop.setHeld(true);
      const heldTick = loop.tick();
      await vi.advanceTimersByTimeAsync(20);
      expect(loop.tick()).toBe(heldTick);
      loop.setHeld(false);
      await vi.advanceTimersByTimeAsync(20);
      expect(loop.tick()).toBe(liveClock ? heldTick + 2 : heldTick);
      loop.stop();
      const stoppedTick = loop.tick();
      await vi.advanceTimersByTimeAsync(20);
      expect(loop.tick()).toBe(stoppedTick);
      await client.close();
    } finally {
      loop.stop();
      installed.dispose();
      vi.useRealTimers();
    }
  },
);
