import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

export function CharacterPanel({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  const health = useGameState(game, (state) => state.health);
  const damage = useGameState(game, (state) => state.damage);
  const equipped = useGameState(game, (state) => state.equippedItem);
  const lastDamage = useGameState(game, (state) => state.lastDamage);
  return (
    <aside className="pointer-events-none absolute right-6 top-5 w-52 border border-line bg-panel/90 p-3 text-[10px] uppercase tracking-[0.14em]">
      <div className="text-amber">character</div>
      <div className="mt-3 flex justify-between text-dim">
        <span>health</span>
        <span className="text-cyan">{Math.round(health)} / 100</span>
      </div>
      <div className="mt-1 h-1 bg-void">
        <i className="block h-full bg-cyan" style={{ width: `${Math.max(0, health)}%` }} />
      </div>
      <div className="mt-3 flex justify-between text-dim">
        <span>damage</span>
        <span className="text-text">{Math.round(damage)}</span>
      </div>
      <div className="mt-2 border-t border-line pt-2 text-dim">
        weapon <span className="text-text">{equipped || "none"}</span>
      </div>
      <div className="mt-1 text-dim">last hit {Math.round(lastDamage)}</div>
    </aside>
  );
}
