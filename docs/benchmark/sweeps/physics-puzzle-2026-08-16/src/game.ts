import { defineGame, replay } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import type { IPhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import config from "../threenative.config.js";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";

const game = defineGame<GameState, IPhysicsContext>({
  input: {
    jump: { buttons: [0], down: ["Space"] },
    restart: { down: ["KeyR"] },
    // Runs the scripted sequence twice and reports whether the worlds matched.
    verify: { down: ["KeyV"] },
  },
  // The loop is fixed-step: one 1/60 s update per simulation step, at most
  // five per rendered frame. Gameplay never sees a variable dt.
  maxSteps: 5,
  step: 1 / 60,
  plugins: [rapier(), replay(), playtest()],
  render: config.renderer,
  scenes: { play: Play },
  seed: 90210,
  start: "play",
});

export default game;
