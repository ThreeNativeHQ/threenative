import { useUiIntent, useUiState } from "@threenative/ui";
import { shooterUi } from "../render/ui.js";
import type { GameState } from "../state.js";

/**
 * `data-tn-interactive` marks the two controls the player touches. The native input host publishes
 * those rectangles and decides, on pointer-down, whether a touch belongs to the UI or to the game
 * underneath; everything unmarked is scenery a touch passes straight through.
 */
export function Menu() {
  const send = useUiIntent();
  const paused = useUiState<GameState, boolean>((state) => state.paused) ?? false;
  const onTogglePause = () => send(paused ? "resume" : "pause");
  const onRestart = () => send("restart");
  return (
    <footer className={shooterUi.menu.root}>
      <div className={shooterUi.menu.help}>
        <div className={shooterUi.menu.helpPrimary}>{shooterUi.menu.copy.primary}</div>
        <div className={shooterUi.menu.helpSecondary}>{shooterUi.menu.copy.secondary}</div>
      </div>
      <div className={shooterUi.menu.actions}>
        <button
          className={shooterUi.menu.button}
          data-tn-interactive
          onClick={onTogglePause}
          type="button"
        >
          {paused ? shooterUi.menu.copy.resume : shooterUi.menu.copy.pause}
        </button>
        <button
          className={shooterUi.menu.button}
          data-tn-interactive
          onClick={onRestart}
          type="button"
        >
          {shooterUi.menu.copy.restart}
        </button>
      </div>
    </footer>
  );
}
