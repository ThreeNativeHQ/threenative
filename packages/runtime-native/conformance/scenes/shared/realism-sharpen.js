import SharpenNode from "three/addons/tsl/display/SharpenNode.js";
import { startRealismEffectsScene } from "./realism-effects-scene.js";

export function startScene(canvas, dimensions) {
  return startRealismEffectsScene(canvas, dimensions, "SharpnessEffect", ({ color }) => new SharpenNode(color, 0.45, false));
}
