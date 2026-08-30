import SSGINode from "three/addons/tsl/display/SSGINode.js";
import { startRealismEffectsScene } from "./realism-effects-scene.js";

export function startScene(canvas, dimensions) {
  return startRealismEffectsScene(canvas, dimensions, "SSGIEffect", ({ color, depth, normal, camera }) => new SSGINode(color, depth, normal, camera));
}
