import type { Game } from "@threenative/core";
import { DebugOverlay, GameCanvas } from "@threenative/ui";
import type { GameState } from "../state.js";
import { Hud } from "./Hud.js";
import { Menu } from "./Menu.js";

export function App({ game }: { game: Game<GameState> }) {
  return (
    // GameCanvas hosts the renderer; everything after it in this list paints on
    // top. Keep the canvas first.
    <main className="relative h-screen w-screen overflow-hidden bg-ink">
      <GameCanvas className="absolute inset-0" game={game} />
      <Hud game={game} />
      <Menu game={game} />
      <DebugOverlay />
    </main>
  );
}
