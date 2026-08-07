import type { Game } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

function Meter({
  label,
  value,
  tone = "lume",
}: {
  label: string;
  value: number;
  tone?: "lume" | "warn" | "danger";
}) {
  const fillClass = tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-warn" : "bg-lume";
  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between gap-4 text-[10px] uppercase tracking-[0.18em] text-dim">
        <span>{label}</span>
        <span className="tabular-nums text-text">{Math.round(value)}</span>
      </div>
      <div className="relative mt-1 h-1.5 overflow-hidden bg-ink/70 ring-1 ring-line">
        <i
          className={`absolute inset-y-0 left-0 ${fillClass} transition-[width] duration-300 ease-out`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

export function Hud({ game }: { game: Game<GameState, PhysicsContext> }) {
  const score = useGameState(game, (state) => state.score);
  const health = useGameState(game, (state) => state.health);
  const maxHealth = useGameState(game, (state) => state.maxHealth);
  const reload = useGameState(game, (state) => state.reload);
  const enemiesRemaining = useGameState(game, (state) => state.enemiesRemaining);
  const collected = useGameState(game, (state) => state.collected);
  const shots = useGameState(game, (state) => state.shots);
  const objective = useGameState(game, (state) => state.objective);
  const gameStatus = useGameState(game, (state) => state.gameStatus);

  return (
    <div className="pointer-events-none absolute inset-0 select-none text-text">
      <section className="absolute left-5 top-5 w-[min(19rem,calc(100vw-2.5rem))] border-l-2 border-l-lume bg-panel/80 px-4 py-3 shadow-[0_12px_32px_rgba(4,8,13,0.25)] backdrop-blur-sm">
        <div className="flex items-start justify-between gap-5">
          <div>
            <div className="text-[10px] uppercase tracking-[0.24em] text-dim">SENTINEL / 03</div>
            <div className="mt-1 text-3xl font-semibold leading-none tracking-[-0.08em] text-lume tabular-nums">
              {String(score).padStart(4, "0")}
            </div>
          </div>
          <div className="text-right text-[10px] uppercase tracking-[0.16em] text-dim">
            <div className="text-text">combat readout</div>
            <div className="mt-1 text-warn">{gameStatus === "clear" ? "clear" : "live"}</div>
          </div>
        </div>
        <Meter label="integrity" value={(health / Math.max(1, maxHealth)) * 100} tone="danger" />
        <Meter label="weapon charge" value={(1 - reload) * 100} tone="warn" />
      </section>

      <section className="absolute right-5 top-5 w-[11rem] border border-line bg-panel/75 px-4 py-3 shadow-[0_12px_32px_rgba(4,8,13,0.22)] backdrop-blur-sm">
        <div className="text-[10px] uppercase tracking-[0.2em] text-dim">targets</div>
        <div className="mt-1 flex items-end justify-between">
          <div className="text-3xl font-semibold leading-none tracking-[-0.08em] text-danger tabular-nums">
            {enemiesRemaining}
          </div>
          <div className="pb-0.5 text-right text-[10px] uppercase tracking-[0.14em] text-dim">
            <div>cells {collected}/3</div>
            <div>shots {shots}</div>
          </div>
        </div>
      </section>

      <section className="absolute bottom-[4.75rem] left-1/2 w-[min(31rem,calc(100vw-2.5rem))] -translate-x-1/2 border border-line bg-panel/70 px-4 py-2 text-center shadow-[0_12px_32px_rgba(4,8,13,0.2)] backdrop-blur-sm">
        <div className="text-[10px] uppercase tracking-[0.18em] text-dim">current directive</div>
        <div className="mt-1 text-xs uppercase tracking-[0.1em] text-text">{objective}</div>
      </section>

      {gameStatus === "clear" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-ink/20">
          <div className="border border-warn/70 bg-panel/90 px-8 py-7 text-center shadow-[0_18px_48px_rgba(4,8,13,0.4)] backdrop-blur-sm">
            <div className="text-[10px] uppercase tracking-[0.28em] text-warn">mission complete</div>
            <div className="mt-2 text-4xl font-semibold tracking-[-0.08em] text-text">ARENA CLEAR</div>
            <div className="mt-3 text-xs uppercase tracking-[0.12em] text-dim">{score} points / {shots} shots</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
