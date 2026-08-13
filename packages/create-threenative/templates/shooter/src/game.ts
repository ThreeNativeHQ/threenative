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
    blast: { down: ["KeyE"], buttons: [2] },
    damage: { down: ["KeyH"] },
    fire: { buttons: [0], down: ["KeyF"], pointer: true },
    lethal: { down: ["KeyX"] },
    probe: { down: ["KeyC"] },
    projectile: { buttons: [1], down: ["KeyG"] },
    restart: { down: ["KeyR"] },
  },
  plugins: [rapier(), replay(), playtest({ events: drainPlaytestEvents })],
  render: config.renderer,
  scenes: { boot: Boot, play: Play },
  seed: 89089,
  start: "boot",
});

export default game;
