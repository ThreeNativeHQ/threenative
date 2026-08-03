import type { Game } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

export function Hud({ game }: { game: Game<GameState, PhysicsContext> }) {
  const score = useGameState(game, (state) => state.score);
  const playerX = useGameState(game, (state) => state.playerX);
  return (
    <div className="pointer-events-none absolute inset-0 p-6 font-mono text-cyan-100">
      <div className="text-4xl tabular-nums text-cyan-300">{score}</div>
      <div className="mt-2 text-sm tabular-nums text-slate-300">x {playerX.toFixed(2)}</div>
    </div>
  );
}
