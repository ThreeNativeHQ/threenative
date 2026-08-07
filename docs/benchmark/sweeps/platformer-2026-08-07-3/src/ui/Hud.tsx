import type { Game } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

interface HudProps { game: Game<GameState, PhysicsContext> }

export function Hud({ game }: HudProps) {
  const state = useGameState(game);
  const restart = () => game.state.set({ restartNonce: state.restartNonce + 1, paused: false });
  return (
    <div className="hud" aria-live="polite">
      <section className="objective-card">
        <span className="eyebrow">SUNNY SKY TRAIL</span>
        <strong>{state.status === "won" ? "Trail complete!" : state.message}</strong>
        <span className="controls">WASD / ARROWS · SPACE TO JUMP</span>
      </section>
      <section className="coin-card" aria-label={`${state.collected} of ${state.total} coins collected`}>
        <span className="coin-icon">★</span>
        <span><b>{state.collected}</b> / {state.total}</span>
      </section>
      <section className="hud-actions">
        <button type="button" onClick={() => game.state.set({ paused: !state.paused })}>{state.paused ? "Resume" : "Pause"} <kbd>P</kbd></button>
        <button type="button" onClick={restart}>Restart <kbd>R</kbd></button>
      </section>
      {state.paused && <div className="overlay"><div><span>PAUSED</span><small>The clouds can wait.</small></div></div>}
      {state.status === "won" && <div className="win-card"><span>★ TRAIL COMPLETE ★</span><strong>{state.collected} sun coins found</strong><button type="button" onClick={restart}>Play again</button></div>}
      <div className="jump-hint"><kbd>SPACE</kbd><span>JUMP</span></div>
    </div>
  );
}
