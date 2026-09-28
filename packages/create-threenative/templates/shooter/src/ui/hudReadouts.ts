import type { GameState } from "../state.js";

/** The header roster is five a side, per the design sheet's "5 vs 5". */
export const ROSTER_SIZE = 5;

/**
 * Everything both HUDs display, derived once.
 *
 * `Hud.tsx` draws this with Tailwind in the browser and `NativeHud.tsx` draws it with geometry on
 * a phone. The two renderers have nothing in common below React, which is exactly why the numbers
 * they show have to come from one place — a clock that rounds differently or a low-health
 * threshold that drifts by a point would be invisible until someone put the two screens
 * side by side.
 *
 * Pure: no hooks, no game object, no clock of its own. Give it a published state, get the strings.
 */
export function hudReadouts(state: GameState) {
  const soldiersDown = state.blips.reduce((total, blip) => total + (blip.alive ? 0 : 1), 0);
  const clockSeconds = Math.max(0, Math.floor(state.timeRemaining));
  return {
    roster: ROSTER_SIZE,
    soldiersDown,
    soldiersStanding: Math.max(0, ROSTER_SIZE - soldiersDown),
    clockMinutes: Math.floor(clockSeconds / 60),
    clockPart: String(clockSeconds % 60).padStart(2, "0"),
    health: Math.round(state.health),
    healthPercent: Math.min(100, Math.max(0, state.health)),
    lowHealth: state.health < 35,
    paddedScore: String(state.score).padStart(4, "0"),
    money: 10_000,
    /**
     * Boot progress, capped at 92% until the scene reports itself built so the bar never sits
     * full while the first frame is still being drawn.
     */
    loadFraction:
      state.assetsTotal === 0
        ? 0
        : Math.min(0.92, state.assetsLoaded / Math.max(state.assetsTotal, 1)),
  };
}
