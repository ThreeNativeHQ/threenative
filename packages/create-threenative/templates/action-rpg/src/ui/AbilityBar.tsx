import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

export function AbilityBar({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  const cooldown = useGameState(game, (state) => state.abilityCooldown);
  const active = useGameState(game, (state) => state.modifierActive);
  const uses = useGameState(game, (state) => state.abilityUses);
  const ready = cooldown <= 0;
  return (
    <footer className="pointer-events-none absolute bottom-6 left-6 w-72 border border-line bg-panel/90 p-3 text-[10px] uppercase tracking-[0.14em]">
      <div className="flex justify-between text-amber">
        <span>arcane surge</span>
        <span className={ready ? "text-cyan" : "text-dim"}>
          {ready ? "ready" : cooldown.toFixed(1)}
        </span>
      </div>
      <div className="mt-2 h-1 bg-void">
        <i
          className={`block h-full ${active === 1 ? "bg-amber" : "bg-cyan"}`}
          style={{ width: `${Math.max(0, Math.min(100, (1 - cooldown / 3) * 100))}%` }}
        />
      </div>
      <div className="mt-2 text-dim">E cast · Q equip · U unequip · C save · uses {uses}</div>
    </footer>
  );
}
