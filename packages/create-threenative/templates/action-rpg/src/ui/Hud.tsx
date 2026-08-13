import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

export function Hud({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  const room = useGameState(game, (state) => state.room);
  const phase = useGameState(game, (state) => state.phase);
  const enemies = useGameState(game, (state) => state.enemiesDefeated);
  const blocked = useGameState(game, (state) => state.lineOfSightBlocked);
  return (
    <section className="pointer-events-none absolute left-6 top-5 w-72 text-[10px] uppercase tracking-[0.16em]">
      <div className="text-dim">dungeon / action rpg</div>
      <div className="mt-2 text-3xl leading-none text-amber">room {room} / 3</div>
      <div className="mt-2 text-cyan">boss clear · death fails</div>
      <div className="mt-2 flex justify-between border-t border-line pt-2 text-dim">
        <span>defeated {enemies}</span>
        <span>wall ray {blocked === 1 ? "blocked" : "clear"}</span>
      </div>
      {phase !== "playing" && (
        <div
          className={`mt-4 border px-3 py-2 text-center text-sm tracking-[0.28em] ${phase === "won" ? "border-amber text-amber" : "border-red text-red"}`}
        >
          {phase === "won" ? "boss defeated" : "run failed"}
        </div>
      )}
    </section>
  );
}
