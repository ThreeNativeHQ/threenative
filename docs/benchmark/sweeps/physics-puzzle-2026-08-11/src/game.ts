import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import type { PhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";

const game = defineGame<GameState, PhysicsContext>({
  plugins: [rapier({ gravity: { x: 0, y: -9.81, z: 0 } }), playtest()],
  scenes: { play: Play },
  seed: 6132,
  start: "play",
});

export default game;
