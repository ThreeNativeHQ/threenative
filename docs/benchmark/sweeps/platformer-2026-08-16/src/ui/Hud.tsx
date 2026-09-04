import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { ReactNode } from "react";
import type { GameState } from "../state.js";

/**
 * The HUD from the reference: a badge at top left with the coin tally, the
 * objective under it, run stats at top right, and button prompts along the
 * bottom. Everything is a rounded pill with a hard drop shadow so it stays
 * readable over a bright sky.
 */
const PILL =
  "flex items-center gap-2 rounded-full bg-slate-900/55 px-4 py-2 backdrop-blur-[2px] " +
  "shadow-[0_4px_0_rgba(0,0,0,0.28)] ring-2 ring-white/25";

function Coin({ size = 26 }: { size?: number }) {
  return (
    <span
      className="inline-grid place-items-center rounded-full bg-amber-400 ring-2 ring-amber-200"
      style={{ height: size, width: size }}
    >
      <span
        className="rounded-full bg-amber-200"
        style={{ height: size * 0.45, width: size * 0.45 }}
      />
    </span>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md bg-white/90 px-2 py-0.5 text-[11px] font-bold text-slate-800 shadow-[0_2px_0_rgba(0,0,0,0.3)]">
      {children}
    </kbd>
  );
}

export function Hud({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  const coins = useGameState(game, (state) => state.coins);
  const coinsTotal = useGameState(game, (state) => state.coinsTotal);
  const jumps = useGameState(game, (state) => state.jumps);
  const respawns = useGameState(game, (state) => state.respawns);
  const goalReached = useGameState(game, (state) => state.goalReached);
  const restart = () => {
    void game.goto("play");
  };

  return (
    <div className="pointer-events-none absolute inset-0 select-none font-sans text-white">
      {/* Top left: who you are, and what you have. */}
      <div className="absolute left-6 top-6 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-orange-400 text-3xl ring-4 ring-white/85 shadow-[0_5px_0_rgba(0,0,0,0.3)]">
            🦊
          </span>
          <div className={PILL}>
            <Coin />
            <span className="text-2xl font-black tabular-nums tracking-tight drop-shadow">
              {coins}
              <span className="text-base font-bold text-white/60"> / {coinsTotal}</span>
            </span>
          </div>
        </div>
        <div className="ml-1 max-w-xs rounded-2xl bg-slate-900/45 px-4 py-2 text-sm font-bold uppercase tracking-[0.12em] ring-2 ring-white/20">
          Objective · reach the flag
        </div>
      </div>

      {/* Top right: the run readout. */}
      <div className="absolute right-6 top-6 flex flex-col items-end gap-2">
        <div className={PILL}>
          <span className="text-lg">⭐</span>
          <span className="text-xl font-black tabular-nums">
            {goalReached ? "CLEARED" : "IN PLAY"}
          </span>
        </div>
        <div className={PILL}>
          <span className="text-sm font-bold uppercase tracking-widest text-white/70">jumps</span>
          <span className="text-xl font-black tabular-nums">{jumps}</span>
        </div>
        <div className={PILL}>
          <span className="text-sm font-bold uppercase tracking-widest text-white/70">falls</span>
          <span className="text-xl font-black tabular-nums">{respawns}</span>
        </div>
      </div>

      {/* Bottom: the controls, laid out like a console's button prompts. */}
      <div className="absolute bottom-6 left-6 flex items-center gap-3">
        <div className={PILL}>
          <Key>←</Key>
          <Key>→</Key>
          <span className="text-sm font-bold uppercase tracking-widest">run</span>
        </div>
        <div className={PILL}>
          <Key>R</Key>
          <span className="text-sm font-bold uppercase tracking-widest">restart</span>
        </div>
      </div>
      <div className="absolute bottom-6 right-6">
        <div className={PILL}>
          <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-400 text-xs font-black text-emerald-950">
            ␣
          </span>
          <span className="text-sm font-bold uppercase tracking-widest">jump</span>
        </div>
      </div>

      {goalReached ? (
        <div className="absolute inset-x-0 top-1/3 grid place-items-center">
          <div className="pointer-events-auto flex flex-col items-center gap-4 rounded-3xl bg-slate-900/70 px-12 py-8 ring-4 ring-amber-300/70 shadow-[0_10px_0_rgba(0,0,0,0.35)]">
            <div className="text-5xl font-black tracking-tight text-amber-300 drop-shadow">
              LEVEL CLEAR!
            </div>
            <div className="flex items-center gap-2 text-xl font-bold">
              <Coin size={22} />
              {coins} / {coinsTotal} coins · {jumps} jumps
            </div>
            <button
              className="rounded-full bg-amber-400 px-8 py-3 text-lg font-black uppercase tracking-widest text-amber-950 shadow-[0_5px_0_rgba(0,0,0,0.35)] hover:bg-amber-300"
              onClick={restart}
              type="button"
            >
              play again
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
