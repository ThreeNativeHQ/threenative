import { defineGame, replay } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import type { IPhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import config from "../threenative.config.js";
import { drainPlaytestEvents } from "./playtest-events.js";
import { Boot } from "./scenes/Boot.js";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";

const game = defineGame<GameState, IPhysicsContext>({
  input: {
    // The four directions of `input.vector("move")`. Declared rather than inherited from the
    // default binding, so the axis every scene reads is visible where the game is defined.
    move: {
      down: ["ArrowDown", "KeyS"],
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      up: ["ArrowUp", "KeyW"],
    },
    aim: { mouseButtons: [2] },
    blast: { keys: ["KeyE"], buttons: [2] },
    damage: { keys: ["KeyH"] },
    fire: { buttons: [0], keys: ["KeyF"], mouseButtons: [0] },
    look: { pointerRelative: true },
    lethal: { keys: ["KeyX"] },
    probe: { keys: ["KeyC"] },
    projectile: { buttons: [1], keys: ["KeyG"] },
    restart: { keys: ["KeyR"] },
  },
  plugins: [rapier(), replay(), playtest({ events: drainPlaytestEvents })],
  render: config.renderer,
  scenes: { boot: Boot, play: Play },
  seed: 89089,
  start: "boot",
});

export default game;
