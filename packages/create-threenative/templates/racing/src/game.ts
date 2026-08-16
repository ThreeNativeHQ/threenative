import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { type IPhysicsContext, rapier } from "@threenative/physics";
import config from "../threenative.config.js";
import { drainPlaytestEvents as events } from "./playtest-events.js";
import { Boot } from "./scenes/Boot.js";
import { Race } from "./scenes/Race.js";
import type { GameState } from "./state.js";

export default defineGame<GameState, IPhysicsContext>({
  input: {
    // The four directions of `input.vector("move")`. Declared rather than inherited from the
    // default binding, so the axis every scene reads is visible where the game is defined.
    move: {
      down: ["ArrowDown", "KeyS"],
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      up: ["ArrowUp", "KeyW"],
    },
    brake: { buttons: [1], keys: ["ShiftLeft", "ShiftRight"] },
    boost: { buttons: [0], keys: ["Space"] },
    restart: { keys: ["KeyR"] },
  },
  plugins: [rapier({ gravity: { x: 0, y: -24, z: 0 } }), playtest({ events })],
  render: config.renderer,
  scenes: { boot: Boot, race: Race },
  seed: 90210,
  start: "boot",
});
