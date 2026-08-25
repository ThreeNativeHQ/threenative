import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { DebugOverlay, GameCanvas } from "@threenative/ui";
import { shooterUi } from "../render/ui.js";
import type { GameState } from "../state.js";
import { GameUi } from "./GameUi.js";

/**
 * The web target's page: the canvas, then the same UI every other target renders.
 *
 * `GameCanvas` hosts the renderer and everything after it paints on top; keep the canvas first.
 * The UI itself comes from `GameUi`, unchanged — this file exists only because the web build also
 * has to put a canvas on the page.
 */
export function App({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  return (
    <main className={shooterUi.app.root}>
      <GameCanvas className={shooterUi.app.canvas} game={game} />
      <GameUi />
      <DebugOverlay />
    </main>
  );
}
