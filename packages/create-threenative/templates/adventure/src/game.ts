import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import config from "../threenative.config.js";
import { sendSceneIntent } from "./orders.js";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";

// game.state is the single store: the fixed-step loop writes it, and React and the playtest read it.
const game = defineGame<GameState, undefined>({
  camera: { far: 160, fov: 52, near: 0.08, projection: "perspective" },
  input: {
    // The four directions of `input.vector("move")`. Declared rather than inherited, so the axis the
    // scene reads is visible where the game is defined.
    move: {
      down: ["ArrowDown", "KeyS"],
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      up: ["ArrowUp", "KeyW"],
    },
    // Mouse look as a relative axis: the framework owns the pointer lock and the per-tick delta.
    // A click on the canvas captures the mouse; Escape gives it back.
    look: { pointerRelative: true },
    // Wheel, pinch and the right stick share one camera-distance intent.
    zoom: { gamepadAxes: [3], pinch: true, scroll: true },
    attack: { keys: ["KeyJ"], mouseButtons: [0] },
    block: { keys: ["KeyK"], mouseButtons: [2] },
    dodge: { keys: ["Space"] },
    interact: { keys: ["KeyE", "Enter"] },
    lockOn: { keys: ["KeyQ"] },
    sprint: { keys: ["ShiftLeft", "ShiftRight"] },
    recenter: { keys: ["KeyR"] },
    hideUi: { keys: ["KeyC"] },
    mute: { keys: ["KeyM"] },
    pause: { keys: ["KeyH", "Escape"] },
  },
  // `playtest()` installs the bridge a scenario needs to observe entities and state. Without it,
  // semantic assertions fail closed with TN_PLAYTEST_BRIDGE_MISSING rather than passing.
  plugins: [playtest()],
  display: config.display,
  render: config.renderer,
  scenes: { play: Play },
  seed: 473,
  start: "play",
});

export default game;

/**
 * What the UI can ask the game to do.
 *
 * Intents are one-way and named by the game: the UI sends `continue`, `stay` or `newGame` and the
 * scene decides what each means. Nothing comes back this way — the HUD reads the published state.
 */
game.ui.onIntent((intent, payload) => {
  game.state.set({ uiReady: game.ui.connected });
  game.state.flush();
  sendSceneIntent(intent, payload);
});
