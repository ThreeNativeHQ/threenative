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
/**
 * Render a game's UI so the same source runs on web and on every native target.
 * @situation write one HUD that looks the same on the web build and on a phone
 * @situation mount a React UI over the game surface on Android or iOS
 * @constraint mark every control the player touches with data-tn-interactive
 * @example <UiLayer><Hud /></UiLayer>
 */
export { UiLayer } from "./UiLayer.js";
/**
 * Read the game's published state from a UI that may be in another process.
 * @situation bind a HUD to game state on web and native alike
 * @situation show score or health in a UI rendered over the game surface
 * @constraint returns undefined until the game publishes its first state
 * @example const score = useUiState((state) => state.score);
 */
export { useUiState } from "./UiLayer.js";
/**
 * Send a player action from the UI back to the game.
 * @situation wire a Restart button in a HUD to the running game
 * @situation pause a game from a menu rendered over its surface
 * @constraint the game decides what each intent name means; it may ignore one
 * @example const send = useUiIntent(); send("restart");
 */
export { useUiIntent } from "./UiLayer.js";
