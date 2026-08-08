import type { Game } from "@threenative/core";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

function Readout({
  align = "left",
  label,
  suffix,
  value,
}: {
  align?: "left" | "center" | "right";
  label: string;
  suffix?: string;
  value: number;
}) {
  return (
    <div className={`min-w-24 text-${align}`}>
      <div className="hud-label">{label}</div>
      <div className="hud-value">
        {Math.floor(value).toLocaleString("en-US")}
        {suffix === undefined ? null : <small>{suffix}</small>}
      </div>
    </div>
  );
}

export function Hud({ game }: { game: Game<GameState> }) {
  const state = useGameState(game);
  const speedPercent = ((state.speed - 10) / 12) * 100;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 p-4 sm:p-6">
      <div className="hud-panel mx-auto flex max-w-4xl items-start justify-between gap-4 px-5 py-4 sm:px-7">
        <Readout label="score" value={state.score} />
        <Readout align="center" label="distance" suffix="m" value={state.distance} />
        <Readout align="right" label="speed" suffix="km/h" value={state.speed * 3.6} />
        <div className="speed-track absolute inset-x-5 bottom-0 h-1 overflow-hidden sm:inset-x-7">
          <i style={{ width: `${Math.max(2, Math.min(100, speedPercent))}%` }} />
        </div>
      </div>
      <div className="mx-auto mt-2 flex max-w-4xl justify-between px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-road/65 sm:px-5">
        <span>{state.collectibles} shards</span>
        <span>run {state.runs}</span>
      </div>
    </div>
  );
}
