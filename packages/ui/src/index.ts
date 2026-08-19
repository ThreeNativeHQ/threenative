/**
 * Mount a ThreeNative game in a React canvas.
 * @situation add a game viewport to a React application
 * @situation connect a game canvas to the web UI shell
 * @constraint keep the portable game entry free of React DOM code
 * @example <GameCanvas game={game} />
 */
export { GameCanvas } from "./GameCanvas.js";
/**
 * Show framework diagnostics while developing a game.
 * @situation display runtime and playtest diagnostics in a React HUD
 * @situation inspect a game without changing its scene
 * @example <DebugOverlay game={game} />
 */
export { DebugOverlay } from "./DebugOverlay.js";
/**
 * Read throttled game state from React.
 * @situation bind a HUD component to game state
 * @situation select a slice of state for a React panel
 * @constraint use this hook only from the web UI entry
 * @example const score = useGameState(game, (state) => state.score);
 */
export { useGameState } from "./useGameState.js";
