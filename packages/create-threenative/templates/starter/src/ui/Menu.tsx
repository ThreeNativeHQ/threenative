import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { type KeyboardEvent, useState } from "react";
import type { GameState } from "../state.js";

export function Menu({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  const [paused, setPaused] = useState(false);
  const togglePause = () => {
    if (paused) game.resume();
    else game.pause();
    setPaused((value) => !value);
  };
  const restart = () => {
    void game.goto("play");
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    togglePause();
  };

  return (
    <div className="pointer-events-none absolute bottom-6 left-6 flex items-center gap-3 border border-line bg-panel/75 px-4 py-3 text-[11px] uppercase tracking-[0.14em] text-dim">
      <span>WASD / arrows to move · collect the pickup</span>
      <button
        className="pointer-events-auto border border-line px-2 py-1 text-text hover:border-lume"
        aria-pressed={paused}
        onClick={togglePause}
        onKeyDown={handleKeyDown}
        type="button"
      >
        {paused ? "resume" : "pause"}
      </button>
      <button
        className="pointer-events-auto border border-line px-2 py-1 text-text hover:border-lume"
        onClick={restart}
        type="button"
      >
        restart
      </button>
    </div>
  );
}
