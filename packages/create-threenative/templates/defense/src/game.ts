import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { rapier } from "@threenative/physics";
import config from "../threenative.config.js";
import type { DefensePhysics } from "./physics.js";
import { drainPlaytestEvents as events } from "./playtest-events.js";
import { Boot } from "./scenes/Boot.js";
import { Defense } from "./scenes/Defense.js";
import type { GameState } from "./state.js";

export default defineGame<GameState, DefensePhysics>({
  input: {
    build: { pointer: true },
    move: {
      down: ["ArrowDown", "KeyS"],
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      up: ["ArrowUp", "KeyW"],
    },
    overlapTest: { keys: ["KeyO"] },
    restart: { keys: ["KeyR"] },
    routeTest: { keys: ["KeyX"] },
    safeBuild: { keys: ["KeyB"] },
  },
  plugins: [rapier({ gravity: { x: 0, y: -9.8, z: 0 } }), playtest({ events })],
  render: config.renderer,
  scenes: { boot: Boot, defense: Defense },
  seed: 92092,
  start: "boot",
});

/**
 * What the UI can ask the game to do.
 *
 * Intents are one-way and named by the game: the UI sends `restart`, `pause` or `resume` and the
 * game decides what each means. Nothing comes back this way — the UI reads the game's published
 * state instead, which keeps one source of truth on the side that owns the simulation.
 */
game.ui.onIntent((intent) => {
  if (intent === "restart") void game.goto("defense");
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
