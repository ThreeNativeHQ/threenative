import { UiLayer, useUiState } from "@threenative/ui";
import type { GameState } from "../state.js";
import { Dialog, Pause, Victory } from "./Dialog.js";
import { Hud } from "./Hud.js";
import { Minimap } from "./Minimap.js";

/**
 * Everything the player sees that is not the forest.
 *
 * One component, mounted twice by two entries that differ only in what else is on the page:
 * `src/main.ts` puts it beside the canvas on the web target, and `src/ui/main.tsx` is the whole
 * page the native web view loads. `C` hides the lot for a screenshot.
 */
export function GameUi() {
  return (
    <UiLayer>
      <Screens />
    </UiLayer>
  );
}

/** Inside the layer, because `useUiState` reads the layer's mirror of the game's state. */
function Screens() {
  const state = useUiState<GameState>();
  if (state === undefined || state.cinematic) return null;
  return (
    <>
      <Hud state={state} />
      <Minimap state={state} />
      <Dialog state={state} />
      <Pause state={state} />
      <Victory state={state} />
    </>
  );
}
