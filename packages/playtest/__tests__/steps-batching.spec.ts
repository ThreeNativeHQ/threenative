import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { runStep } from "../src/runner/steps.js";
import type { IPlaytestBridgeClient } from "../src/runner/bridgeClient.js";

describe("steps 10-tick batching", () => {
  it("batches fixed-step ticks in chunks of 10", async () => {
    const advances: number[] = [];
    const bridge = {
      advance: vi.fn(async (ticks: number) => {
        advances.push(ticks);
        return { clock: { mode: "fixed-step", tick: 0 }, ticks };
      }),
      description: {
        capabilities: ["runtime.fixedStep"],
        limits: {},
        name: "test-bridge",
        protocolVersion: "0.1.0",
      },
      sample: vi.fn(async () => ({ clock: { mode: "fixed-step", tick: 0 }, diagnostics: [] })),
    } as unknown as IPlaytestBridgeClient;

    const page = {} as unknown as Page;

    await runStep(
      page,
      bridge,
      { kind: "wait", release: false, waitTicks: 25 },
      { height: 100, width: 100 },
      undefined,
      [],
      { heldKeys: new Set(), pointerButtons: 0, pointers: new Map() },
      undefined,
      false,
    );

    expect(advances).toEqual([10, 10, 5]);
  });
});
