import { useUiState } from "@threenative/ui";
import type { GameState } from "../state.js";

function clock(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * The one HUD, and the same file on every target.
 *
 * It reads published state and nothing else: the simulation keeps its own numbers and this never
 * reaches into the scene. The bridge flushes about every 100 ms, so a number here is at most that
 * old — which is why the fox's per-frame feel is never read from this component.
 */
export function Hud() {
  const state = useUiState<GameState>();
  // Nothing to draw until the game publishes its first snapshot, a few milliseconds in.
  // Rendering zeroes instead would put wrong numbers on screen and then correct them.
  if (state === undefined) return null;
  return (
    <div className="pointer-events-none absolute inset-0 p-6 text-[11px] uppercase tracking-[0.14em] text-text">
      <div className="flex items-center gap-2">
        <span aria-label={`${state.hearts} of 3 hearts left`} className="text-lume">
          {"♥".repeat(Math.max(0, state.hearts))}
          <span className="text-dim">{"♡".repeat(Math.max(0, 3 - state.hearts))}</span>
        </span>
        <span>
          coins{" "}
          <b id="coins" className="text-lume">
            {state.coins}
          </b>
        </span>
        <span>
          gems{" "}
          <b id="gems" className="text-lume">
            {state.gems}/{state.gemTotal}
          </b>
        </span>
        <span>
          stars{" "}
          <b id="stars" className="text-lume">
            {state.stars}
          </b>
        </span>
      </div>
      <div className="mt-2 flex gap-5 text-dim">
        <span id="clock">{clock(state.time)}</span>
        <span>checkpoint {state.checkpoint}</span>
        {state.finished ? <span className="text-lume">level clear</span> : null}
      </div>
      {state.toast !== "" ? (
        <div className="absolute left-1/2 top-16 -translate-x-1/2 text-[13px] text-lume">
          {state.toast}
        </div>
      ) : null}
    </div>
  );
}
