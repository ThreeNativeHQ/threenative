import { describe, expect, it, vi } from "vitest";
import { createGameStore } from "../src/state.js";

describe("createGameStore", () => {
  it("should notify at most 11 times when set is called 600 times in one second", () => {
    vi.useFakeTimers();
    const store = createGameStore({ score: 0 });
    let notifications = 0;
    const unsubscribe = store.subscribe(() => notifications++);
    store.start();

    for (let score = 0; score < 600; score++) store.set({ score });
    vi.advanceTimersByTime(1_000);

    expect(notifications).toBeLessThanOrEqual(11);
    expect(store.getState().score).toBe(599);
    unsubscribe();
    store.stop();
    vi.useRealTimers();
  });

  it("should deliver the latest value, not an intermediate one", () => {
    const store = createGameStore({ score: 0 });
    const observed: number[] = [];
    const unsubscribe = store.subscribe((state) => observed.push(state.score));

    store.set({ score: 1 });
    store.set({ score: 599 });
    store.flush();

    expect(observed).toEqual([599]);
    unsubscribe();
    store.stop();
  });
});
