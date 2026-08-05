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
    <footer className="pointer-events-none absolute bottom-0 left-0 right-0 flex items-end justify-between p-6">
      <div className="controls-card"><span><b>WASD</b> MOVE</span><span><b>POINTER</b> AIM</span><span><b>SPACE / CLICK</b> FIRE</span></div>
      <button className="pause-button pointer-events-auto" aria-pressed={paused} onClick={togglePause} onKeyDown={handleKeyDown} type="button">
        {paused ? "RESUME" : "PAUSE"}
      </button>
    </footer>
  );
}
