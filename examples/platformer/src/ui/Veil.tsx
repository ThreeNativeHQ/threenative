import type { Game } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";
import { CoinIcon, GemIcon, StarIcon } from "./icons.js";

function Tally({ children, value }: { children: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-2">
      {children}
      <b className="hud-text font-extrabold tabular-nums">{value}</b>
    </div>
  );
}

export function Veil({ game }: { game: Game<GameState, PhysicsContext> }) {
  const { coins, elapsed, gems, gemsTotal, stars, status } = useGameState(game);
  if (status === "play") return null;
  const cleared = status === "clear";

  return (
    <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(120%_90%_at_50%_45%,rgb(6_20_32_/_25%),rgb(6_20_32_/_78%))] p-6 backdrop-blur-[2px]">
      <div className="flex w-[min(520px,100%)] flex-col items-center gap-5 rounded-3xl border-4 border-white/70 bg-[linear-gradient(180deg,rgb(47_143_224_/_92%),rgb(16_50_82_/_94%))] px-8 py-9 text-center shadow-[0_18px_40px_rgb(4_16_28_/_45%)]">
        <h1 className="hud-text m-0 text-title font-black uppercase leading-[0.9] tracking-[0.06em]">
          {cleared ? "Level clear!" : "Out of hearts"}
        </h1>
        <p className="m-0 max-w-[34ch] text-[0.95em] font-semibold leading-relaxed text-white/85">
          {cleared
            ? "Every gem recovered. The island is yours."
            : "The mushrooms won this round. Shake it off and run it back."}
        </p>
        <div className="flex flex-wrap justify-center gap-x-7 gap-y-3 border-t-2 border-white/25 pt-5 text-hud-lg">
          <Tally value={`x ${coins}`}>
            <CoinIcon className="h-[1.3em] w-[1.3em]" />
          </Tally>
          <Tally value={`x ${stars}`}>
            <StarIcon className="h-[1.3em] w-[1.3em]" />
          </Tally>
          <Tally value={`${gems}/${gemsTotal}`}>
            <GemIcon className="h-[1.3em] w-[1.3em]" />
          </Tally>
          <Tally value={`${elapsed.toFixed(1)}s`}>
            <span className="text-[0.7em] uppercase tracking-widest text-white/70">time</span>
          </Tally>
        </div>
        <div className="hud-text text-[0.8em] uppercase tracking-[0.25em] text-white/80">
          press enter to play again
        </div>
      </div>
    </div>
  );
}
