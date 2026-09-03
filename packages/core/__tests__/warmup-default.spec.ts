import { Mesh, MeshBasicMaterial, SphereGeometry } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

// PRD-327 Phase 2. The `warmUp` default is resolved per platform, so the platform seam is what
// this spec drives. `getPlatform()` memoises its answer in a module-level snapshot with no reset
// hook, so the module is mocked rather than the environment poked.
const platform = vi.hoisted(() => ({ native: false }));
vi.mock("../src/platform.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/platform.js")>();
  return {
    ...actual,
    isNative: () => platform.native,
    getPlatform: () =>
      platform.native
        ? { ...actual.getPlatform(), runtime: "native" as const }
        : actual.getPlatform(),
  };
});

const { defineGame } = await import("../src/game.js");
const { Scene } = await import("../src/scene.js");
type ICtx = import("../src/scene.js").ICtx;

function testCanvas(): HTMLCanvasElement {
  const canvas = new EventTarget() as EventTarget & Partial<HTMLCanvasElement>;
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, value: 180 },
    clientWidth: { configurable: true, value: 320 },
    parentElement: { configurable: true, value: null },
  });
  return canvas as HTMLCanvasElement;
}

class WarmUpScene extends Scene {
  static override readonly initialState = {};

  override enter(ctx: ICtx): void {
    const geometry = new SphereGeometry(0.1, 3, 2);
    const material = new MeshBasicMaterial();
    for (let index = 0; index < 8; index += 1) ctx.add(new Mesh(geometry, material));
  }
}

/** Boots a game and reports whether the startup warm-up compiled anything. */
async function bootAndCountCompiles(warmUp?: false | Record<string, unknown>): Promise<number> {
  const canvas = testCanvas();
  const compileRoots: unknown[] = [];
  const game = defineGame({
    renderer: {
      canvas,
      preferWebGPU: false,
      webgl2Factory: () => ({
        compileAsync: vi.fn((scene: unknown) => {
          compileRoots.push(scene);
          return Promise.resolve();
        }),
        domElement: canvas,
        render: () => undefined,
        setSize: () => undefined,
      }),
    },
    scenes: { test: WarmUpScene },
    start: "test",
    ...(warmUp === undefined ? {} : { warmUp }),
  });
  try {
    await game.start();
    return compileRoots.length;
  } finally {
    game.stop();
  }
}

afterEach(() => {
  platform.native = false;
});

describe("the warmUp default", () => {
  it("warms up on native when nothing is configured", async () => {
    // The whole point of PRD-327. Until the host's `createRenderPipelineAsync` stopped being the
    // synchronous create wrapped in a resolved promise, turning this on bought nothing and spent
    // the budget waiting — `TN_WARMUP:{"compiled":0,"abandoned":1,"timedOut":true}` — while the
    // first frame compiled the same 105 pipelines in 8.0 s anyway.
    platform.native = true;
    expect(await bootAndCountCompiles()).toBeGreaterThan(0);
  });

  it("does not warm up on web when nothing is configured", async () => {
    // `compileAsync` has always resolved on web, and the default loading layer's own bounded
    // readiness gate already covers first-use work there. Flipping this would spend a budget to
    // buy something a game already has.
    platform.native = false;
    expect(await bootAndCountCompiles()).toBe(0);
  });

  it("honours an explicit opt-out on native", async () => {
    platform.native = true;
    expect(await bootAndCountCompiles(false)).toBe(0);
  });

  it("honours an explicit opt-in on web", async () => {
    platform.native = false;
    expect(await bootAndCountCompiles({ yieldFrame: () => Promise.resolve() })).toBeGreaterThan(0);
  });
});
