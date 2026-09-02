import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import type { IPhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import config from "../threenative.config.js";
import { drainPlaytestEvents as events } from "./playtest-events.js";
import { Boot } from "./scenes/Boot.js";
import { Level } from "./scenes/Level.js";
import type { GameState } from "./state.js";
const game = defineGame<GameState, IPhysicsContext>({
  input: {
    // The four directions of `input.vector("move")`. Declared rather than inherited from the
    // default binding, so the axis every scene reads is visible where the game is defined.
    move: {
      down: ["ArrowDown", "KeyS"],
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      up: ["ArrowUp", "KeyW"],
    },
    dash: { buttons: [7], keys: ["ShiftLeft", "ShiftRight"] },
    jump: { buttons: [0], keys: ["Space"] },
  },
  plugins: [rapier({ gravity: { x: 0, y: -26, z: 0 } }), playtest({ events })],
  display: config.display,
  render: config.renderer,
  scenes: { boot: Boot, level: Level },
  // Start at the playable scene so runner setup can reach Level.load() before Level.enter().
  // Boot remains available as a simple transition scene for callers that want one explicitly.
  start: "level",
});

export default game;

/**
 * What the UI can ask the game to do.
 *
 * Intents are one-way and named by the game: the UI sends `restart`, `pause` or `resume` and the
 * game decides what each means. Nothing comes back this way — the UI reads the game's published
 * state instead, which keeps one source of truth on the side that owns the simulation.
 */
game.ui.onIntent((intent) => {
  if (intent === "restart") void game.goto("level");
  if (intent === "pause") game.pause();
  if (intent === "resume") game.resume();
  game.state.set({
    // `game.ui.connected` is true only once the UI announced itself, which is what tells an
    // overlay that never came up apart from a game whose HUD is simply empty.
    uiReady: game.ui.connected,
    ...(intent === "pause" || intent === "resume" ? { paused: intent === "pause" } : {}),
  });
  game.state.flush();
});
