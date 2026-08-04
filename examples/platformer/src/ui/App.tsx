import type { Game } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { DebugOverlay, GameCanvas } from "@threenative/ui";
import type { GameState } from "../state.js";
import { Hud } from "./Hud.js";
import { Keys } from "./Keys.js";

export function App({ game }: { game: Game<GameState, PhysicsContext> }) {
  return (
    // GameCanvas hosts the renderer; everything after it paints on top. Keep
    // the canvas first.
    <main className="relative h-screen w-screen overflow-hidden bg-sky">
      <GameCanvas className="absolute inset-0" game={game} />
      <Hud game={game} />
      <Keys />
      <DebugOverlay />
    </main>
  );
}
