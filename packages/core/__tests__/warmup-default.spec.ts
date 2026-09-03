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

describe("the warmUp option", () => {
  it("does not run the pre-start warm-up when nothing is configured, on either platform", async () => {
    // The default is off and that is not the same as no warm-up: `startupCompile` runs the same
    // `warmUpScene` from inside the loading layer's readiness gate, where the opaque layer is on
    // screen and the loop is turning. This option only moves the work earlier, to before `start()`
    // releases the loop and while nothing is presenting.
    //
    // PRD-327 Phase 2 proposed flipping this on for native. Doing so removed the loading screen
    // (`verify-desktop-loading.mjs`: `loadingVisible: false` at every startup sample) and made the
    // scene compile twice, which pushed the desktop physics gate past its 180-frame budget. The
    // mechanism was what needed fixing, not the default.
    platform.native = true;
    expect(await bootAndCountCompiles()).toBe(0);
    platform.native = false;
    expect(await bootAndCountCompiles()).toBe(0);
  });

  it("runs the pre-start warm-up on an explicit opt-in, on either platform", async () => {
    platform.native = true;
    expect(await bootAndCountCompiles({ yieldFrame: () => Promise.resolve() })).toBeGreaterThan(0);
    platform.native = false;
    expect(await bootAndCountCompiles({ yieldFrame: () => Promise.resolve() })).toBeGreaterThan(0);
  });

  it("opts out of warm-up entirely on false", async () => {
    platform.native = true;
    expect(await bootAndCountCompiles(false)).toBe(0);
    platform.native = false;
    expect(await bootAndCountCompiles(false)).toBe(0);
  });
});
