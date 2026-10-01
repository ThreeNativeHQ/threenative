import { useUiState } from "@threenative/ui";
import type { GameState } from "../state.js";

function Heart({ full }: { full: boolean }) {
  return (
    <svg aria-hidden="true" className="h-6 w-6" viewBox="0 0 24 24">
      <path
        d="M12 21s-8.5-5.4-8.5-11.2A4.8 4.8 0 0 1 12 7a4.8 4.8 0 0 1 8.5 2.8C20.5 15.6 12 21 12 21z"
        fill={full ? "var(--color-heart)" : "var(--color-line)"}
        stroke={full ? "#8f1f2a" : "var(--color-line)"}
        strokeWidth="1.6"
      />
    </svg>
  );
}

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
    <div className="pointer-events-none absolute inset-0 p-6 text-sm font-bold text-text">
      <div className="w-fit rounded-2xl border-2 border-line bg-panel/40 backdrop-blur-sm px-4 py-3 shadow-none">
        <div className="flex items-center gap-2">
          <span aria-label={`${state.hearts} of 3 hearts left`} className="flex gap-0.5">
            {[0, 1, 2].map((slot) => (
              <Heart full={slot < state.hearts} key={slot} />
            ))}
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
        <div className="mt-2 flex gap-5 text-xs text-dim">
          <span id="clock">{clock(state.time)}</span>
          <span>checkpoint {state.checkpoint}</span>
          {state.finished ? <span className="text-lume">level clear</span> : null}
        </div>
      </div>
      {state.toast !== "" ? (
        <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-full border-2 border-line bg-panel/40 backdrop-blur-sm px-4 py-1 text-base font-bold text-lume shadow-none">
          {state.toast}
        </div>
      ) : null}
    </div>
  );
}
