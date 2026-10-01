import { useUiIntent, useUiState } from "@threenative/ui";
import { TOWERS, TOWER_KINDS } from "../balance.js";
import type { GameState } from "../state.js";
import { TowerIcon } from "./icons.js";

const PANEL =
  "rounded-2xl border border-line bg-panel/95 backdrop-blur-md shadow-2xl shadow-black/50";
const BUTTON =
  "pointer-events-auto rounded-lg border border-line bg-white/5 px-4 py-2 text-[13px] font-medium text-text transition hover:bg-white/10 active:scale-95";

const CONTROLS: readonly (readonly [string, string])[] = [
  ["1 – 4", "arm a tower, then click a pad"],
  ["Space", "launch the next wave"],
  ["U / X", "upgrade / recycle the selected tower"],
  ["F", "orbital strike, then click the board"],
  ["P", "tactical pause"],
  ["Right-drag · wheel · Q E", "orbit and zoom the board"],
  ["Shift-click", "keep building the same tower"],
];

function Help() {
  const send = useUiIntent();
  return (
    <div
      className="pointer-events-auto absolute inset-0 grid place-items-center bg-black/55"
      data-tn-interactive
    >
      <div className={`${PANEL} w-[560px] max-w-[92vw] p-6`}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
          Field briefing
        </div>
        <div className="mt-1 text-[22px] font-semibold text-text">
          A little firepower. A lot of good positioning.
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {TOWER_KINDS.map((kind) => (
            <div
              className="flex items-center gap-3 rounded-lg border border-line bg-white/4 p-2.5"
              key={kind}
            >
              <TowerIcon kind={kind} />
              <div className="text-[12px]">
                <div className="font-semibold text-text">{TOWERS[kind].name}</div>
                <div className="text-muted">{TOWERS[kind].role}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 divide-y divide-line text-[12px]">
          {CONTROLS.map(([keys, action]) => (
            <div className="flex justify-between py-1.5" key={keys}>
              <span className="font-medium text-accent">{keys}</span>
              <span className="text-muted">{action}</span>
            </div>
          ))}
        </div>
        <div className="mt-5 flex justify-end">
          <button className={BUTTON} data-tn-interactive onClick={() => send("help")} type="button">
            Back to the board
          </button>
        </div>
      </div>
    </div>
  );
}

function Result({ state }: { state: GameState }) {
  const send = useUiIntent();
  const won = state.status === "WON";
  return (
    <div
      className="pointer-events-auto absolute inset-0 grid place-items-center bg-black/55"
      data-tn-interactive
    >
      <div className={`${PANEL} w-[420px] max-w-[92vw] p-7 text-center`}>
        <div
          className={`text-[10px] font-semibold uppercase tracking-[0.24em] ${won ? "text-win" : "text-danger"}`}
        >
          {won ? "Reactor secured" : "Reactor lost"}
        </div>
        <div className="mt-1 text-[28px] font-semibold text-text" id="status">
          {won ? "The line held" : "The line broke"}
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2 text-[12px]">
          {(
            [
              ["Wave", `${state.wave}/12`],
              ["Kills", String(state.kills)],
              ["Score", String(state.score)],
            ] as const
          ).map(([label, value]) => (
            <div className="rounded-lg border border-line bg-white/4 py-2" key={label}>
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted">{label}</div>
              <div className="text-[18px] font-semibold tabular-nums text-text">{value}</div>
            </div>
          ))}
        </div>
        <button
          className={`${BUTTON} mt-6 border-accent/60 bg-accent/15 text-accent`}
          data-tn-interactive
          onClick={() => send("restart")}
          type="button"
        >
          Defend again · R
        </button>
      </div>
    </div>
  );
}

export function Menu() {
  const state = useUiState<GameState>();
  const send = useUiIntent();
  if (state === undefined) return null;
  if (state.status !== "PLAYING") return <Result state={state} />;
  if (state.helpOpen) return <Help />;
  return (
    <>
      {state.paused && (
        <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 rounded-full border border-line bg-panel/90 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.3em] text-accent">
          Tactical pause
        </div>
      )}
      <button
        className={`${BUTTON} absolute bottom-4 right-4 py-1.5 text-[12px] text-muted`}
        data-tn-interactive
        onClick={() => send("help")}
        type="button"
      >
        Help · H
      </button>
    </>
  );
}
