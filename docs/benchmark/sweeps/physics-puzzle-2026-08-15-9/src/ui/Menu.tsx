import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { type KeyboardEvent, useState } from "react";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

const KEYS: readonly (readonly [string, string])[] = [
  ["← ↑ ↓ →", "walk and shove"],
  ["V", "run the determinism check"],
  ["R", "reset the vault"],
];

export function Menu({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  const [paused, setPaused] = useState(false);
  const phase = useGameState(game, (state) => state.replayPhase);
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
    <div className="pointer-events-none absolute bottom-6 left-6 flex items-end gap-4">
      <div className="border border-line bg-panel/80 px-4 py-3">
        <div className="text-[10px] uppercase tracking-[0.16em] text-dim">controls</div>
        <dl className="mt-2 space-y-1 text-[11px]">
          {KEYS.map(([key, what]) => (
            <div className="flex gap-3" key={key}>
              <dt className="w-20 text-text">{key}</dt>
              <dd className="text-dim">{what}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex gap-2 text-[11px] uppercase tracking-[0.16em]">
          <span className="text-warn">wood blocks</span>
          <span className="text-dim">·</span>
          <span className="text-lume">glow passes through</span>
        </div>
      </div>
      <button
        className="pointer-events-auto border border-line bg-panel/80 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-text hover:border-lume disabled:text-dim"
        aria-pressed={paused}
        disabled={phase === "run1" || phase === "run2"}
        onClick={togglePause}
        onKeyDown={handleKeyDown}
        type="button"
      >
        {paused ? "resume" : "pause"}
      </button>
    </div>
  );
}
