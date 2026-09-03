import { useUiState } from "@threenative/ui";
import type { GameState } from "../state.js";

export function Hud() {
  const state = useUiState<GameState>();
  // Nothing to draw until the game publishes its first snapshot, a few milliseconds in.
  // Rendering zeroes instead would put wrong numbers on screen and then correct them.
  if (state === undefined) return null;
  const crashed = state.status === "CRASHED";
  return (
    <div className="pointer-events-none absolute inset-0 p-6 text-[11px] uppercase tracking-[0.16em] text-text">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] text-muted">distance</div>
          <div className="mt-1 text-[34px] leading-none text-white" id="distance">
            {Math.floor(state.distance)}
            <span className="ml-1 text-[14px] text-muted">m</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-muted">near misses</div>
          <div className="mt-1 text-[22px] text-white" id="near-misses">
            {state.nearMisses}
          </div>
        </div>
      </div>
      <div className="absolute bottom-6 left-6 flex items-end gap-8">
        <div>
          <div className="text-[10px] text-muted">speed</div>
          <div className="mt-1 text-[18px] leading-none text-white" id="speed">
            {state.speed.toFixed(1)} m/s
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted">chunks built</div>
          <div className="mt-1 text-[18px] leading-none text-white" id="chunks">
            {state.chunks}
          </div>
        </div>
        <div className="text-[10px] leading-relaxed text-muted">
          <div>a / d change lane · space jump</div>
          <div>the track never ends</div>
        </div>
      </div>
      {crashed && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border border-danger/70 bg-danger/10 px-8 py-5 text-center">
          <div className="text-[28px] tracking-[0.28em] text-danger">CRASHED</div>
          <div className="mt-2 text-[10px] text-muted">
            {Math.floor(state.distance)} m · press R to run again
          </div>
        </div>
      )}
    </div>
  );
}
