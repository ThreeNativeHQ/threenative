import type { GameState } from "../state.js";

/**
 * The chapter card: the game's name and the place, fading in over the first frames and out again.
 * It never blocks play — the hero can already walk — and it leaves the tree after twelve seconds,
 * so a scene restart or a reload plays it again.
 */
export function Title({ state }: { state: GameState }) {
  if (state.clock > 12) return null;
  return (
    <div
      className="tn-title pointer-events-none absolute inset-x-0 top-[28%] text-center"
      data-testid="title"
    >
      <div className="text-[10px] tracking-[0.42em] text-lume/80">A WOODLAND ADVENTURE</div>
      <h1 className="m-0 mt-3 font-serif text-6xl font-normal tracking-[0.08em] text-text">
        The Verdant Oath
      </h1>
      <div className="mx-auto mt-4 h-px w-40 bg-line/60" />
      <div className="mt-3 text-xs tracking-[0.34em] text-dim">
        CHAPTER I · THE WHISPERING WOODS
      </div>
    </div>
  );
}
