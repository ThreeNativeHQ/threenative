import { Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { describe, expect, it } from "vitest";
import { defineGame } from "../src/game.js";
import { Scene } from "../src/scene.js";

/**
 * A canvas that sits at page offset (100, 50): pointer events carry window-relative
 * clientX/clientY, while the picker's NDC math assumes canvas-origin coordinates.
 */
function offsetCanvas(): EventTarget & Partial<HTMLCanvasElement> {
  const canvas = new EventTarget() as EventTarget & Partial<HTMLCanvasElement>;
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, value: 180 },
    clientWidth: { configurable: true, value: 320 },
    parentElement: { configurable: true, value: null },
  });
  Object.defineProperty(canvas, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({
        bottom: 230,
        height: 180,
        left: 100,
        right: 420,
        top: 50,
        toJSON: () => ({}),
        width: 320,
        x: 100,
        y: 50,
      }) as DOMRect,
  });
  return canvas;
}

describe("default picking feed", () => {
  it("picks relative to the canvas, not the page", async () => {
    const canvas = offsetCanvas();
    let navigation: Promise<void> | undefined;
    let advance: ((ticks: number) => number) | undefined;

    class Boot extends Scene {
      static override readonly initialState = {};

      override enter(ctx: Parameters<Scene["enter"]>[0]): void {
        navigation = ctx.goto("play");
      }
    }

    class Play extends Scene {
      static override readonly initialState = {};

      override enter(ctx: Parameters<Scene["enter"]>[0]): void {
        // A wall filling every direction: whichever way the ray goes, it lands here, so the
        // hit point's sign carries the whole assertion.
        const wall = new Mesh(new PlaneGeometry(4_000, 4_000), new MeshBasicMaterial());
        wall.position.set(0, 0, -20);
        ctx.add(wall);
        // Quarter of the way across the canvas in page coordinates: clientX 180 minus the
        // 100px offset is 80 canvas pixels, which is NDC x = -0.5 — the left half.
        const move = new Event("pointermove");
        Object.defineProperty(move, "clientX", { value: 180 });
        Object.defineProperty(move, "clientY", { value: 140 });
        canvas.dispatchEvent(move);
      }
    }

    const game = defineGame({
      initialState: {},
      inputTarget: canvas as HTMLCanvasElement,
      plugins: [
        {
          setup: (_ctx, runtime) => {
            advance = runtime?.fixedStep;
            return undefined;
          },
        },
      ],
      renderer: {
        canvas: canvas as HTMLCanvasElement,
        preferWebGPU: false,
        webgl2Factory: () => ({
          dispose: () => undefined,
          domElement: canvas as HTMLCanvasElement,
          render: () => undefined,
          setSize: () => undefined,
        }),
      },
      scenes: { boot: Boot, play: Play },
      start: "boot",
    });
    await game.start();
    await navigation;
    if (advance === undefined) throw new Error("no fixed step");
    advance(1);

    const ctx = game.ctx;
    if (ctx === undefined) throw new Error("the game did not start");
    // The feed really saw the window-relative event.
    expect(ctx.input.raw.pointer.position.x).toBe(180);

    // Ignoring the page offset reads clientX 180 against a 320-wide canvas: NDC +0.125,
    // the right half. Canvas-relative it is 80: NDC -0.5, the left half.
    const hit = ctx.raycast();
    expect(hit).toBeDefined();
    expect(hit?.point.x ?? 0).toBeLessThan(0);
    game.stop();
  });
});
