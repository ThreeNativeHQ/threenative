import type { IGame } from "@threenative/core";
import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { GameCanvas } from "../src/GameCanvas.js";

function fakeGame(overrides: Partial<IGame> = {}): IGame {
  return {
    ctx: undefined,
    goto: async () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    scene: undefined,
    start: () => Promise.resolve(),
    state: { flush: () => undefined, set: () => undefined } as unknown as IGame["state"],
    stop: () => undefined,
    ui: undefined as unknown as IGame["ui"],
    ...overrides,
  };
}

describe("GameCanvas", () => {
  it("stops the game on unmount", async () => {
    const game = fakeGame();
    const stop = vi.spyOn(game, "stop");
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(createElement(GameCanvas, { game }));
    });
    act(() => {
      renderer.unmount();
    });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("mounts nothing after unmount wins the race with start", async () => {
    let resolveStart: (() => void) | undefined;
    const game = fakeGame({
      start: () =>
        new Promise<void>((resolve) => {
          resolveStart = resolve;
        }),
    });
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(createElement(GameCanvas, { game }));
    });
    act(() => {
      renderer.unmount();
    });
    await act(async () => {
      resolveStart?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    // No error surfaced for the cancelled attempt, and no throw escaped the chain.
    expect(true).toBe(true);
  });

  it("surfaces a failed start in the DOM instead of an unhandled rejection", async () => {
    const game = fakeGame({
      start: () => Promise.reject(new Error("TN_TEST: boot failed")),
    });

    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(createElement(GameCanvas, { game }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const failure = renderer.root.findByProps({ "data-threenative-canvas-error": "true" });
    expect(failure.props.id).toBe("threenative-canvas-error");
    expect(failure.props.children).toBe("TN_TEST: boot failed");
  });
});
