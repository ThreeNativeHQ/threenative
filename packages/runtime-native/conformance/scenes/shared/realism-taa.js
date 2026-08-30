import SSAAPassNode from "three/addons/tsl/display/SSAAPassNode.js";
import TRAANode from "three/addons/tsl/display/TRAANode.js";
import { startRealismEffectsScene } from "./realism-effects-scene.js";

export function startScene(canvas, dimensions) {
  return startRealismEffectsScene(canvas, dimensions, "TAAPass", ({ camera, depth, scene, velocity }) => {
    const ssaa = new SSAAPassNode(scene, camera);
    const traaInput = ssaa.getTextureNode("output");
    return new TRAANode(traaInput, depth, velocity, camera);
  }, { temporal: true });
}
