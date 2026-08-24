import { useUiState } from "@threenative/ui";
import type { GameState } from "../state.js";

export function InventoryPanel() {
  const state = useUiState<GameState>();
  // Nothing to draw until the game publishes its first snapshot, a few milliseconds in.
  // Rendering zeroes instead would put wrong numbers on screen and then correct them.
  if (state === undefined) return null;
  const items = state.inventory;
  const refused = state.inventoryFullRefused;
  const pending = state.pendingLoot;
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
