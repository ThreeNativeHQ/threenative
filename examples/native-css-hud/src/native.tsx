import { createCssUiRoot } from "@threenative/core/react-css";
import game, { closeInventory } from "./game.js";
import { Inventory } from "./ui/Inventory.js";

/**
 * The native entry: the game runs in the native runtime, and the HUD is React reconciled against
 * the native CSS engine. No react-dom, no `document`, no web view — `src/ui/Inventory.tsx` and
 * `src/ui/hud.css` are the same files the browser reference mounts.
 */
void game.start().then(
  () => {
    console.info(`TN_NATIVE_CSS_HUD_READY:${game.ctx?.renderer.kind ?? "unknown"}`);
    createCssUiRoot().render(<Inventory onClose={closeInventory} />);
  },
  (error: unknown) => {
    console.error(
      `TN_NATIVE_CSS_HUD_FAILED:${error instanceof Error ? error.message : String(error)}`,
    );
  },
);
