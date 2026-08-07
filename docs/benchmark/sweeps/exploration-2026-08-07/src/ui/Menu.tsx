import type { Game } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { useState } from "react";
import type { GameState } from "../state.js";

export function Menu({ game }: { game: Game<GameState, PhysicsContext> }) {
  const [paused, setPaused] = useState(false);
  const togglePause = () => {
    if (paused) game.resume();
    else game.pause();
    setPaused((value) => !value);
  };

  return (
    <div className="control-bar pointer-events-none">
      <div className="control-copy">
        <span className="control-led" />
        <span>WASD / arrows move</span>
        <i />
        <span>E inspect</span>
        <i />
        <span>Space jump</span>
      </div>
      <button
        className="pause-button pointer-events-auto"
        aria-pressed={paused}
        onClick={togglePause}
        type="button"
      >
        <span>{paused ? "▶" : "Ⅱ"}</span> {paused ? "resume" : "pause"}
      </button>
    </div>
  );
}
