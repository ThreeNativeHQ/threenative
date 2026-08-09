import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { rapier } from "@threenative/physics";
import { drainPlaytestEvents as events } from "./playtest-events.js";
import { Boot } from "./scenes/Boot.js";
import { Level } from "./scenes/Level.js";
export default defineGame({
  input: {
    dash: { buttons: [7], down: ["ShiftLeft", "ShiftRight"] },
    jump: { buttons: [0], down: ["Space"] },
  },
  plugins: [rapier({ gravity: { x: 0, y: -26, z: 0 } }), playtest({ events })],
  scenes: { boot: Boot, level: Level },
  start: "boot",
});
