import type { Game } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

interface HudProps { game: Game<GameState, PhysicsContext> }

export function Hud({ game }: HudProps) {
  const state = useGameState(game);
  const restart = () => game.state.set({ restartNonce: state.restartNonce + 1, paused: false });
  const goalLabel = state.goalReached ? "GOAL REACHED" : state.coins === state.total ? "GOAL OPEN" : "GOAL AHEAD";
  return (
    <div className="hud" aria-live="polite">
      <section className="objective-card">
        <span className="eyebrow">SUNNY SKY TRAIL</span>
        <strong>{state.goalReached ? "Trail complete!" : state.message}</strong>
        <span className="goal-state">{goalLabel}</span>
        <span className="controls">W / D / ↑ / → RUN · SPACE TO JUMP</span>
      </section>
      <section className="coin-card" aria-label={`${state.coins} of ${state.total} coins collected`}>
        <span className="coin-icon">★</span>
        <span><b>{state.coins}</b> / {state.total}</span>
      </section>
      <section className="hud-actions">
        <button type="button" onClick={() => game.state.set({ paused: !state.paused })}>{state.paused ? "Resume" : "Pause"} <kbd>P</kbd></button>
        <button type="button" onClick={restart}>Restart <kbd>R</kbd></button>
      </section>
      {state.paused && <div className="overlay"><div><span>PAUSED</span><small>The clouds can wait.</small></div></div>}
      {state.goalReached && <div className="win-card"><span>★ TRAIL COMPLETE ★</span><strong>{state.coins} sun coins found</strong><button type="button" onClick={restart}>Play again</button></div>}
      <div className="jump-hint"><kbd>SPACE</kbd><span>JUMP</span></div>
    </div>
  );
}
