import TRAANode from "three/addons/tsl/display/TRAANode.js";
import { startRealismEffectsScene } from "./realism-effects-scene.js";

export function startScene(canvas, dimensions) {
  return startRealismEffectsScene(canvas, dimensions, "TRAAEffect", ({ color, depth, velocity, camera }) => new TRAANode(color, depth, velocity, camera), { temporal: true });
}
