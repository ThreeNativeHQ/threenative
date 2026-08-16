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
    // The four directions of `input.vector("move")`. Declared rather than inherited from the
    // default binding, so the axis every scene reads is visible where the game is defined.
    move: {
      down: ["ArrowDown", "KeyS"],
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      up: ["ArrowUp", "KeyW"],
    },
    ability: { buttons: [1], keys: ["KeyE"] },
    attack: { buttons: [0], keys: ["Space", "KeyF"] },
    damage: { keys: ["KeyH"] },
    dropProbe: { keys: ["KeyT"] },
    equip: { keys: ["KeyQ"] },
    fill: { keys: ["KeyP"] },
    lethal: { keys: ["KeyX"] },
    loot: { keys: ["KeyL"] },
    restart: { keys: ["KeyR"] },
    save: { keys: ["KeyC"] },
    unequip: { keys: ["KeyU"] },
  },
  plugins: [rapier({ gravity: { x: 0, y: 0, z: 0 } }), playtest({ events: drainPlaytestEvents })],
  render: config.renderer,
  scenes: { boot: Boot, play: Play },
  seed: 93093,
  start: "boot",
});

export default game;
