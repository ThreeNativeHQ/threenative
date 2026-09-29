import type { GameState } from "../state.js";

/** One heart holds two hit points; `fill` is 0, 0.5 or 1. */
function Heart({ fill, id }: { fill: number; id: number }) {
  const at = `${fill * 100}%`;
  return (
    <svg
      aria-hidden="true"
      className="h-8 w-8 drop-shadow-[0_2px_2px_rgb(10_20_10/60%)]"
      viewBox="0 0 32 30"
    >
      <defs>
        <linearGradient id={`heart-${id}`}>
          <stop offset={at} stopColor="#e2523f" />
          <stop offset={at} stopColor="#3a2f2b" />
        </linearGradient>
      </defs>
      <path
        d="M16 27C12 23 2 16 2 9C2 1 12 0 16 7C20 0 30 1 30 9C30 16 20 23 16 27Z"
        fill={`url(#heart-${id})`}
        stroke="#f0d9a8"
        strokeWidth="1.4"
      />
      {fill > 0 && (
        <path
          d="M6 10C5 5 10 4 12 7"
          fill="none"
          opacity="0.55"
          stroke="#ffd6bd"
          strokeLinecap="round"
          strokeWidth="2"
        />
      )}
    </svg>
  );
}

const QUEST: Readonly<Record<string, readonly [string, string]>> = {
  altar: ["A promise to keep", "Bring the sigils to the altar in the north."],
  complete: ["The grove remembers", "The woods are yours to wander."],
  meet: ["A voice in the clearing", "Find Mira beside the old stone stair."],
  seek: ["Gather the lost lights", "Find the three sigils. Follow your map."],
};
const SIGIL_COLOUR: Readonly<Record<string, string>> = {
  briar: "#ebc570",
  brook: "#9edcde",
  elder: "#b6b7f2",
};

function Slot({
  hint,
  label,
  children,
}: { children: React.ReactNode; hint: string; label: string }) {
  return (
    <div
      aria-label={label}
      className="relative flex h-16 w-16 items-center justify-center rounded-xl border border-line/60 bg-ink/70 shadow-[0_2px_8px_rgb(0_0_0/45%)]"
    >
      {children}
      <kbd className="absolute -bottom-2 rounded bg-ink px-1.5 text-[10px] text-lume ring-1 ring-line/50">
        {hint}
      </kbd>
    </div>
  );
}

