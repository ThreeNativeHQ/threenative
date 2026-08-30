import TemporalReprojectNode from "three/addons/tsl/display/TemporalReprojectNode.js";
import { startRealismEffectsScene } from "./realism-effects-scene.js";

export function startScene(canvas, dimensions) {
  return startRealismEffectsScene(canvas, dimensions, "TemporalReprojectPass", ({ color, depth, normal, velocity, camera }) => new TemporalReprojectNode(color, depth, normal, velocity, camera, { accumulate: true }), { temporal: true });
}
