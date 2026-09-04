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
    <div className="pointer-events-none absolute bottom-5 left-5 right-5 flex items-center justify-between gap-4 text-[10px] uppercase tracking-[0.16em] text-white/55 sm:bottom-7 sm:left-7 sm:right-7">
      <div className="rounded-full border border-white/15 bg-[#10283b]/55 px-4 py-2 backdrop-blur-sm">
        <span className="text-white/85">← →</span> change lane&nbsp;&nbsp; <span className="text-white/85">Space</span> jump&nbsp;&nbsp; <span className="text-white/85">↓</span> slide
      </div>
      <button
        className="pointer-events-auto rounded-full border border-white/20 bg-[#10283b]/65 px-4 py-2 text-white/75 transition hover:border-amber-200/65 hover:text-amber-100 active:scale-[0.98]"
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
