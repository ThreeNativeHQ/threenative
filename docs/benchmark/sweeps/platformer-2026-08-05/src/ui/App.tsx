import type { Game } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { DebugOverlay, GameCanvas } from "@threenative/ui";
import type { GameState } from "../state.js";
import { Hud } from "./Hud.js";
import { Menu } from "./Menu.js";

export function App({ game }: { game: Game<GameState, PhysicsContext> }) {
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-ink">
      <GameCanvas className="absolute inset-0" game={game} />
      <Hud game={game} />
      <Menu />
      <DebugOverlay />
    </main>
  );
}
