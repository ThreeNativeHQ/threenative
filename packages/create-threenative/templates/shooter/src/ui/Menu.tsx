import { shooterUi } from "../render/ui.js";

type MenuProps = {
  onRestart: () => void;
  onTogglePause: () => void;
  paused: boolean;
};

export function Menu({ onRestart, onTogglePause, paused }: MenuProps) {
  return (
    <footer className={shooterUi.menu.root}>
      <div className={shooterUi.menu.help}>
        <div className={shooterUi.menu.helpPrimary}>{shooterUi.menu.copy.primary}</div>
        <div className={shooterUi.menu.helpSecondary}>{shooterUi.menu.copy.secondary}</div>
      </div>
      <div className={shooterUi.menu.actions}>
        <button className={shooterUi.menu.button} onClick={onTogglePause} type="button">
          {paused ? shooterUi.menu.copy.resume : shooterUi.menu.copy.pause}
        </button>
        <button className={shooterUi.menu.button} onClick={onRestart} type="button">
          {shooterUi.menu.copy.restart}
        </button>
      </div>
    </footer>
  );
}
