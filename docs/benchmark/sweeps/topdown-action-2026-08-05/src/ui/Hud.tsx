import type { Game } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
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

export function Hud({ game }: { game: Game<GameState, PhysicsContext> }) {
  const enemiesRemaining = useGameState(game, (state) => state.enemiesRemaining);
  const hits = useGameState(game, (state) => state.hits);
  const objective = useGameState(game, (state) => state.objective);
  const score = useGameState(game, (state) => state.score);
  const reload = useGameState(game, (state) => state.reload);
  const shots = useGameState(game, (state) => state.shots);
  return (
    <div className="pointer-events-none absolute inset-0 p-6">
      <div className="text-[10px] uppercase tracking-[0.14em] text-dim">objective</div>
      <div className="text-lg uppercase tracking-[0.08em] text-lume">{objective}</div>
      <div className="mt-5 grid grid-cols-3 gap-5 text-[10px] uppercase tracking-[0.14em] text-dim">
        <div>
          score <b className="block text-2xl font-normal tabular-nums text-text">{score}</b>
        </div>
        <div>
          targets{" "}
          <b className="block text-2xl font-normal tabular-nums text-warn">{enemiesRemaining}</b>
        </div>
        <div>
          hits / shots{" "}
          <b className="block text-2xl font-normal tabular-nums text-text">
            {hits} / {shots}
          </b>
        </div>
      </div>
      <Meter label="reload" value={(1 - reload / 0.3) * 100} />
    </div>
  );
}
