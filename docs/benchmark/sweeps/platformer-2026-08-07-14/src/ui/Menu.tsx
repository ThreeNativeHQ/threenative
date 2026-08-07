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
    <div className="control-dock">
      <span className="control-key">WASD</span>
      <span>move</span>
      <span className="control-divider">·</span>
      <span className="control-key">SPACE</span>
      <span>jump</span>
      <span className="control-divider">·</span>
      <span className="control-key">R</span>
      <span>restart</span>
      <button
        className="pause-button"
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
