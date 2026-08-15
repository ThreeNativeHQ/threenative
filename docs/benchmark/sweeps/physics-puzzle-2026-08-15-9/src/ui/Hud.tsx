import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import { GOAL } from "../level/layout.js";
import { REPLAY_TICKS, replayActionLabel } from "../replay/check.js";
import type { GameState } from "../state.js";

type Game = IGame<GameState, IPhysicsContext>;

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="text-[10px] uppercase tracking-[0.16em] text-dim">{label}</span>
      <b className={`font-normal tabular-nums ${tone ?? "text-text"}`}>{value}</b>
    </div>
  );
}

function Bar({ value }: { value: number }) {
  return (
    <div className="relative mt-1 h-1 overflow-hidden border border-line bg-panel">
      <i
        className="absolute inset-y-0 left-0 bg-lume transition-[width] duration-150"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

function ReplayPanel({ game }: { game: Game }) {
  const phase = useGameState(game, (state) => state.replayPhase);
  const tick = useGameState(game, (state) => state.replayTick);
  const match = useGameState(game, (state) => state.replayMatch);
  const hashA = useGameState(game, (state) => state.replayHashA);
  const hashB = useGameState(game, (state) => state.replayHashB);
  const running = phase === "run1" || phase === "run2";

  return (
    <div className="pointer-events-none absolute right-6 top-6 w-60 border border-line bg-panel/80 p-4">
      <div className="text-[10px] uppercase tracking-[0.16em] text-dim">determinism check</div>
      <div className="mt-1 text-lg leading-none text-lume">
        {phase === "idle" ? "press V" : phase === "done" ? "complete" : `${phase} · ${tick}`}
      </div>
      {running ? (
        <>
          <Bar value={(tick / REPLAY_TICKS) * 100} />
          <div className="mt-2 text-[10px] uppercase tracking-[0.16em] text-dim">
            scripted input · {replayActionLabel(tick)}
          </div>
        </>
      ) : null}
      <div className="mt-3 space-y-1 text-xs">
        <Row label="run 1" value={hashA === "" ? "—" : hashA} />
        <Row label="run 2" value={hashB === "" ? "—" : hashB} />
        <Row
          label="final state"
          value={phase === "done" ? (match ? "matched" : "diverged") : "pending"}
          tone={phase === "done" ? (match ? "text-lume" : "text-warn") : "text-dim"}
        />
      </div>
    </div>
  );
}

export function Hud({ game }: { game: Game }) {
  const bodies = useGameState(game, (state) => state.bodies);
  const settled = useGameState(game, (state) => state.settled);
  const pushes = useGameState(game, (state) => state.pushes);
  const phantom = useGameState(game, (state) => state.phantomOverlaps);
  const phantomPasses = useGameState(game, (state) => state.phantomPasses);
  const solved = useGameState(game, (state) => state.solved);
  const solvedBy = useGameState(game, (state) => state.solvedBy);
  const seed = useGameState(game, (state) => state.seed);
  const playerX = useGameState(game, (state) => state.playerX);
  const playerZ = useGameState(game, (state) => state.playerZ);
  const range = Math.hypot(playerX - GOAL.x, playerZ - GOAL.z);

  return (
    <>
      <div className="pointer-events-none absolute left-6 top-6 w-60 border border-line bg-panel/80 p-4">
        <div className="text-[10px] uppercase tracking-[0.16em] text-dim">vault {seed}</div>
        <div className={`text-3xl leading-none ${solved ? "text-lume" : "text-text"}`}>
          {solved ? "delivered" : "in progress"}
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-dim">
          {solved ? `by ${solvedBy}` : "put yourself or a crate on the pad"}
        </div>
        <div className="mt-4 space-y-1 text-xs">
          <Row label="dynamic bodies" value={`${bodies}`} />
          <Row label="at rest" value={`${settled} / ${bodies}`} />
          <Row label="crates shoved" value={`${pushes}`} />
          <Row
            label="inside phantom"
            value={phantom > 0 ? "yes" : "no"}
            tone={phantom > 0 ? "text-lume" : "text-text"}
          />
          <Row label="phantom passes" value={`${phantomPasses}`} />
          <Row label="range to pad" value={`${range.toFixed(1)} m`} tone="text-dim" />
        </div>
        <Bar value={(settled / Math.max(1, bodies)) * 100} />
      </div>
      <ReplayPanel game={game} />
    </>
  );
}
