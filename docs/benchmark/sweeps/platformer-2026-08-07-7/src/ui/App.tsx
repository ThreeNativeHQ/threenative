import type { Game } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { GameCanvas } from "@threenative/ui";
import type { GameState } from "../state.js";
import { Hud } from "./Hud.js";

interface AppProps { game: Game<GameState, PhysicsContext> }

export function App({ game }: AppProps) {
  return (
    <main className="game-shell">
      <GameCanvas game={game} className="game-canvas" />
      <Hud game={game} />
    </main>
  );
}
