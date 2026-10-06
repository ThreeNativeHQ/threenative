import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import { rapier } from "@threenative/physics";
import type { IPhysicsContext } from "@threenative/physics";
import { Animals, type IAnimalsState } from "./Animals.js";
export default defineGame<IAnimalsState, IPhysicsContext>({
  assets: { basePath: "" },
  plugins: [rapier(), playtest()],
  render: { preferWebGPU: true },
  scenes: { animals: Animals },
  start: "animals",
  seed: 7,
});
