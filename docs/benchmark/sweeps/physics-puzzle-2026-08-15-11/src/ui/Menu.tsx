import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { useState } from "react";
import type { GameState } from "../state.js";

/** The hint bar. It wraps rather than overlaps when the window narrows. */
export function Menu({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  const [paused, setPaused] = useState(false);
  const togglePause = () => {
    if (paused) game.resume();
    else game.pause();
    setPaused((value) => !value);
  };

  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 flex max-w-[94vw] -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1 border border-line bg-panel/80 px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-dim sm:bottom-5 sm:text-[11px]">
      <span>WASD</span>
      <span className="text-text">push a crate onto the pad</span>
      <span>
        <i className="not-italic text-lume">cyan</i> = walk-through
      </span>
      <button
        className="pointer-events-auto border border-line px-2 py-[2px] text-text hover:border-lume"
        aria-pressed={paused}
        onClick={togglePause}
        type="button"
      >
        {paused ? "resume" : "pause"}
      </button>
      <button
        className="pointer-events-auto border border-line px-2 py-[2px] text-text hover:border-lume"
        onClick={() => void game.goto("play")}
        type="button"
      >
        restart (R)
      </button>
    </div>
  );
}
