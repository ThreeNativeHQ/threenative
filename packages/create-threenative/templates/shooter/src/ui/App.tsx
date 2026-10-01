import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { DebugOverlay, GameCanvas } from "@threenative/ui";
import type { GameState } from "../state.js";
import { GameUi } from "./GameUi.js";

export function App({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  return (
    // GameCanvas hosts the renderer; everything after it in this list paints on
    // top. Keep the canvas first.
    // `h-full`, not `h-screen`: `100vh` on mobile Chrome is the tall viewport behind the URL bar,
    // which sized the canvas 56 px taller than the glass on a Pixel 8 — pixels rendered for nobody,
    // and a crosshair 28 px below the centre of what the player can see. `#root` is `100dvh`.
    <main className="relative h-full w-full overflow-hidden bg-ink">
      <GameCanvas className="absolute inset-0" game={game} />
      {/* The same tree the web view loads on native, so the browser is not a second UI to keep
          in step — it is the same one, reached through the same bridge. */}
      <GameUi />
      <DebugOverlay />
    </main>
  );
}
