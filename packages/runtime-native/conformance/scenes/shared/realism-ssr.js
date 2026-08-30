import SSRNode from "three/addons/tsl/display/SSRNode.js";
import { float } from "three/tsl";
import { startRealismEffectsScene } from "./realism-effects-scene.js";

export function startScene(canvas, dimensions) {
  return startRealismEffectsScene(canvas, dimensions, "SSREffect", ({ color, depth, normal, camera }) => new SSRNode(color, depth, normal, {
    camera,
    metalnessNode: float(0.35),
    reflectNonMetals: true,
    roughnessNode: float(0.22),
  }));
}
