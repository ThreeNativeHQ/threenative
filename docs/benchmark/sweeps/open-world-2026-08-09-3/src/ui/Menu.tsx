import type { Game } from "@threenative/core";
import { type KeyboardEvent, useState } from "react";
import type { GameState } from "../state.js";

export function Menu({ game }: { game: Game<GameState> }) {
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
    <div className="pointer-events-none absolute bottom-7 right-7 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-mist">
      <button
        className="pointer-events-auto rounded-full border border-cream/30 bg-forest/55 px-3 py-2 text-cream backdrop-blur-sm hover:border-sun"
        aria-pressed={paused}
        onClick={togglePause}
        onKeyDown={handleKeyDown}
        type="button"
      >
        {paused ? "resume" : "pause"}
      </button>
      <button
        className="pointer-events-auto rounded-full border border-cream/30 bg-forest/55 px-3 py-2 text-cream backdrop-blur-sm hover:border-sun"
        onClick={restart}
        type="button"
      >
        restart
      </button>
    </div>
  );
}
