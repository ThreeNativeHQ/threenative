import { useUiState } from "@threenative/ui";
import type { GameState } from "../state.js";

/**
 * The HUD. Plain Tailwind, plain DOM, and the same file on every target.
 *
 * Every block that floats over the scene carries the panel background. This room is lit by a
 * photographed sky, so half the frame is bright: light HUD text straight onto the frame is
 * invisible exactly where the numbers are, and no assertion sees that — the scenarios read the
 * published state, not the pixels.
 *
 * `useUiState` reads the game's *published* state, which moves at about 10 Hz rather than at the
 * frame rate, and is undefined until the game publishes its first snapshot — so nothing is drawn
 * until there is something true to draw.
 */
export function Hud() {
  const state = useUiState<GameState>();
  if (state === undefined) return null;
  const won = state.status === "won";
  const replaying = state.replayPhase === "first" || state.replayPhase === "second";

  return (
    <>
      <div className="pointer-events-none absolute left-6 top-6 w-56 select-none border border-line bg-panel/75 px-3 py-2">
        <div className="text-[10px] uppercase tracking-[0.22em] text-dim">warden vault</div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-dim">
          seed <b className="font-normal tabular-nums text-text">{state.seed}</b>
        </div>

        <dl className="mt-4 space-y-1 text-[11px] uppercase tracking-[0.12em]">
          <Row label="solid crates" value={state.crates} />
          <Row label="phase crates" value={state.phaseCrates} tone="phase" />
          <Row
            label="at rest"
            value={`${state.settledCrates} / ${state.crates + state.phaseCrates}`}
          />
          <Row label="shoved" value={state.pushedCrates} />
          <Row label="push metres" value={state.pushDistance.toFixed(2)} />
          <Row label="blocked ticks" value={state.blockedTicks} />
          <Row label="walked through" value={state.passThroughs} tone="phase" />
          <Row label="seal contacts" value={state.sealContacts} />
        </dl>

        <div className="mt-4 border-t border-line pt-2 text-[10px] uppercase tracking-[0.14em] text-dim">
          <div className="flex justify-between gap-2">
            <span>replay</span>
            <b className="font-normal tabular-nums text-text">{state.replayPhase}</b>
          </div>
          <div className="flex justify-between gap-2">
            <span>bodies</span>
            <b className="font-normal tabular-nums text-text">
              {state.replayPhase === "done" ? state.replayBodies : "—"}
            </b>
          </div>
          <div className="flex justify-between gap-2">
            <span>drift</span>
            <b className="font-normal tabular-nums text-text">
              {state.replayPhase === "done" ? state.replayDrift.toExponential(1) : "—"}
            </b>
          </div>
          <div className="flex justify-between gap-2">
            <span>match</span>
            <b
              className={`font-normal tabular-nums ${state.replayMatch ? "text-lume" : "text-text"}`}
            >
              {state.replayMatch ? "yes" : "—"}
            </b>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-6 left-6 select-none border border-line bg-panel/75 px-3 py-2 text-[10px] uppercase leading-relaxed tracking-[0.14em] text-dim">
        <div>arrows or wasd — shove the crates</div>
        <div>v — run the vault twice and compare</div>
        <div>r — reset the vault</div>
      </div>

      {replaying ? (
        <div className="pointer-events-none absolute inset-x-0 top-8 flex justify-center">
          <output className="border border-line bg-panel/80 px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-lume">
            determinism check — pass {state.replayPhase === "first" ? "1" : "2"} of 2
          </output>
        </div>
      ) : null}

      {won ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 flex flex-col items-center gap-2">
          <output className="text-5xl uppercase tracking-[0.2em] text-lume">seal broken</output>
          <div className="text-[11px] uppercase tracking-[0.14em] text-dim">
            reached by {state.sealedBy === "warden" ? "the warden" : "a shoved crate"} — press r to
            reset
          </div>
        </div>
      ) : null}
    </>
  );
}

function Row({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: "phase";
  value: number | string;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-dim">{label}</dt>
      <dd className={`tabular-nums ${tone === "phase" ? "text-lume" : "text-text"}`}>{value}</dd>
    </div>
  );
}
