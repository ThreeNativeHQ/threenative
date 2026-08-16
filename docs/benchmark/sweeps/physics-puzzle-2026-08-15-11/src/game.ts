import { defineGame, replay } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import type { IPhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import config from "../threenative.config.js";
import { Boot } from "./scenes/Boot.js";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";

const game = defineGame<GameState, IPhysicsContext>({
  input: {
    move: {
      up: ["KeyW", "ArrowUp"],
      down: ["KeyS", "ArrowDown"],
      left: ["KeyA", "ArrowLeft"],
      right: ["KeyD", "ArrowRight"],
    },
    restart: { down: ["KeyR"] },
  },
  // deterministicRestart gives each run a pristine solver: without it the same
  // authored layout settles differently after a restart, because the island
  // manager and broad phase carry state from the previous run.
  plugins: [rapier({ deterministicRestart: true }), replay(), playtest()],
  render: config.renderer,
  scenes: { boot: Boot, play: Play },
  seed: 90210,
  start: "boot",
  // Fixed simulation step. Every update sees exactly this dt, which is half of
  // what makes two runs of the same seed agree.
  step: 1 / 60,
});

export default game;
