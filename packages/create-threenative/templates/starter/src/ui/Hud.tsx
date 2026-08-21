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

/**
 * The run's outcome. Nothing here is focusable on purpose: the pause and restart
 * buttons are the only tab stops in this game, and the committed scenarios reach
 * them by counting Tab presses.
 */
function Banner({ status }: { status: GameState["status"] }) {
  if (status === "playing") return null;
  const won = status === "won";
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/3 flex flex-col items-center gap-2">
      <output className={`text-5xl uppercase tracking-[0.2em] ${won ? "text-lume" : "text-text"}`}>
        {won ? "flag reached" : "out of lives"}
      </output>
      <div className="text-[11px] uppercase tracking-[0.14em] text-dim">
        press r to run it again
      </div>
    </div>
  );
}

export function Hud({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  const score = useGameState(game, (state) => state.score);
  const playerX = useGameState(game, (state) => state.playerX);
  const lives = useGameState(game, (state) => state.lives);
  const status = useGameState(game, (state) => state.status);
  return (
    <>
      <div className="pointer-events-none absolute left-6 top-6 w-32">
        <div className="text-[10px] uppercase tracking-[0.14em] text-dim">score</div>
        <div className="text-4xl leading-none tabular-nums text-lume">{score}</div>
        <div className="mt-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-dim">
          <span>lives</span>
          <span className="flex gap-1">
            {[0, 1, 2].map((slot) => (
              <i
                className={`h-2 w-2 border border-line ${slot < lives ? "bg-lume" : "bg-panel"}`}
                key={slot}
              />
            ))}
          </span>
        </div>
        <Meter label="position" value={Math.abs(playerX) * 10} />
      </div>
      <Banner status={status} />
    </>
  );
}
