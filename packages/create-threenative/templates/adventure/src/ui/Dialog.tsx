import { useUiIntent } from "@threenative/ui";
import { useState } from "react";
import type { GameState } from "../state.js";

/** The keeper's line, set like a film subtitle: pale, centred, outlined, over the frame's foot. */
export function Dialog({ state }: { state: GameState }) {
  const send = useUiIntent();
  if (state.dialog === "") return null;
  return (
    <section aria-label="Conversation" className="absolute inset-x-0 bottom-10 mx-auto flex max-w-3xl flex-col items-center gap-2 px-6 text-center" data-testid="dialog">
      <div className="tn-outline text-[10px] tracking-[0.24em] text-warn">MIRA · WOODLAND KEEPER</div>
      <p className="tn-outline m-0 text-2xl leading-snug text-text" data-testid="dialog-text">{state.dialog}</p>
      <button className="pointer-events-auto mt-1 rounded-full bg-ink/70 px-4 py-1 text-xs text-lume ring-1 ring-line/50 hover:bg-panel" onClick={() => send("continue")} type="button">
        {state.dialogMore ? "Continue" : "Close"} <kbd>E</kbd> ›
      </button>
    </section>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-ink/60 backdrop-blur-sm">
      <div className="max-w-xl rounded-2xl bg-panel/95 px-10 py-8 text-center shadow-2xl ring-1 ring-line/60">{children}</div>
    </div>
  );
}

const CONTROLS: readonly (readonly [string, string])[] = [
  ["W A S D", "Move"], ["Shift", "Sprint"], ["Mouse", "Orbit camera (click to capture)"], ["Scroll", "Zoom"],
  ["J / LMB", "Sword"], ["K / RMB", "Hold shield"], ["Space", "Dodge roll"], ["E", "Talk / collect / open"],
  ["Q", "Lock nearest enemy"], ["R", "Recenter camera"], ["C", "Hide interface"], ["H / Esc", "Pause"],
];

export function Pause({ state }: { state: GameState }) {
  const send = useUiIntent();
  const [confirming, setConfirming] = useState(false);
  if (!state.paused) return null;
  return (
    <Card>
      <div className="text-[10px] tracking-[0.24em] text-dim">A MOMENT OF STILLNESS</div>
      <h2 className="m-0 mt-2 font-serif text-3xl font-normal">Rest beneath the leaves.</h2>
      <p className="mt-1 text-dim">The woods will wait.</p>
      <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-2 text-left text-sm">
        {CONTROLS.map(([key, action]) => (
          <div className="flex justify-between gap-3" key={key}>
            <kbd className="text-lume">{key}</kbd>
            <span className="text-dim">{action}</span>
          </div>
        ))}
      </div>
      <button className="mt-6 rounded-full bg-lume px-6 py-2 font-serif text-ink hover:bg-white" onClick={() => send("resume")} type="button">Back to the woods</button>
      <div className="mt-4 text-xs">
        {confirming ? (
          <>
            <span className="text-warn">Your sigils and gems will be lost. </span>
            <button className="underline" onClick={() => { setConfirming(false); send("newGame"); }} type="button">Yes, begin again</button>
            {" · "}
            <button className="underline" onClick={() => setConfirming(false)} type="button">Keep going</button>
          </>
        ) : (
          <button className="text-dim underline" onClick={() => setConfirming(true)} type="button">New adventure</button>
        )}
      </div>
    </Card>
  );
}

export function Victory({ state }: { state: GameState }) {
  const send = useUiIntent();
  if (!state.victory) return null;
  return (
    <Card>
      <div className="text-2xl text-lume">✧</div>
      <div className="text-[10px] tracking-[0.24em] text-dim">THE FIRST PROMISE · FULFILLED</div>
      <h2 className="m-0 mt-2 font-serif text-3xl font-normal" data-testid="victory">The grove remembers.</h2>
      <p className="mt-2 text-dim">Three lost lights. One small act of courage.<br />The old roots stir, and the forest breathes again.</p>
      <button className="mt-6 rounded-full bg-lume px-6 py-2 font-serif text-ink hover:bg-white" onClick={() => send("stay")} type="button">Stay a little longer</button>
      <p className="mt-4 text-xs text-dim">A small adventure. A much larger world beyond.</p>
    </Card>
  );
}
