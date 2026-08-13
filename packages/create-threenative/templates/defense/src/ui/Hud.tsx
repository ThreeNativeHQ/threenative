import type { IGame } from "@threenative/core";
import { useGameState } from "@threenative/ui";
import type { DefensePhysics } from "../physics.js";
import type { GameState } from "../state.js";

export function Hud({ game }: { game: IGame<GameState, DefensePhysics> }) {
  const state = useGameState(game, (value) => value);
  const statusClass =
    state.status === "WON" ? "text-win" : state.status === "LOST" ? "text-danger" : "text-lume";
  return (
    <div className="pointer-events-none absolute inset-0 p-6 text-[11px] uppercase tracking-[0.16em] text-text">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] text-muted">route / north sector</div>
          <div className="mt-2 flex items-baseline gap-5 text-[18px] text-white">
            <span>
              wave <b id="wave">{state.wave}</b>/10
            </span>
            <span className={statusClass} id="status">
              {state.status}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-muted">leaks</div>
          <div className="mt-2 text-[22px] text-white" id="leaks">
            {state.leaks}/20
          </div>
        </div>
      </div>
      <div className="absolute bottom-6 left-6 flex items-end gap-8">
        <div>
          <div className="text-[10px] text-muted">credits</div>
          <div className="mt-1 text-[26px] leading-none text-white" id="balance">
            {Math.floor(state.balance)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted">towers</div>
          <div className="mt-1 text-[18px] leading-none text-white" id="towers">
            {state.towers}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted">income</div>
          <div className="mt-1 text-[18px] leading-none text-white" id="income">
            +{state.income.toFixed(1)}
          </div>
        </div>
      </div>
      {state.status !== "PLAYING" && (
        <div
          className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border px-8 py-5 text-center ${state.status === "WON" ? "border-win/70 bg-win/10" : "border-danger/70 bg-danger/10"}`}
        >
          <div className={`text-[28px] tracking-[0.28em] ${statusClass}`}>{state.status}</div>
          <div className="mt-2 text-[10px] text-muted">press R to restart</div>
        </div>
      )}
    </div>
  );
}
