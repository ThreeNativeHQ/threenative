import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { DebugOverlay, GameCanvas } from "@threenative/ui";
import { shooterUi } from "../render/ui.js";
import type { GameState } from "../state.js";
import { Hud } from "./Hud.js";
import { Menu } from "./Menu.js";

type AppProps = {
  game: IGame<GameState, IPhysicsContext>;
  onRestart: () => void;
  onTogglePause: () => void;
  paused: boolean;
};

export function App({ game, onRestart, onTogglePause, paused }: AppProps) {
  return (
    <main className={shooterUi.app.root}>
      <GameCanvas className={shooterUi.app.canvas} game={game} />
      <Hud game={game} />
      <Menu onRestart={onRestart} onTogglePause={onTogglePause} paused={paused} />
      <DebugOverlay />
    </main>
  );
}
