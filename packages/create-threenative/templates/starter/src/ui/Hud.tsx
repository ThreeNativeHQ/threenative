import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

/**
 * A labelled readout and a meter, built from the palette in style.css. Copy the
 * pattern for hull, ammo, timers — whatever this game needs.
 */
function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="mt-3 w-24">
      <div className="flex justify-between gap-2 text-[10px] uppercase tracking-[0.14em] text-dim">
        <span>{label}</span>
        <b className="font-normal tabular-nums text-text">{Math.round(value)}</b>
      </div>
      <div className="relative mt-1 h-1 overflow-hidden border border-line bg-panel">
        <i
          className="absolute inset-y-0 left-0 bg-lume"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

export function Hud({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  const score = useGameState(game, (state) => state.score);
  const playerX = useGameState(game, (state) => state.playerX);
  return (
    <div className="pointer-events-none absolute left-6 top-6 w-32">
      <div className="text-[10px] uppercase tracking-[0.14em] text-dim">score</div>
      <div className="text-4xl leading-none tabular-nums text-lume">{score}</div>
      <Meter label="position" value={Math.abs(playerX) * 10} />
    </div>
  );
}
