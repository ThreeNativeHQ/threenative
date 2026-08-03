import { Scene, defineGame } from "@threenative/core";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { useGameState } from "../src/useGameState.js";

class TestScene extends Scene<{ hull: number; score: number }> {}

describe("useGameState", () => {
  it("should re-render at most 11 times per second under 600 store writes", () => {
    const game = defineGame({
      initialState: { hull: 100, score: 0 },
      scenes: { test: TestScene },
      start: "test",
    });
    let renders = 0;

    function Probe() {
      useGameState(game, (state) => state.score);
      renders += 1;
      return createElement("span");
    }

    act(() => {
      create(createElement(Probe));
    });
    act(() => {
      for (let score = 0; score < 600; score++) game.state.set({ score });
      game.state.flush();
    });

    expect(renders).toBe(2);
  });

  it("should not re-render when an unselected key changes", () => {
    const game = defineGame({
      initialState: { hull: 100, score: 0 },
      scenes: { test: TestScene },
      start: "test",
    });
    let renders = 0;

    function Probe() {
      useGameState(game, (state) => state.score);
      renders += 1;
      return createElement("span");
    }

    act(() => {
      create(createElement(Probe));
    });
    act(() => {
      game.state.set({ hull: 99 });
      game.state.flush();
    });

    expect(renders).toBe(1);
  });
});
