import { useUiState } from "@threenative/ui";
import type { GameState } from "../state.js";

export function Hud() {
  const state = useUiState<GameState>();
  // Nothing to draw until the game publishes its first snapshot, a few milliseconds in.
  // Rendering zeroes instead would put wrong numbers on screen and then correct them.
  if (state === undefined) return null;
  return (
    <div className="pointer-events-none absolute inset-0 p-6 text-[11px] uppercase tracking-[0.14em] text-text">
      <div className="flex gap-5">
        <span>
          coins{" "}
          <b id="coins" className="text-lume">
            {state.coins}
          </b>
        </span>
        <span>
          hearts{" "}
          <b id="hearts" className="text-warn">
            {state.hearts}
          </b>
        </span>
        <span>
          checkpoint{" "}
          <b id="checkpoint" className="text-lume">
            {state.checkpoint}
          </b>
        </span>
        <span>
          term{" "}
          <b id="terminal" className="text-lume">
            {state.terminal}
          </b>
        </span>
      </div>
      <div className="mt-2 text-dim">
        jumps {state.jumps} · dashes {state.dashes} · defeated {state.defeated}
      </div>
    </div>
  );
}
