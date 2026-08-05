import type { Game } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="border-l border-white/20 pl-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-sky-100/65">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${accent ? "text-amber-200" : "text-white"}`}>
        {value}
      </div>
    </div>
  );
}

export function Hud({ game }: { game: Game<GameState, PhysicsContext> }) {
  const score = useGameState(game, (state) => state.score);
  const distance = useGameState(game, (state) => state.distance);
  const speed = useGameState(game, (state) => state.speed);
  const lane = useGameState(game, (state) => state.lane);
  const phase = useGameState(game, (state) => state.phase);
  const collected = useGameState(game, (state) => state.collected);
  const crashed = phase === "crashed";
  return (
    <div className="pointer-events-none absolute inset-0 p-5 text-white sm:p-7">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/80">Skyline Sprint</div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/50">Run {String(lane + 1).padStart(2, "0")} · lane {lane + 1}</div>
        </div>
        <div className="grid grid-cols-3 gap-4 rounded-2xl border border-white/15 bg-[#10283b]/70 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-sm sm:gap-7">
          <Metric label="score" value={String(score).padStart(4, "0")} accent />
          <Metric label="distance" value={`${Math.floor(distance)}m`} />
          <Metric label="speed" value={`${speed.toFixed(1)} m/s`} />
        </div>
      </div>
      <div className="absolute bottom-24 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-[#10283b]/65 px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-white/65 backdrop-blur-sm">
        <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(110,231,183,0.14)]" />
        {collected} signal{collected === 1 ? "" : "s"} collected
      </div>
      {crashed && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0b1722]/48">
          <div className="mx-5 max-w-sm rounded-[28px] border border-white/20 bg-[#172f43]/92 px-8 py-7 text-center shadow-2xl backdrop-blur-md">
            <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-rose-200">Run ended</div>
            <div className="mt-3 text-3xl font-semibold tracking-tight text-white">Barrier impact</div>
            <div className="mt-2 text-sm text-white/65">Press Space or Enter to restart the run.</div>
          </div>
        </div>
      )}
    </div>
  );
}
