import { defineGame } from "@threenative/core";
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
    ability: { buttons: [1], down: ["KeyE"] },
    attack: { buttons: [0], down: ["Space", "KeyF"] },
    damage: { down: ["KeyH"] },
    dropProbe: { down: ["KeyT"] },
    equip: { down: ["KeyQ"] },
    fill: { down: ["KeyP"] },
    lethal: { down: ["KeyX"] },
    loot: { down: ["KeyL"] },
    restart: { down: ["KeyR"] },
    save: { down: ["KeyC"] },
    unequip: { down: ["KeyU"] },
  },
  plugins: [rapier({ gravity: { x: 0, y: 0, z: 0 } }), playtest({ events: drainPlaytestEvents })],
  render: config.renderer,
  scenes: { boot: Boot, play: Play },
  seed: 93093,
  start: "boot",
});

export default game;
