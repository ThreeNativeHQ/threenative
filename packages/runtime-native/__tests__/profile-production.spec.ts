import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

type Instrumentation = {
  webFrameInstrumentation(
    markerUrl: string,
    control: string | undefined,
    warmupFrames?: number,
    paceTicks?: boolean,
  ): string;
  nativeFrameInstrumentation(
    control: string | undefined,
    warmupFrames?: number,
    paceTicks?: boolean,
  ): string;
  productionExecutionHold(paceTicks?: boolean): string;
};

async function instrumentation(): Promise<Instrumentation> {
  return (await import(
    new URL("../scripts/profile-production.mjs", import.meta.url).href
  )) as Instrumentation;
}

type FrameSample = { frameMs: number; presentationMs?: number };

interface SandboxHarness {
  bridge: { advance(ticks: number): Promise<unknown>; sample(): unknown };
  posts: Array<{ kind?: string; samples?: FrameSample[] }>;
  timers: number[];
  /** Registers a consumer callback through the wrapper the instrumentation installed. */
  register(callback: () => void): void;
  /** Fires every scheduled callback once with one shared presentation timestamp. */
  present(timestamp: number): void;
}

function createSandbox(source: string): SandboxHarness {
  const scheduled: Array<(timestamp: number) => void> = [];
  const timers: number[] = [];
  const posts: SandboxHarness["posts"] = [];
  let clock = 1_000;
  const bridge = {
    advance: async (ticks: number) => ({ clock: { mode: "fixed-step", tick: ticks }, ticks }),
    sample: () => ({}),
  };
  const sandbox: Record<string, unknown> = {
    Date,
    JSON,
    Number,
    Object,
    Promise,
    console,
    fetch: async (_url: string, options?: { body?: string }) => {
      if (options?.body !== undefined) posts.push(JSON.parse(options.body));
    },
    performance: { now: () => clock },
    requestAnimationFrame: (callback: (timestamp: number) => void) => {
      scheduled.push(callback);
      return scheduled.length;
    },
    setTimeout: (callback: () => void, milliseconds: number) => {
      timers.push(milliseconds);
      callback();
      return timers.length;
    },
    __THREENATIVE_PLAYTEST_BRIDGE__: bridge,
  };
  sandbox.globalThis = sandbox;
  runInNewContext(source, sandbox);
  return {
    bridge,
    posts,
    register: (callback) => {
      (sandbox.requestAnimationFrame as (callback: () => void) => number)(callback);
    },
    present: (timestamp) => {
      clock = timestamp;
      for (const callback of scheduled) callback(timestamp);
    },
    timers,
  };
}

describe("production profile frame sampling", () => {
  it("should count one frame per requestAnimationFrame presentation, not per callback", async () => {
    const { webFrameInstrumentation } = await instrumentation();
    const harness = createSandbox(
      webFrameInstrumentation("http://127.0.0.1:1/marker", undefined, 0),
    );
    // Two consumers registered for the same presentation: the game loop and a second callback.
    harness.register(() => {});
    harness.register(() => {});
    for (let index = 0; index < 31; index += 1) {
      harness.present(1_000 + (index + 1) * (1_000 / 60));
    }
    const batch = harness.posts.find(({ kind }) => kind === "samples");
    expect(batch?.samples).toHaveLength(30);
    const samples = batch?.samples ?? [];
    expect(samples.every(({ frameMs }) => frameMs > 0)).toBe(true);
    const presentations = samples.map(({ presentationMs }) => presentationMs as number);
    expect(
      presentations.every((value, index) => index === 0 || value > (presentations[index - 1] ?? 0)),
    ).toBe(true);
  });

  it("should pace fixed-step advance to the loop tick interval", async () => {
    const { webFrameInstrumentation } = await instrumentation();
    const harness = createSandbox(
      webFrameInstrumentation("http://127.0.0.1:1/marker", undefined, 0, true),
    );
    await harness.bridge.advance(10);
    expect(harness.timers).toContainEqual(expect.closeTo((1_000 / 60) * 10, 0.01));
  });

  it("should pace only when the synthetic duration workload asks for it", async () => {
    const { webFrameInstrumentation } = await instrumentation();
    const harness = createSandbox(
      webFrameInstrumentation("http://127.0.0.1:1/marker", undefined, 0),
    );
    await harness.bridge.advance(10);
    expect(harness.timers).toEqual([]);
  });

  it("should compile the native instrumentation with the same hold", async () => {
    const { nativeFrameInstrumentation, productionExecutionHold } = await instrumentation();
    expect(() => createSandbox(nativeFrameInstrumentation("slow-native", 0, true))).not.toThrow();
    expect(productionExecutionHold(true)).toContain("tnProductionPaceEnabled = true");
    expect(productionExecutionHold()).toContain("tnProductionPaceEnabled = false");
  });
});
