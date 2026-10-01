import { UiLayer } from "@threenative/ui";
import { Hud } from "./Hud.js";

/**
 * Everything the player sees that is not the rendered frame.
 *
 * `UiLayer` is what connects this tree to the game: it opens the bridge, mirrors published state,
 * and publishes the rectangles of every `data-tn-interactive` element so the host knows which
 * presses belong to the UI and which fall through to the game. There is no `game` prop anywhere
 * below it — on native this whole tree runs in the platform's web view, in a different process
 * from the scene, and reaches the game only through state and intents.
 */
export function GameUi() {
  return (
    <UiLayer>
      <Hud />
    </UiLayer>
  );
}
