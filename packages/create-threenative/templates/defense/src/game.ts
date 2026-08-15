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
    overlapTest: { down: ["KeyO"] },
    restart: { down: ["KeyR"] },
    routeTest: { down: ["KeyX"] },
    safeBuild: { down: ["KeyB"] },
  },
  plugins: [rapier({ gravity: { x: 0, y: -9.8, z: 0 } }), playtest({ events })],
  render: config.renderer,
  scenes: { boot: Boot, defense: Defense },
  seed: 92092,
  start: "boot",
});
