import { defineGame } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";

const game = defineGame<GameState, PhysicsContext>({
  plugins: [rapier()],
  scenes: { play: Play },
  start: "play",
});

export default game;
