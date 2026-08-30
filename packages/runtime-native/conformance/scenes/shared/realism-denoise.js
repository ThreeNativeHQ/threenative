import DenoiseNode from "three/addons/tsl/display/DenoiseNode.js";
import { startRealismEffectsScene } from "./realism-effects-scene.js";

export function startScene(canvas, dimensions) {
  return startRealismEffectsScene(canvas, dimensions, "PoissonDenoisePass", ({ color, depth, normal, camera }) => new DenoiseNode(color, depth, normal, camera));
}
