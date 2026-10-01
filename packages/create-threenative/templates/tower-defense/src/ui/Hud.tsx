import { useUiIntent, useUiState } from "@threenative/ui";
import { TARGET_MODES, TOTAL_WAVES, TOWERS, TOWER_KINDS, type TowerKind } from "../balance.js";
import type { GameState } from "../state.js";
import { TowerIcon } from "./icons.js";

const KIND_TEXT: Record<TowerKind, string> = {
  arc: "text-arc",
  cryo: "text-cryo",
  mortar: "text-mortar",
  sentry: "text-sentry",
};

const KIND_RING: Record<TowerKind, string> = {
  arc: "border-arc/70 bg-arc/10",
  cryo: "border-cryo/70 bg-cryo/10",
  mortar: "border-mortar/70 bg-mortar/10",
  sentry: "border-sentry/70 bg-sentry/10",
};

const PANEL =
  "rounded-xl border border-line bg-panel/85 backdrop-blur-md shadow-xl shadow-black/30";
const BUTTON =
  "pointer-events-auto rounded-lg border border-line bg-white/5 px-3 py-1.5 text-[12px] font-medium text-text transition hover:bg-white/10 active:scale-95 disabled:opacity-40 disabled:hover:bg-white/5";

function Stat({
  id,
  label,
  value,
  tone = "text-text",
}: { id: string; label: string; value: string; tone?: string }) {
  return (
    <div className={`${PANEL} px-4 py-2`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
        {label}
      </div>
      <div className={`text-[22px] font-semibold leading-tight tabular-nums ${tone}`} id={id}>
        {value}
      </div>
    </div>
  );
}

function WaveBar({ state }: { state: GameState }) {
  const send = useUiIntent();
  const building = state.phase === "build";
  const finished = state.wave >= TOTAL_WAVES && building;
  return (
    <div
      className={`${PANEL} pointer-events-auto flex items-center gap-4 px-4 py-2`}
      data-tn-interactive
    >
      <div className="min-w-[150px]">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
          {building ? "Build phase" : "Combat"}
        </div>
        <div className="text-[13px] text-text">
          {building
            ? "Place towers, then launch"
            : `${state.hostiles} hostiles ${state.hostiles === 1 ? "remaining" : "remaining"}`}
        </div>
      </div>
      <div className="flex gap-1" aria-label={`Wave ${state.wave} of ${TOTAL_WAVES}`}>
        {Array.from({ length: TOTAL_WAVES }, (_, index) => index + 1).map((number) => (
          <span
            className={`h-2 w-3 rounded-sm ${number <= state.wave ? "bg-accent" : "bg-white/12"} ${number === state.wave && !building ? "animate-pulse" : ""}`}
            key={number}
          />
        ))}
      </div>
      <button
        className={`${BUTTON} ${building && !finished ? "ready border-accent/60 bg-accent/15 text-accent" : ""} min-w-[128px]`}
        data-tn-interactive
        disabled={!building || finished}
        onClick={() => send("launch")}
        type="button"
      >
        {finished ? "Complete" : building ? `Launch wave ${state.wave + 1}` : "In progress"}
      </button>
      <button className={BUTTON} data-tn-interactive onClick={() => send("speed")} type="button">
        {state.speed}×
      </button>
      <button
        className={BUTTON}
        data-tn-interactive
        onClick={() => send(state.paused ? "resume" : "pause")}
        type="button"
      >
        {state.paused ? "Resume" : "Pause"}
      </button>
      <button
        className={`${BUTTON} ${state.autoSend ? "border-accent/60 text-accent" : ""}`}
        data-tn-interactive
        onClick={() => send("autosend")}
        type="button"
      >
        Auto {state.autoSend ? "on" : "off"}
      </button>
    </div>
  );
}

function Armory({ state }: { state: GameState }) {
  const send = useUiIntent();
  return (
    <div className={`${PANEL} p-3`}>
      <div className="mb-2 flex items-baseline justify-between px-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
          Armory
        </div>
        <div className="text-[10px] text-muted">click a pad to build</div>
      </div>
      <div className="flex flex-col gap-1.5">
        {TOWER_KINDS.map((kind, index) => {
          const tower = TOWERS[kind];
          const armed = state.armed === kind;
          const poor = state.credits < tower.cost;
          return (
            <button
              className={`pointer-events-auto flex items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition hover:bg-white/8 active:scale-[0.98] ${armed ? KIND_RING[kind] : "border-line bg-white/4"} ${poor && !armed ? "opacity-55" : ""}`}
              data-tn-interactive
              key={kind}
              onClick={() => send("arm", kind)}
              type="button"
            >
              <TowerIcon kind={kind} />
              <span className="min-w-0 flex-1">
                <span className={`block text-[13px] font-semibold ${KIND_TEXT[kind]}`}>
                  {tower.name}
                </span>
                <span className="block truncate text-[11px] text-muted">{tower.role}</span>
              </span>
              <span className="text-right">
                <span className="block text-[13px] font-semibold tabular-nums text-gold">
                  {tower.cost}
                </span>
                <span className="block text-[10px] text-muted">[{index + 1}]</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Selection({ state }: { state: GameState }) {
  const send = useUiIntent();
  if (!state.selected || state.selKind === "") return null;
  const kind = state.selKind;
  const maxed = state.selUpgrade === 0;
  return (
    <div className={`${PANEL} p-3`}>
      <div className="mb-2 flex items-center gap-3 px-1">
        <TowerIcon kind={kind} size={30} />
        <div className="flex-1">
          <div className={`text-[14px] font-semibold ${KIND_TEXT[kind]}`}>{TOWERS[kind].name}</div>
          <div className="text-[11px] text-muted">
            MK.{"I".repeat(state.selLevel)} · {state.selDamage} dmg · {state.selRange} m
          </div>
        </div>
      </div>
      <div className="mb-2 grid grid-cols-3 gap-1">
        {TARGET_MODES.map((mode) => (
          <button
            className={`${BUTTON} px-1 capitalize ${state.selMode === mode ? "border-accent/60 bg-accent/15 text-accent" : ""}`}
            data-tn-interactive
            key={mode}
            onClick={() => send("target", mode)}
            type="button"
          >
            {mode}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          className={`${BUTTON} ${!maxed && state.credits >= state.selUpgrade ? "border-gold/60 text-gold" : ""}`}
          data-tn-interactive
          disabled={maxed}
          onClick={() => send("upgrade")}
          type="button"
        >
          {maxed ? "Max level" : `Upgrade  ${state.selUpgrade}`}
        </button>
        <button
          className={BUTTON}
          data-tn-interactive
          onClick={() => send("recycle")}
          type="button"
        >
          Recycle +{state.selSell}
        </button>
      </div>
    </div>
  );
}

function Strike({ state }: { state: GameState }) {
  const send = useUiIntent();
  const ready = state.strikeCooldown === 0 && state.phase === "combat";
  return (
    <button
      className={`${PANEL} pointer-events-auto flex items-center gap-3 px-4 py-2.5 text-left transition hover:bg-white/8 active:scale-[0.98] ${state.strikeArmed ? "border-gold/80 bg-gold/15" : ""}`}
      data-tn-interactive
      onClick={() => send("strike")}
      type="button"
    >
      <span
        className={`grid h-8 w-8 place-items-center rounded-lg text-[15px] ${ready ? "bg-gold/20 text-gold" : "bg-white/6 text-muted"}`}
      >
        ✦
      </span>
      <span>
        <span className="block text-[13px] font-semibold text-text">Orbital strike</span>
        <span className="block text-[11px] text-muted">
          {state.strikeArmed
            ? "click the board to fire"
            : state.strikeCooldown > 0
              ? `recharging ${state.strikeCooldown}s`
              : state.phase === "combat"
                ? "ready · F"
                : "needs a wave · F"}
        </span>
      </span>
    </button>
  );
}

export function Hud() {
  const state = useUiState<GameState>();
  // Nothing to draw until the game publishes its first snapshot, a few milliseconds in.
  // Rendering zeroes instead would put wrong numbers on screen and then correct them.
  if (state === undefined) return null;
  const danger = state.lives <= 8;
  return (
    <div className="pointer-events-none absolute inset-0 select-none p-4 text-text">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-2">
          <Stat id="balance" label="Credits" tone="text-gold" value={String(state.credits)} />
          <Stat
            id="lives"
            label="Reactor"
            tone={danger ? "text-danger" : "text-text"}
            value={`${state.lives}/25`}
          />
          <Stat
            id="wave"
            label="Wave"
            value={`${String(state.wave).padStart(2, "0")}/${TOTAL_WAVES}`}
          />
        </div>
        <WaveBar state={state} />
      </div>
      <div className="absolute right-4 top-[92px] flex w-[256px] flex-col gap-2">
        <Armory state={state} />
        <Selection state={state} />
      </div>
      <div className="absolute bottom-4 left-4">
        <Strike state={state} />
      </div>
      {state.toast !== "" && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2" key={state.toastSeq}>
          <div className={`${PANEL} toast px-5 py-2 text-[13px] font-medium text-text`}>
            {state.toast}
          </div>
        </div>
      )}
    </div>
  );
}
