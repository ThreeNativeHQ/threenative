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
    jump: { buttons: [0], down: ["Space"] },
    restart: { down: ["KeyR"] },
  },
  plugins: [rapier(), replay(), playtest()],
  render: config.renderer,
  scenes: { boot: Boot, play: Play },
  seed: 90210,
  start: "boot",
});

export default game;
