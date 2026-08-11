import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import type { IPhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import config from "../threenative.config.js";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";

const game = defineGame<GameState, IPhysicsContext>({
  // `playtest()` installs the bridge a scenario needs to observe entities and state. Without
  // it, semantic assertions fail closed with TN_PLAYTEST_BRIDGE_MISSING rather than passing.
  plugins: [rapier(), playtest()],
  render: config.renderer,
  scenes: { play: Play },
  start: "play",
});

export default game;
