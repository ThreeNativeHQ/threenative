import type { Game } from "@threenative/core";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

export function Hud({ game }: { game: Game<GameState> }) {
  const distance = useGameState(game, (state) => state.distance);
  const destination = useGameState(game, (state) => state.destination);
  const discovered = useGameState(game, (state) => state.discovered);
  const currentChunk = useGameState(game, (state) => state.currentChunk);
  return (
    <div className="pointer-events-none absolute inset-0 text-cream">
      <section className="absolute left-7 top-7 border-l-2 border-sun/80 pl-4 drop-shadow-lg">
        <div className="font-display text-[11px] uppercase tracking-[0.32em] text-mist">The Verdant Reach</div>
        <div className="mt-1 text-2xl font-semibold tracking-wide text-cream">{destination}</div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.22em] text-mist">
          {discovered}/2 landmarks · sector {currentChunk}
        </div>
      </section>
      <section className="absolute right-7 top-7 text-right drop-shadow-lg">
        <div className="text-[9px] uppercase tracking-[0.3em] text-mist">Trail walked</div>
        <div className="font-display text-3xl text-cream">{Math.floor(distance)}m</div>
      </section>
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full border border-cream/25 bg-forest/65 px-5 py-2 text-[10px] uppercase tracking-[0.24em] text-cream shadow-2xl backdrop-blur-sm">
        Follow the ochre trail <span className="px-2 text-sun">→</span> arrows / WASD
      </div>
    </div>
  );
}