/** Hearts, gems and stamina; the place banner; the item slots; the quest; prompts and the toast. */
export function Hud({ state }: { state: GameState }) {
  const [title, detail] = QUEST[state.stage] ?? QUEST.meet ?? ["", ""];
  return (
    <>
      {state.hurtId > 0 && (
        <div
          className="tn-hurt pointer-events-none absolute inset-0 shadow-[inset_0_0_120px_40px_#ac2d23]"
          key={state.hurtId}
        />
      )}

      <section
        aria-label="Player status"
        className="pointer-events-none absolute top-6 left-8 flex flex-col gap-2"
      >
        <div aria-label={`${state.hp / 2} of 3 hearts`} className="flex gap-1.5" role="img">
          {[0, 1, 2].map((i) => (
            <Heart fill={Math.max(0, Math.min(1, (state.hp - i * 2) / 2))} id={i} key={i} />
          ))}
        </div>
        <div className="tn-outline flex items-center gap-2 font-serif text-xl tracking-widest">
          <svg aria-hidden="true" className="h-6 w-4" viewBox="0 0 24 32">
            <path
              d="M12 1L21 9V23L12 31L3 23V9Z"
              fill="#9cd5ab"
              stroke="#d3ebc6"
              strokeWidth="1.3"
            />
            <path d="M12 1L8 11V22L12 31L16 22V11Z" fill="#c6e4b5" />
          </svg>
          <span data-testid="gems">{String(state.gems).padStart(2, "0")}</span>
          <span className="mx-1 h-3 border-l border-line/40" />
          <span className="text-base" data-testid="sigils">
            {state.sigils.length} / 3
          </span>
        </div>
        <div
          className="h-1 w-32 overflow-hidden rounded-full bg-ink/60 transition-opacity"
          style={{ opacity: state.stamina < 99 ? 1 : 0 }}
        >
          <div
            className="h-full rounded-full bg-lume shadow-[0_0_5px_#ccdda0]"
            style={{ width: `${state.stamina}%` }}
          />
        </div>
      </section>

      <header
        className="tn-banner tn-outline pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 text-center"
        key="banner"
      >
        <h1 className="m-0 font-serif text-[17px] font-normal tracking-[0.22em]">
          WHISPERING WOODS
        </h1>
        <p className="m-0 mt-1 text-[8px] tracking-[0.26em] opacity-80">THE ELDER GROVE · DAWN</p>
      </header>

      <aside className="pointer-events-none absolute top-6 right-8 flex gap-3">
        <Slot hint="J" label="Sword">
          <svg aria-hidden="true" className="h-11 w-11" viewBox="0 0 48 48">
            <path d="M13 37L35 9l5-2-1 6L17 40z" fill="#cdd9ce" stroke="#9caa99" />
            <path d="M10 28l12 10M7 41l8-9" fill="none" stroke="#d3bb76" strokeWidth="4" />
          </svg>
        </Slot>
        <Slot hint="K" label="Shield">
          <svg aria-hidden="true" className="h-11 w-11" viewBox="0 0 48 48">
            <path
              d="M12 9Q24 3 36 9L34 29Q30 36 24 41Q16 36 13 29z"
              fill="#7d5a38"
              stroke="#c4ae73"
              strokeWidth="2"
            />
            <path d="M24 12l7 12-7 12-7-12z" fill="#a9382c" />
            <path d="M24 13v22M18 22h12" stroke="#eeead6" strokeWidth="2" />
          </svg>
        </Slot>
      </aside>

      <section
        aria-live="polite"
        className="tn-outline pointer-events-none absolute bottom-6 left-8 max-w-xs"
      >
        <div className="text-[10px] tracking-[0.2em] text-dim">❧ THE FIRST PROMISE</div>
        <h2 className="m-0 mt-1 font-serif text-lg font-normal" data-testid="quest-title">
          {title}
        </h2>
        <p className="m-0 mt-1 text-xs text-lume/90">{detail}</p>
        <div className="mt-2 flex items-center gap-2">
          {["brook", "briar", "elder"].map((id) => (
            <i
              className="h-3 w-3 rotate-45 border border-line/70"
              key={id}
              style={{ background: state.sigils.includes(id) ? SIGIL_COLOUR[id] : "transparent" }}
            />
          ))}
          <span className="text-[9px] tracking-[0.18em] text-dim">THE WOODLAND SIGILS</span>
        </div>
      </section>

      <div className="tn-legend tn-outline pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-3 text-[10px] whitespace-nowrap text-dim">
        <span>
          <kbd>WASD</kbd> Move
        </span>
        ·
        <span>
          <kbd>Mouse</kbd> Look
        </span>
        ·
        <span>
          <kbd>J</kbd> Sword
        </span>
        ·
        <span>
          <kbd>K</kbd> Shield
        </span>
        ·
        <span>
          <kbd>Space</kbd> Roll
        </span>
        ·
        <span>
          <kbd>E</kbd> Interact
        </span>
        ·
        <span>
          <kbd>H</kbd> Pause
        </span>
      </div>

      {state.prompt !== "" && (
        <div
          className="tn-outline pointer-events-none absolute bottom-28 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink/70 px-4 py-1.5 text-sm ring-1 ring-line/50"
          data-testid="prompt"
        >
          <kbd className="rounded bg-lume px-1.5 text-xs font-bold text-ink">E</kbd>
          <span>{state.prompt}</span>
        </div>
      )}

      {state.toast !== "" && (
        <div
          className="tn-toast tn-outline pointer-events-none absolute top-20 left-1/2 rounded-full bg-ink/70 px-5 py-1.5 text-sm ring-1 ring-line/40"
          data-testid="toast"
          key={state.toastId}
        >
          {state.toast}
        </div>
      )}

      {state.lockHp > 0 && state.lockX >= 0 && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${state.lockX * 100}%`, top: `${state.lockY * 100}%` }}
        >
          <div className="mx-auto h-3 w-3 rotate-45 border-2 border-lume" />
          <div className="mt-1 h-1 w-10 overflow-hidden rounded-full bg-ink/70">
            <div className="h-full bg-warn" style={{ width: `${(state.lockHp / 3) * 100}%` }} />
          </div>
        </div>
      )}
    </>
  );
}
