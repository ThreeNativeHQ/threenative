import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { type PhysicsContext, rapier } from "@threenative/physics";
import { Terrain, type TerrainState } from "./scenes/Terrain.js";

const game = defineGame<TerrainState, PhysicsContext>({
  assets: { model: async () => ({}) },
  camera: { far: 1_000, near: 1, projection: "orthogonal", size: 150 },
  input: {
    move: {
      down: ["ArrowDown"],
      left: ["ArrowLeft"],
      right: ["ArrowRight"],
      up: ["ArrowUp"],
    },
  },
  plugins: [rapier(), playtest<TerrainState, PhysicsContext>()],
  renderer: { preferWebGPU: true },
  scenes: { play: Terrain },
  seed: 20260808,
  start: "play",
});

void game.start();
