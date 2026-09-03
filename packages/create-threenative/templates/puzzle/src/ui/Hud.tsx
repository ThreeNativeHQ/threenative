import { useUiState } from "@threenative/ui";
import type { GameState } from "../state.js";

export function Hud() {
  const state = useUiState<GameState>();
  // Nothing to draw until the game publishes its first snapshot, a few milliseconds in.
  // Rendering zeroes instead would put wrong numbers on screen and then correct them.
  if (state === undefined) return null;
  const solved = state.status === "SOLVED";
  return (
    <div className="pointer-events-none absolute inset-0 p-6 text-[11px] uppercase tracking-[0.16em] text-text">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] text-muted">contraption room 01</div>
          <div className="mt-2 flex items-baseline gap-5 text-[18px] text-white">
            <span>
              time <b id="elapsed">{Math.floor(state.elapsed)}</b>s
            </span>
            <span className={solved ? "text-win" : "text-lume"} id="status">
              {state.status}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-muted">crates moved</div>
          <div className="mt-2 text-[22px] text-white" id="crates">
            {state.cratesMoved}
          </div>
        </div>
      </div>
      <div className="absolute bottom-6 left-6 flex items-end gap-8">
        <div>
          <div className="text-[10px] text-muted">swings</div>
          <div className="mt-1 text-[26px] leading-none text-white" id="swings">
            {state.swings}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted">claw</div>
          <div className="mt-1 text-[18px] leading-none text-white" id="holding">
            {state.holding ? "holding" : "empty"}
          </div>
        </div>
        <div className="text-[10px] leading-relaxed text-muted">
          <div>wasd move · e grab · f swing</div>
          <div>roll the ball into the ring</div>
        </div>
      </div>
      {solved && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border border-win/70 bg-win/10 px-8 py-5 text-center">
          <div className="text-[28px] tracking-[0.28em] text-win">SOLVED</div>
          <div className="mt-2 text-[10px] text-muted">press R to reset the room</div>
        </div>
      )}
    </div>
  );
}
