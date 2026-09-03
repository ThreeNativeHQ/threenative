import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { rapier } from "@threenative/physics";
import config from "../threenative.config.js";
import type { PuzzlePhysics } from "./physics.js";
import { Boot } from "./scenes/Boot.js";
import { Puzzle } from "./scenes/Puzzle.js";
import type { GameState } from "./state.js";

const game = defineGame<GameState, PuzzlePhysics>({
  input: {
    move: {
      down: ["ArrowDown", "KeyS"],
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      up: ["ArrowUp", "KeyW"],
    },
    grab: { keys: ["KeyE", "Space"] },
    restart: { keys: ["KeyR"] },
    swing: { keys: ["KeyF"] },
  },
  plugins: [rapier({ gravity: { x: 0, y: -9.81, z: 0 } }), playtest()],
  display: config.display,
  render: config.renderer,
  scenes: { boot: Boot, puzzle: Puzzle },
  seed: 51_204,
  start: "boot",
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
  if (intent === "restart") void game.goto("puzzle");
  if (intent === "pause") game.pause();
  if (intent === "resume") game.resume();
  game.state.set({
    uiReady: game.ui.connected,
    ...(intent === "pause" || intent === "resume" ? { paused: intent === "pause" } : {}),
  });
  game.state.flush();
});
