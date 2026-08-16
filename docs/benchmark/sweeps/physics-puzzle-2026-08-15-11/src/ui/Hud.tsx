import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

function Row({ label, value, tone = "text-text" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-[9px] uppercase tracking-[0.16em] text-dim sm:text-[10px]">{label}</span>
      <b className={`font-normal tabular-nums text-xs sm:text-sm ${tone}`}>{value}</b>
    </div>
  );
}

const DETERMINISM_TONE: Record<string, string> = {
  match: "text-lume",
  mismatch: "text-red-400",
  pending: "text-warn",
};

export function Hud({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  const state = useGameState(game, (value) => value);
  const determinism =
    state.determinism === "pending" ? "baseline" : state.determinism.toUpperCase();

  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 w-[13.5rem] border border-line bg-panel/80 px-3 py-2 backdrop-blur-sm sm:left-5 sm:top-5 sm:w-60">
        <div className="text-[10px] uppercase tracking-[0.22em] text-lume sm:text-xs">cratefall</div>
        <div className="mt-2 space-y-1">
          <Row label="settled" value={`${state.settled} / ${state.bodies}`} />
          <Row label="push contacts" value={String(state.contacts)} />
          <Row label="ghost passes" value={String(state.passthroughs)} tone="text-lume" />
          <Row label="walked" value={`${state.distance.toFixed(1)} m`} />
          <Row
            label="goal"
            value={state.goal ? `reached · ${state.goalBy}` : "open"}
            tone={state.goal ? "text-lume" : "text-text"}
          />
        </div>
        <div className="mt-2 border-t border-line pt-2">
          <Row
            label="replay"
            value={determinism}
            tone={DETERMINISM_TONE[state.determinism] ?? "text-text"}
          />
          <div className="mt-1 flex justify-between text-[9px] tabular-nums text-dim">
            <span>hash {state.settleHash || "…"}</span>
            <span>t{state.tick}</span>
          </div>
        </div>
      </div>

      {state.phase === "drop" ? (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 border border-line bg-panel/80 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-warn sm:top-6 sm:text-xs">
          settling…
        </div>
      ) : null}

      {state.goal ? (
        <div className="pointer-events-none absolute left-1/2 top-1/2 w-[min(22rem,86vw)] -translate-x-1/2 -translate-y-1/2 border border-lume bg-panel/85 px-5 py-4 text-center">
          <div className="text-xl tracking-[0.3em] text-lume sm:text-2xl">VAULT LIT</div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-dim">
            {state.goalBy === "crate" ? "a pushed crate reached the pad" : "you reached the pad"} · R
            to restart
          </div>
        </div>
      ) : null}
    </>
  );
}
