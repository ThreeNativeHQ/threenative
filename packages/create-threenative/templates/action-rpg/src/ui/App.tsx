import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { DebugOverlay, GameCanvas } from "@threenative/ui";
import type { GameState } from "../state.js";
import { AbilityBar } from "./AbilityBar.js";
import { CharacterPanel } from "./CharacterPanel.js";
import { Hud } from "./Hud.js";
import { InventoryPanel } from "./InventoryPanel.js";

export function App({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-void">
      <GameCanvas className="absolute inset-0" game={game} />
      <Hud game={game} />
      <CharacterPanel game={game} />
      <InventoryPanel game={game} />
      <AbilityBar game={game} />
      <DebugOverlay />
    </main>
  );
}
