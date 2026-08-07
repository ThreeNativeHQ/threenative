import type { Game } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

export function Hud({ game }: { game: Game<GameState, PhysicsContext> }) {
  const coins = useGameState(game, (state) => state.coins);
  const totalCoins = useGameState(game, (state) => state.totalCoins);
  const goalReached = useGameState(game, (state) => state.goalReached);
  const progress = totalCoins === 0 ? 0 : Math.round((coins / totalCoins) * 100);

  return (
    <>
      <header className="hud-brand" aria-label="Skybound Trail">
        <div className="brand-mark">✦</div>
        <div>
          <div className="brand-kicker">SKYBOUND TRAIL</div>
          <h1>Find the Star Gate</h1>
        </div>
      </header>

      <section className="hud-stats" aria-label="Adventure progress">
        <div className="hud-stat">
          <span className="stat-icon coin-icon">✦</span>
          <div>
            <span className="stat-label">sun coins</span>
            <strong>
              {coins} <small>/ {totalCoins}</small>
            </strong>
          </div>
        </div>
        <div className="hud-stat">
          <span className="stat-icon gate-icon">◇</span>
          <div>
            <span className="stat-label">gate route</span>
            <strong>{goalReached ? "OPEN" : `${progress}%`}</strong>
          </div>
        </div>
      </section>

      <div className="objective-pill">
        <span className="objective-dot" />
        Collect the trail · reach the golden gate
      </div>

      {goalReached ? (
        <div className="goal-callout" role="status">
          <span>★ Trail complete</span>
          <small>The sky path is yours</small>
        </div>
      ) : null}
    </>
  );
}
