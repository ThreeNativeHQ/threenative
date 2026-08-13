import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

export function Hud({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  const state = useGameState(game, (value) => value);
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
