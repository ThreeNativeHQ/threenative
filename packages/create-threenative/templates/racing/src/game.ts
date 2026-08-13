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
    brake: { buttons: [1], down: ["ShiftLeft", "ShiftRight"] },
    boost: { buttons: [0], down: ["Space"] },
    restart: { down: ["KeyR"] },
  },
  plugins: [rapier({ gravity: { x: 0, y: -24, z: 0 } }), playtest({ events })],
  render: config.renderer,
  scenes: { boot: Boot, race: Race },
  seed: 90210,
  start: "boot",
});
