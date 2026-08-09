import { defineGame, replay } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import type { PhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import { Boot } from "./scenes/Boot.js";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";

const game = defineGame<GameState, PhysicsContext>({
  input: {
    jump: { buttons: [0], down: ["Space"] },
    restart: { down: ["KeyR"] },
  },
  plugins: [rapier(), replay(), playtest()],
  scenes: { boot: Boot, play: Play },
  seed: 90210,
  start: "boot",
});

export default game;
