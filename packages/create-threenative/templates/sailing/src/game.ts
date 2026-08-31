import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import type { IPhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import config from "../threenative.config.js";
import { Boot } from "./scenes/Boot.js";
import { Sailing } from "./scenes/Sailing.js";
import type { GameState } from "./state.js";

const game = defineGame<GameState, IPhysicsContext>({
  input: {
    move: {
      down: ["ArrowDown", "KeyS"],
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      up: ["ArrowUp", "KeyW"],
    },
    capsize: { keys: ["KeyC"] },
    restart: { keys: ["KeyR"] },
  },
  plugins: [rapier({ gravity: { x: 0, y: -9.81, z: 0 } }), playtest()],
  display: config.display,
  render: config.renderer,
  scenes: { boot: Boot, sailing: Sailing },
  seed: 23_600,
  start: "boot",
});

export default game;

game.ui.onIntent((intent) => {
  if (intent === "restart") void game.goto("sailing");
  if (intent === "pause") game.pause();
  if (intent === "resume") game.resume();
  game.state.set({
    uiReady: game.ui.connected,
    ...(intent === "pause" || intent === "resume" ? { paused: intent === "pause" } : {}),
  } as Partial<GameState>);
  game.state.flush();
});
