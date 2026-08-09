import { defineGame, replay } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { Boot } from "./scenes/Boot.js";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";

const game = defineGame<GameState>({
  camera: { projection: "perspective", fov: 55, near: 0.1, far: 1100 },
  input: {
    move: {
      down: ["KeyS", "ArrowDown"],
      left: ["KeyA", "ArrowLeft"],
      right: ["KeyD", "ArrowRight"],
      up: ["KeyW", "ArrowUp"],
    },
    restart: { down: ["KeyR"] },
  },
  plugins: [replay(), playtest()],
  scenes: { boot: Boot, play: Play },
  seed: 31003,
  start: "boot",
});

export default game;
