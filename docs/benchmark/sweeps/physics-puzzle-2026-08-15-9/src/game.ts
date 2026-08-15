import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import type { IPhysicsContext } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import config from "../threenative.config.js";
import { WORLD_SEED } from "./level/layout.js";
import { Play } from "./scenes/Play.js";
import type { GameState } from "./state.js";

// game.state is the single store: the fixed-step loop writes it, and React and
// playtests read it. `state.replayPhase` and `state.replayMatch` live there.
const game = defineGame<GameState, IPhysicsContext>({
  input: {
    move: {
      down: ["ArrowDown", "KeyS"],
      left: ["ArrowLeft", "KeyA"],
      right: ["ArrowRight", "KeyD"],
      up: ["ArrowUp", "KeyW"],
    },
    // Starts the two-run determinism check.
    replay: { down: ["KeyV"] },
    restart: { down: ["KeyR"] },
  },
  // `deterministicRestart` is what makes the replay check mean anything: without
  // a pristine world per scene entry the solver, island manager and broad phase
  // carry state from the previous run and an identical layout settles
  // differently, so two runs would disagree for a reason that is not the game's.
  plugins: [rapier({ deterministicRestart: true }), playtest()],
  render: config.renderer,
  scenes: { play: Play },
  seed: WORLD_SEED,
  start: "play",
  // The HUD is a readout of the simulation, so keep the store fresh enough that
  // a screenshot and the numbers beside it describe the same frame.
  stateFlushMs: 50,
  // Fixed simulation step. Every update sees exactly this dt, never a frame time.
  step: 1 / 60,
});

export default game;
