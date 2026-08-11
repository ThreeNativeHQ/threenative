import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { DebugOverlay, GameCanvas } from "@threenative/ui";
import type { TerrainState } from "../scenes/TerrainProbe.js";

export function TerrainApp({ game }: { game: IGame<TerrainState, IPhysicsContext> }) {
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black">
      <GameCanvas className="absolute inset-0" game={game} />
      <DebugOverlay />
    </main>
  );
}
