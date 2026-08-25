import { describe, expect, test, vi } from "vitest";

import { type IWarmUpProgress, warmUpScene } from "../src/warmup.js";

/**
 * The launch this exists to fix: a Pixel 8 spent 24.5 seconds across 107 pipeline compiles inside
 * one frame, because nothing compiled the scene until the first `render()` drew it. For that whole
 * span the loop presented nothing, so the loading screen froze and the game read as hung.
 *
 * What these assert is therefore not "compiling happened" — it happened before too, all at once.
 * It is that the work is **cut into slices with a yield between them**, because the yield is the
 * only reason a frame reaches the screen while the compiling runs.
 */

interface IFakeObject {
  children: IFakeObject[];
  material?: object;
  name: string;
  /** Set on the fakes that stand in for a pipeline variant sharing another object's material. */
  isSkinnedMesh?: boolean;
}

const mesh = (name: string): IFakeObject => ({ children: [], material: {}, name });
const group = (name: string, children: IFakeObject[]): IFakeObject => ({ children, name });

const sceneOf = (count: number): IFakeObject =>
  group(
    "scene",
    Array.from({ length: count }, (_unused, index) => mesh(`mesh-${index}`)),
  );

// The renderer and camera are structural: nothing here needs a GPU, a canvas or a real three.js
// scene, which is what keeps this in the default node-environment gate.
const fakeRenderer = () => {
  const compiled: string[] = [];
  return {
    compiled,
    compileAsync: (object: unknown) => {
      compiled.push((object as IFakeObject).name);
      return Promise.resolve();
    },
  };
};

// Most of these exercise the sliced, per-object granularity, so `run` selects it. The default is
// `"scene"` -- one whole-scene compile -- and has its own tests at the bottom.
// biome-ignore lint/suspicious/noExplicitAny: the fakes above stand in for three.js structurally.
const run = (renderer: any, scene: any, options: any = {}) =>
  warmUpScene(renderer, scene, {} as never, { granularity: "object", ...options });

