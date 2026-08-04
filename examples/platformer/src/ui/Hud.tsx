import type { Game } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

/**
 * The HUD from the reference frame: avatar and hearts top-left, coin purse
 * under them, stars / timer / gems stacked top-right, button prompts along the
 * bottom. React never touches the scene graph — it reads the throttled store.
 */

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-shade/45 px-3 py-1.5 backdrop-blur-sm ring-1 ring-white/15">
      {children}
    </div>
  );
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`h-7 w-7 drop-shadow-[0_2px_0_rgba(0,0,0,0.35)] transition-all duration-200 ${
        filled ? "scale-100 text-heart" : "scale-90 text-shade/60"
      }`}
      viewBox="0 0 24 24"
    >
      <path
        d="M12 21s-7.5-4.7-9.3-9A5.3 5.3 0 0 1 12 6.6 5.3 5.3 0 0 1 21.3 12c-1.8 4.3-9.3 9-9.3 9Z"
        fill="currentColor"
        stroke="rgba(0,0,0,0.28)"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function CoinIcon() {
  return (
    <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 24 24">
      <circle cx="12" cy="12" fill="#ff9f1c" r="10" />
      <circle cx="12" cy="12" fill="#ffc93c" r="7.4" />
      <path d="M12 7.4 13.4 11h3.6l-2.9 2.2 1.1 3.5L12 14.6 8.8 16.7l1.1-3.5L7 11h3.6Z" fill="#ff9f1c" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 24 24">
      <path
        d="M12 2.6 14.9 9l7 .7-5.3 4.7 1.6 6.9L12 17.7 5.8 21.3l1.6-6.9L2.1 9.7l7-.7Z"
        fill="#ffc93c"
        stroke="rgba(0,0,0,0.25)"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" viewBox="0 0 24 24">
      <circle cx="12" cy="12" fill="none" r="9" stroke="#ffffff" strokeWidth="2" />
      <path d="M12 7v5.4l3.4 2" fill="none" stroke="#ffffff" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

function GemIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" viewBox="0 0 24 24">
      <path
        d="M12 2.4 21 9l-9 12.6L3 9Z"
        fill="#39b7f0"
        stroke="rgba(255,255,255,0.7)"
        strokeWidth="1.4"
      />
      <path d="M12 2.4 15.6 9 12 21.6 8.4 9Z" fill="#a8ecff" opacity="0.65" />
    </svg>
  );
}

function Prompt({ button, label, round }: { button: string; label: string; round?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`grid h-9 min-w-9 place-items-center px-2 text-sm font-bold text-white shadow-[0_2px_0_rgba(0,0,0,0.35)] ${
          round ? "rounded-full bg-jump" : "rounded-lg bg-shade/70 ring-1 ring-white/25"
        }`}
      >
        {button}
      </span>
      <span className="text-lg font-extrabold uppercase tracking-wide text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)]">
        {label}
      </span>
    </div>
  );
}

function formatTime(ms: number): string {
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const hundredths = Math.floor((total % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

export function Hud({ game }: { game: Game<GameState, PhysicsContext> }) {
  const coins = useGameState(game, (state) => state.coins);
  const gems = useGameState(game, (state) => state.gems);
  const gemsTotal = useGameState(game, (state) => state.gemsTotal);
  const hearts = useGameState(game, (state) => state.hearts);
  const stars = useGameState(game, (state) => state.stars);
  const timeMs = useGameState(game, (state) => state.timeMs);

  return (
    <div className="pointer-events-none absolute inset-0 select-none p-5 sm:p-7">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            {/* The avatar: a portrait ring, the same one the reference wears. */}
            <div className="grid h-14 w-14 place-items-center rounded-full bg-fur ring-4 ring-white/85 shadow-[0_3px_0_rgba(0,0,0,0.3)]">
              <svg aria-label="Fox" className="h-10 w-10" role="img" viewBox="0 0 24 24">
                <path d="M4 4.5 7.5 8h9L20 4.5 19 11a7 7 0 0 1-14 0Z" fill="#ffd9a1" />
                <path d="M6 10a6 6 0 0 0 12 0 6 6 0 0 1-12 0Z" fill="#fff0d6" />
                <circle cx="9.4" cy="11" fill="#2b2118" r="1.05" />
                <circle cx="14.6" cy="11" fill="#2b2118" r="1.05" />
                <path d="M12 13.8a1.3 1.3 0 0 0 1.3-1.3h-2.6A1.3 1.3 0 0 0 12 13.8Z" fill="#2b2118" />
              </svg>
            </div>
            <div className="flex gap-1">
              {[0, 1, 2].map((index) => (
                <Heart filled={index < hearts} key={index} />
              ))}
            </div>
          </div>
          <div className="mt-3 w-fit">
            <Chip>
              <CoinIcon />
              <span className="text-2xl font-black tabular-nums text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)]">
                <span className="text-base font-bold opacity-80">x </span>
                {coins}
              </span>
            </Chip>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <Chip>
            <StarIcon />
            <span className="text-2xl font-black tabular-nums text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)]">
              <span className="text-base font-bold opacity-80">x </span>
              {stars}
            </span>
          </Chip>
          <Chip>
            <ClockIcon />
            <span className="text-xl font-black tabular-nums text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)]">
              {formatTime(timeMs)}
            </span>
          </Chip>
          <Chip>
            <GemIcon />
            <span className="text-xl font-black tabular-nums text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)]">
              {gems}/{gemsTotal}
            </span>
          </Chip>
        </div>
      </div>

      <div className="absolute inset-x-5 bottom-6 flex items-end justify-between sm:inset-x-7">
        <Prompt button="RT" label="Dash" />
        <Prompt button="A" label="Jump" round />
      </div>
    </div>
  );
}
