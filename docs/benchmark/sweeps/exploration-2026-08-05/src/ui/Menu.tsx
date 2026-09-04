import type { Game } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { type KeyboardEvent, useState } from "react";
import type { GameState } from "../state.js";

export function Menu({ game }: { game: Game<GameState, PhysicsContext> }) {
  const [paused, setPaused] = useState(false);
  const togglePause = () => {
    if (paused) game.resume();
    else game.pause();
    setPaused((value) => !value);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    togglePause();
  };

  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3 border border-line bg-panel/85 px-4 py-3 text-[10px] uppercase tracking-[0.14em] text-dim sm:bottom-6" data-testid="controls-panel">
      <span>WASD / arrows move · E inspect · Space jump</span>
      <button
        className="pointer-events-auto border border-line px-2 py-1 text-text hover:border-lume"
        aria-pressed={paused}
        onClick={togglePause}
        onKeyDown={handleKeyDown}
        type="button"
      >
        {paused ? "resume" : "pause"}
      </button>
    </div>
  );
}