describe("scene warm-up", () => {
  test("should compile every renderable and yield a frame between slices", async () => {
    const renderer = fakeRenderer();
    const yields = vi.fn(() => Promise.resolve());
    const progress: IWarmUpProgress[] = [];

    const report = await run(renderer, sceneOf(10), {
      sliceSize: 4,
      yieldFrame: yields,
      onProgress: (entry: IWarmUpProgress) => progress.push(entry),
    });

    expect(report.compiled).toBe(10);
    expect(renderer.compiled).toHaveLength(10);
    // Ten objects in slices of four is three slices: 4, 8, 10.
    expect(report.slices).toBe(3);
    expect(progress.map((entry) => entry.done)).toEqual([4, 8, 10]);
    expect(progress.every((entry) => entry.total === 10)).toBe(true);
    // Two yields, not three: the final slice does not yield, because the caller renders next and
    // one more empty frame would only add to the launch.
    expect(yields).toHaveBeenCalledTimes(2);
  });

  test("should present a frame while compiling, which is the whole point", async () => {
    // The regression this guards is the one that shipped: all the compiling inside one frame. If
    // the yield is removed, a 200-object scene warms up without ever handing the loop a frame and
    // the loading screen freezes exactly as it did on the phone.
    const renderer = fakeRenderer();
    const yields = vi.fn(() => Promise.resolve());
    await run(renderer, sceneOf(200), { sliceSize: 24, yieldFrame: yields });
    expect(yields.mock.calls.length).toBeGreaterThan(1);
  });

  test("should skip objects that carry no material", async () => {
    // Compiling a Group walks its whole subtree again, which turns one linear pass into a
    // quadratic one on a deep scene — the opposite of the fix.
    const renderer = fakeRenderer();
    const scene = group("scene", [group("props", [mesh("crate")]), mesh("floor")]);
    const report = await run(renderer, scene, { yieldFrame: () => Promise.resolve() });
    expect(report.compiled).toBe(2);
    expect(renderer.compiled.sort()).toEqual(["crate", "floor"]);
  });

  test("should report an empty scene as done rather than skipped", async () => {
    const renderer = fakeRenderer();
    const progress: IWarmUpProgress[] = [];
    const report = await run(renderer, group("scene", []), {
      onProgress: (entry: IWarmUpProgress) => progress.push(entry),
    });
    expect(report).toMatchObject({ compiled: 0, slices: 0, unsupported: false });
    expect(progress).toEqual([{ done: 0, total: 0 }]);
  });

  test("should report a renderer that cannot warm up, not silently skip it", async () => {
    // "The warm-up found nothing to do" and "this renderer has no compileAsync" produce the same
    // zero, and only one of them explains a launch that still stalls.
    const report = await run({}, sceneOf(5));
    expect(report.unsupported).toBe(true);
    expect(report.compiled).toBe(0);
  });

  test("should compile one representative per pipeline, not one per object", async () => {
    // The Pixel 8 scene had 835 renderables and 107 pipeline compiles. Warming every object would
    // make 835 calls to build 107 pipelines; the other 728 are cache lookups that only slow the
    // warm-up down.
    const renderer = fakeRenderer();
    const shared = {};
    const scene = group("scene", [
      { children: [], material: shared, name: "wall-a" },
      { children: [], material: shared, name: "wall-b" },
      { children: [], material: shared, name: "wall-c" },
      mesh("water"),
    ]);
    const report = await run(renderer, scene, { yieldFrame: () => Promise.resolve() });
    expect(report.compiled).toBe(2);
    expect(renderer.compiled).toEqual(["wall-a", "water"]);
  });

  test("should treat a skinned object sharing a material as its own pipeline", async () => {
    // Keying on the material alone would skip the skinned variant, which is a real pipeline and a
    // real compile — and it would reappear as a stall inside the first frame that drew a soldier.
    const renderer = fakeRenderer();
    const shared = {};
    const scene = group("scene", [
      { children: [], material: shared, name: "statue" },
      { children: [], material: shared, name: "soldier", isSkinnedMesh: true },
    ]);
    const report = await run(renderer, scene, { yieldFrame: () => Promise.resolve() });
    expect(report.compiled).toBe(2);
    expect(renderer.compiled).toEqual(["statue", "soldier"]);
  });

  test("should neither deadlock nor register a frame callback of its own", async () => {
    // Two regressions in one assertion, both of which happened.
    //
    // Awaiting requestAnimationFrame deadlocks: boot is what schedules frames, so a host whose
    // rAF only queues the callback -- the playtest harness drains it after start() resolves --
    // leaves the warm-up waiting for a frame that cannot run until it stops waiting. Two suite
    // tests hung for their full timeout.
    //
    // Racing rAF against a timer fixes the hang but registers a frame callback that is not the
    // loop's, reordering the frame sequence a harness observes. It turned a 16 ms frame into a
    // 32 ms one in the performance suite.
    const renderer = fakeRenderer();
    const queued: Array<() => void> = [];
    const previous = Reflect.get(globalThis, "requestAnimationFrame");
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: () => void) => queued.push(callback),
    });
    try {
      // No yieldFrame override: this must survive the real one.
      const report = await run(renderer, sceneOf(3), { sliceSize: 1 });
      expect(report.compiled).toBe(3);
      expect(queued).toEqual([]);
    } finally {
      if (previous === undefined) Reflect.deleteProperty(globalThis, "requestAnimationFrame");
      else Object.defineProperty(globalThis, "requestAnimationFrame", { value: previous });
    }
  }, 10_000);

  test("should abandon a compile that never resolves instead of hanging the launch", async () => {
    // This is the bug the bounded version exists for, and it shipped once. On a Pixel 8 a
    // compileAsync never came back, so boot awaited it forever: the loop stayed held, the
    // simulation never advanced (substeps mean 0 across 300 frames) and the game sat on its
    // loading screen with no error logged anywhere. A slow launch is a disappointment; a launch
    // that never finishes is a bug.
    const compiled: string[] = [];
    const renderer = {
      compileAsync: (object: unknown) => {
        const name = (object as IFakeObject).name;
        compiled.push(name);
        // The second pipeline hangs. Everything after it must still be warmed.
        return name === "mesh-1" ? new Promise<void>(() => undefined) : Promise.resolve();
      },
    };
    const report = await run(renderer, sceneOf(3), {
      compileTimeoutMs: 20,
      yieldFrame: () => Promise.resolve(),
    });
    expect(compiled).toEqual(["mesh-0", "mesh-1", "mesh-2"]);
    expect(report.compiled).toBe(2);
    expect(report.abandoned).toBe(1);
    expect(report.timedOut).toBe(false);
  }, 10_000);

  test("should stop at its budget rather than make the launch worse", async () => {
    const renderer = {
      compileAsync: () => new Promise<void>((resolve) => setTimeout(resolve, 15)),
    };
    const report = await run(renderer, sceneOf(50), {
      budgetMs: 60,
      compileTimeoutMs: 1000,
      yieldFrame: () => Promise.resolve(),
    });
    expect(report.timedOut).toBe(true);
    expect(report.abandoned).toBeGreaterThan(0);
    expect(report.compiled + report.abandoned).toBe(50);
  }, 10_000);

  test("should treat a rejected compile as a pipeline it could not build, not a failure", async () => {
    // The frame that needs the pipeline will try again and fail there, where the error belongs.
    const renderer = {
      compileAsync: (object: unknown) =>
        (object as IFakeObject).name === "mesh-0"
          ? Promise.reject(new Error("backend said no"))
          : Promise.resolve(),
    };
    const report = await run(renderer, sceneOf(2), { yieldFrame: () => Promise.resolve() });
    expect(report.compiled).toBe(1);
    expect(report.abandoned).toBe(1);
  });

  test("should fail closed on a timeout that cannot bound anything", async () => {
    const renderer = fakeRenderer();
    for (const options of [{ compileTimeoutMs: 0 }, { budgetMs: -1 }, { budgetMs: Number.NaN }]) {
      await expect(run(renderer, sceneOf(2), options)).rejects.toThrow(
        /TN_WARMUP_TIMEOUT_INVALID/u,
      );
    }
  });

  test("should fail closed on a slice size that cannot terminate", async () => {
    const renderer = fakeRenderer();
    for (const sliceSize of [0, -1, 2.5]) {
      await expect(run(renderer, sceneOf(4), { sliceSize })).rejects.toThrow(
        /TN_WARMUP_SLICE_INVALID/u,
      );
    }
  });

  test("should compile the whole scene in one call by default", async () => {
    // Measured on a Pixel 8: one whole-scene call builds all 107 of this game's pipelines in
    // 8.1 s, while the per-object walk managed 6 in 15 s before its budget ran out. The default
    // may not be the mechanism that turns an 8-second launch into a 15-second one.
    const calls: unknown[] = [];
    const renderer = {
      compileAsync: (object: unknown) => {
        calls.push(object);
        return Promise.resolve();
      },
    };
    const scene = sceneOf(200);
    const report = await warmUpScene(renderer as never, scene as never, {} as never);
    expect(calls).toEqual([scene]);
    expect(report).toMatchObject({ compiled: 1, slices: 1, abandoned: 0, timedOut: false });
  });

  test("should abandon a whole-scene compile that never returns", async () => {
    const renderer = { compileAsync: () => new Promise<void>(() => undefined) };
    const report = await warmUpScene(renderer as never, sceneOf(2) as never, {} as never, {
      budgetMs: 30,
    });
    expect(report).toMatchObject({ compiled: 0, abandoned: 1, timedOut: true });
  }, 10_000);
});
