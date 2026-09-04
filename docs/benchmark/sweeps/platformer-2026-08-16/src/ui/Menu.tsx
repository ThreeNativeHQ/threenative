import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { type KeyboardEvent, useState } from "react";
import type { GameState } from "../state.js";

/** One pause toggle, centred at the top like a console's start button. */
export function Menu({ game }: { game: IGame<GameState, IPhysicsContext> }) {
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
    <div className="pointer-events-none absolute inset-x-0 top-6 grid place-items-center">
      <button
        aria-pressed={paused}
        className="pointer-events-auto rounded-full bg-slate-900/55 px-5 py-2 text-sm font-bold uppercase tracking-widest text-white ring-2 ring-white/25 shadow-[0_4px_0_rgba(0,0,0,0.28)] hover:bg-slate-900/75"
        onClick={togglePause}
        onKeyDown={handleKeyDown}
        type="button"
      >
        {paused ? "resume" : "pause"}
      </button>
    </div>
  );
}
