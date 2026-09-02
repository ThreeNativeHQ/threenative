import { describe, expect, it } from "vitest";
import { defineGame } from "../src/game.js";
import type { ICtx, IStartupTimeline } from "../src/scene.js";
import { Scene } from "../src/scene.js";

/**
 * The startup timeline is what a playtest asserts startup time against, so it must be stamped by
 * the runtime in order: load started, entered, and only then the readiness milestones.
 */
describe("startup timeline", () => {
  it("should stamp load, enter and readiness in order and publish them through ctx.startup", async () => {
    const canvas = new EventTarget() as EventTarget & Partial<HTMLCanvasElement>;
    Object.defineProperties(canvas, {
      clientHeight: { configurable: true, value: 90 },
      clientWidth: { configurable: true, value: 160 },
      parentElement: { configurable: true, value: null },
    });
    let seenAtEnter: IStartupTimeline | undefined;
    let seenAtLoad: IStartupTimeline | undefined;
    let capturedCtx: ICtx | undefined;
    class Timed extends Scene {
      static override readonly initialState = {};
      override load(ctx: ICtx): void {
        seenAtLoad = ctx.startup.timeline;
      }
      override enter(ctx: ICtx): undefined {
        capturedCtx = ctx;
        seenAtEnter = ctx.startup.timeline;
        return undefined;
      }
    }
    let frame: ((time: number) => void) | undefined;
    const game = defineGame({
      renderer: {
        canvas: canvas as never,
        preferWebGPU: false,
        webgl2Factory: () =>
          ({ domElement: canvas, render: () => undefined, setSize: () => undefined }) as never,
      },
      scenes: { timed: Timed },
      start: "timed",
    });
    const requestFrame = globalThis.requestAnimationFrame;
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      value: (callback: (time: number) => void) => {
        frame = callback;
        return 1;
      },
    });
    try {
      await game.start();
      // Progress is honest and monotonic: entered is 0.8, compile settled 0.9, ready 1.
      expect(capturedCtx?.startup.progress).toBeGreaterThanOrEqual(0.8);
      expect(seenAtLoad?.loadStartedMs).toBeTypeOf("number");
      expect(seenAtLoad?.enteredMs).toBeUndefined();
      expect(seenAtEnter?.enteredMs).toBeUndefined();
      const afterEnter = capturedCtx?.startup.timeline;
      expect(afterEnter?.enteredMs).toBeTypeOf("number");
      expect(afterEnter?.enteredMs ?? 0).toBeGreaterThanOrEqual(
        afterEnter?.loadStartedMs ?? Number.POSITIVE_INFINITY,
      );
      // Readiness follows a sustained in-budget frame window; pump frames until it resolves.
      if (frame === undefined) throw new Error("Game did not start its loop.");
      for (
        let index = 1;
        index <= 12 && capturedCtx?.startup.timeline.readyMs === undefined;
        index += 1
      ) {
        frame(index * 16.7);
        await Promise.resolve();
      }
      await capturedCtx?.startup.whenReady();
      const ready = capturedCtx?.startup.timeline;
      expect(capturedCtx?.startup.progress).toBe(1);
      expect(ready?.compileSettledMs).toBeTypeOf("number");
      expect(ready?.readyMs).toBeTypeOf("number");
      expect(ready?.readyMs ?? 0).toBeGreaterThanOrEqual(
        ready?.enteredMs ?? Number.POSITIVE_INFINITY,
      );
      // The timeline handed out is a copy: a game cannot rewrite the runtime's record.
      (ready as { readyMs?: number }).readyMs = -1;
      expect(capturedCtx?.startup.timeline.readyMs).not.toBe(-1);
    } finally {
      await game.stop();
      Object.defineProperty(globalThis, "requestAnimationFrame", {
        configurable: true,
        value: requestFrame,
      });
    }
  });
});
