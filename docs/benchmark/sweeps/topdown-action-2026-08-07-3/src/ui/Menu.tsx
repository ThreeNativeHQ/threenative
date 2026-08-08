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
    <div className="pointer-events-none absolute bottom-5 left-1/2 flex w-[min(42rem,calc(100vw-2.5rem))] -translate-x-1/2 items-center justify-between gap-4 border border-line bg-panel/80 px-4 py-3 text-[10px] uppercase tracking-[0.14em] text-dim shadow-[0_12px_32px_rgba(4,8,13,0.22)] backdrop-blur-sm">
      <span>WASD / arrows move &nbsp;·&nbsp; pointer, Space, or F fires</span>
      <button
        className="pointer-events-auto border border-line px-2 py-1 text-text transition-colors hover:border-lume hover:text-lume active:scale-[0.98]"
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
