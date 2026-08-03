import type { Game } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import { type GameState, HEARTS } from "../state.js";
import { ClockIcon, CoinIcon, FoxAvatar, GemIcon, Heart, StarIcon } from "./icons.js";

const HEART_SLOTS = Array.from({ length: HEARTS }, (_, index) => `heart-${index}`);

/** mm:ss.cc, the readout the reference puts under the star count. */
function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}

function Prompt({ button, label, round }: { button: string; label: string; round?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`grid h-[2.1em] min-w-[2.1em] place-items-center bg-panel px-2 text-[0.8em] ${
          round ? "rounded-full bg-[#3aa63a]" : "rounded-lg"
        }`}
      >
        {button}
      </span>
      <span className="hud-text tracking-[0.08em]">{label}</span>
    </div>
  );
}

export function Hud({ game }: { game: Game<GameState, PhysicsContext> }) {
  const { coins, dashReady, elapsed, gems, gemsTotal, hearts, stars } = useGameState(game);

  return (
    <div className="pointer-events-none absolute inset-0 select-none p-rail text-hud">
      <div className="absolute left-rail top-rail flex flex-col gap-2.5">
        <div className="flex items-center gap-3">
          <FoxAvatar className="h-[2.6em] w-[2.6em] drop-shadow-[0_2px_4px_rgb(0_0_0_/_35%)]" />
          <div className="flex gap-1.5" data-value={hearts} id="hearts">
            {HEART_SLOTS.map((slot, index) => (
              <Heart
                className="h-[1.5em] w-[1.5em] drop-shadow-[0_2px_3px_rgb(0_0_0_/_35%)]"
                filled={index < hearts}
                key={slot}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CoinIcon className="h-[1.5em] w-[1.5em] drop-shadow-[0_2px_3px_rgb(0_0_0_/_35%)]" />
          <span className="hud-text tabular-nums" data-value={coins} id="coins">
            x {coins}
          </span>
        </div>
      </div>

      <div className="absolute right-rail top-rail flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-2">
          <StarIcon className="h-[1.5em] w-[1.5em] drop-shadow-[0_2px_3px_rgb(0_0_0_/_35%)]" />
          <span className="hud-text tabular-nums" data-value={stars} id="stars">
            x {stars}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ClockIcon className="h-[1.4em] w-[1.4em] drop-shadow-[0_2px_3px_rgb(0_0_0_/_35%)]" />
          <span className="hud-text tabular-nums" data-value={elapsed.toFixed(2)} id="timer">
            {clock(elapsed)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <GemIcon className="h-[1.4em] w-[1.4em] drop-shadow-[0_2px_3px_rgb(0_0_0_/_35%)]" />
          <span className="hud-text tabular-nums" data-value={gems} id="gems">
            {gems}/{gemsTotal}
          </span>
        </div>
      </div>

      <div
        className={`absolute bottom-rail left-rail transition-opacity duration-200 ${
          dashReady ? "opacity-100" : "opacity-40"
        }`}
      >
        <Prompt button="RT" label="DASH" />
      </div>
      <div className="absolute bottom-rail right-rail">
        <Prompt button="A" label="JUMP" round />
      </div>
    </div>
  );
}
