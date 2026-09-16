import { Texture } from "three";
import { describe, expect, it } from "vitest";
import { defineGame } from "../src/game.js";
import type { ICtx } from "../src/scene.js";
import { Scene } from "../src/scene.js";

/**
 * PRD-375 acceptance: loading progress must be measured, not fabricated.
 *
 * `ctx.startup.progress` is documented as "0 to 1, monotonic and honest" and the implementation
 * comment repeats it. Two properties make that claim real, and a loading bar that breaks either
 * one is lying to the player:
 *
 * 1. it never goes backwards, and
 * 2. it moves only when load state moves — a value that advances while nothing settles is a
 *    wall-clock timer wearing a progress bar's clothes, which is the exact shape this phase exists
 *    to reject.
 */

/** The property under test, applied to a sampled sequence. */
function firstRegression(samples: readonly number[]): string | undefined {
  let previous = samples[0] ?? 0;
  for (let index = 1; index < samples.length; index += 1) {
    const value = samples[index] ?? 0;
    if (value < previous) return `sample ${index} fell from ${previous} to ${value}`;
    previous = value;
  }
  return undefined;
}

/**
 * The renderer and canvas stubs every core spec here uses. The scene class is deliberately NOT
 * routed through this helper: passing it as a generic parameter needs a cast, and a cast would
 * stop the spec type-checking the very scene whose behaviour it exists to check.
 */
function stubRenderer(): { canvas: never; preferWebGPU: false; webgl2Factory: () => never } {
  const canvas = new EventTarget() as EventTarget & Partial<HTMLCanvasElement>;
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, value: 90 },
    clientWidth: { configurable: true, value: 160 },
    parentElement: { configurable: true, value: null },
  });
  return {
    canvas: canvas as never,
    preferWebGPU: false,
    webgl2Factory: () =>
      ({ domElement: canvas, render: () => undefined, setSize: () => undefined }) as never,
  };
}

const stubAssets = { texture: () => Promise.resolve(new Texture()) };

describe("startup progress honesty", () => {
  it("should never go backwards when more assets are requested during load", async () => {
    const samples: number[] = [];
    class Probe extends Scene {
      static override readonly initialState = {};
      override async load(ctx: ICtx): Promise<void> {
        samples.push(ctx.startup.progress);
        const first = ctx.assets.texture("first.png");
        samples.push(ctx.startup.progress);
        await first;
        samples.push(ctx.startup.progress);
        // A game that streams a second tier, or any framework load that resolves a dependency
        // mid-startup, grows the denominator after the first one settled.
        const second = ctx.assets.texture("second.png");
        samples.push(ctx.startup.progress);
        await second;
        samples.push(ctx.startup.progress);
      }
    }
    const game = defineGame({
      assets: stubAssets,
      renderer: stubRenderer(),
      scenes: { probe: Probe },
      start: "probe",
    });
    await game.start();
    expect(samples.length).toBeGreaterThanOrEqual(5);
    expect(firstRegression(samples)).toBeUndefined();
  });

  it("should not move while nothing settles, so a wall-clock ramp cannot pass as progress", async () => {
    const held: number[] = [];
    class Probe extends Scene {
      static override readonly initialState = {};
      override async load(ctx: ICtx): Promise<void> {
        await ctx.assets.texture("only.png");
        // Load state is now frozen. Real progress is a function of that state and must be
        // identical across these samples; a timer-backed value would climb.
        for (let tick = 0; tick < 4; tick += 1) {
          held.push(ctx.startup.progress);
          await new Promise((resolve) => setTimeout(resolve, 12));
        }
      }
    }
    const game = defineGame({
      assets: stubAssets,
      renderer: stubRenderer(),
      scenes: { probe: Probe },
      start: "probe",
    });
    await game.start();
    expect(held.length).toBe(4);
    expect(new Set(held).size).toBe(1);
  });

  it("should reject a fabricated source, proving the assertion can tell the difference", () => {
    // The negative control on the assertion itself. A hardcoded ramp is monotonic, so
    // monotonicity alone cannot catch fabrication — it is the "does not move while nothing
    // settles" property above that does, and this is what that property looks like when violated.
    const wallClockRamp = [0, 0.25, 0.5, 0.75].map((value) => value);
    expect(new Set(wallClockRamp).size).not.toBe(1);
    // A source that regresses is caught by the monotonicity property.
    expect(firstRegression([0.7, 0.35])).toMatch(/fell from 0\.7 to 0\.35/u);
  });
});
