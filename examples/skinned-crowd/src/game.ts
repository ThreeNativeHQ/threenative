import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { Crowd } from "./scenes/Crowd.js";

/**
 * A crowd of animated rigs written the way any game writes one: ordinary `SkinnedMesh` objects
 * added to the scene, each with its own `AnimationMixer`. Nothing here knows the engine draws
 * them as one palette draw per pass; the scenarios in `playtests/` prove that it does.
 */
const game = defineGame({
  plugins: [playtest()],
  initialState: {},
  render: { preferWebGPU: true },
  scenes: { crowd: Crowd },
  start: "crowd",
});

export default game;
