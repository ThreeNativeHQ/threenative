import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

export function InventoryPanel({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  const items = useGameState(game, (state) => state.inventory);
  const refused = useGameState(game, (state) => state.inventoryFullRefused);
  const pending = useGameState(game, (state) => state.pendingLoot);
  const seen = new Map<string, number>();
  return (
    <aside className="pointer-events-none absolute bottom-6 right-6 w-64 border border-line bg-panel/90 p-3 text-[10px] uppercase tracking-[0.14em]">
      <div className="flex justify-between text-amber">
        <span>inventory</span>
        <span className="text-dim">{items.length} / 6</span>
      </div>
      <div className="mt-3 space-y-1 text-dim">
        {items.length === 0 && <div>empty</div>}
        {items.map((item) => {
          const occurrence = seen.get(item) ?? 0;
          seen.set(item, occurrence + 1);
          return (
            <div className="border-b border-line/60 pb-1 text-text" key={`${item}-${occurrence}`}>
              {item}
            </div>
          );
        })}
      </div>
      {refused === 1 && (
        <div className="mt-2 border border-red px-2 py-1 text-red">
          bag full · loot stays on floor
        </div>
      )}
      {pending !== "" && <div className="mt-2 text-amber">waiting: {pending}</div>}
    </aside>
  );
}
