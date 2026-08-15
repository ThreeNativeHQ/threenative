import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="text-[10px] uppercase tracking-[0.16em] text-dim">{label}</span>
      <b className={`font-normal tabular-nums ${tone ?? "text-text"}`}>{value}</b>
    </div>
  );
}

export function Hud({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  const bodyCount = useGameState(game, (state) => state.bodyCount);
  const settled = useGameState(game, (state) => state.settled);
  const pushed = useGameState(game, (state) => state.pushed);
  const contacts = useGameState(game, (state) => state.contacts);
  const phaseThroughs = useGameState(game, (state) => state.phaseThroughs);
  const goalReached = useGameState(game, (state) => state.goalReached);
  const goalBy = useGameState(game, (state) => state.goalBy);
  const replayPhase = useGameState(game, (state) => state.replayPhase);
  const replayMatch = useGameState(game, (state) => state.replayMatch);

  return (
    <>
      <div className="pointer-events-none absolute left-6 top-6 w-64 border border-line bg-panel/80 p-4 backdrop-blur-sm">
        <div className="text-[10px] uppercase tracking-[0.16em] text-dim">vault of crates</div>
        <div className="mt-1 text-3xl leading-none tabular-nums text-lume">
          {settled}/{bodyCount}
        </div>
        <div className="text-[10px] uppercase tracking-[0.16em] text-dim">bodies at rest</div>
        <div className="mt-3 space-y-1 text-sm">
          <Row label="pushed" value={String(pushed)} />
          <Row label="contacts" value={String(contacts)} />
          <Row label="phased" value={String(phaseThroughs)} />
          <Row
            label="goal"
            value={goalReached ? `lit by ${goalBy}` : "dark"}
            tone={goalReached ? "text-lume" : "text-text"}
          />
          <Row
            label="replay"
            value={replayPhase === "idle" ? "press V" : `${replayPhase} · ${replayMatch}`}
            tone={replayMatch === "match" ? "text-lume" : "text-text"}
          />
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-6 left-6 text-[11px] uppercase tracking-[0.16em] text-dim">
        wasd move · space hop · v verify determinism · r restart
      </div>
      {goalReached ? (
        <div className="pointer-events-none absolute inset-x-0 top-24 text-center text-4xl uppercase tracking-[0.3em] text-lume">
          goal lit
        </div>
      ) : null}
    </>
  );
}
