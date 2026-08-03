import type { Game } from "@threenative/core";
import { DebugOverlay, GameCanvas } from "@threenative/ui";
import type { AbyssState } from "../scenes/Abyss.js";
import { Hud } from "./Hud.js";
import { Veil } from "./Veil.js";

export function App({ game }: { game: Game<AbyssState> }) {
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-ink">
      <GameCanvas className="absolute inset-0" game={game} />
      <Hud game={game} />
      <Veil game={game} />
      <DebugOverlay />
    </main>
  );
}
