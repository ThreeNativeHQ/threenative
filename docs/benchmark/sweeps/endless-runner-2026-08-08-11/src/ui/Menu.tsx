import type { Game } from "@threenative/core";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

export function Menu({ game }: { game: Game<GameState> }) {
  const status = useGameState(game, (state) => state.status);
  const score = useGameState(game, (state) => state.score);

  return (
    <>
      <div className="controls pointer-events-none absolute inset-x-0 bottom-4 z-10 mx-auto flex w-fit items-center gap-3 rounded-full px-4 py-2 text-[10px] font-extrabold uppercase tracking-[0.12em] sm:bottom-6 sm:gap-5 sm:px-5">
        <span><kbd>←</kbd><kbd>→</kbd> lanes</span>
        <i />
        <span><kbd>↑</kbd> jump</span>
        <i />
        <span><kbd>↓</kbd> slide</span>
      </div>

      {status === "crashed" ? (
        <div className="crash-overlay absolute inset-0 z-20 grid place-items-center bg-road/45 px-6 backdrop-blur-[3px]">
          <section className="crash-card text-center" aria-live="assertive">
            <div className="mx-auto mb-4 grid h-12 w-12 rotate-3 place-items-center rounded-2xl bg-coral text-2xl text-white shadow-lg">!</div>
            <p className="mb-1 text-[11px] font-black uppercase tracking-[0.25em] text-coral">run over</p>
            <h1 className="text-4xl font-black tracking-[-0.05em] text-road sm:text-5xl">{score.toLocaleString("en-US")}</h1>
            <p className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-road/55">final score</p>
            <button
              className="restart-button mt-6"
              onClick={() => game.state.set({ restartRequested: true })}
              type="button"
            >
              Run again <span>↵</span>
            </button>
            <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-road/45">Enter, R, or Space</p>
          </section>
        </div>
      ) : null}
    </>
  );
}
