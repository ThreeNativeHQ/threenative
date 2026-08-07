import type { Camera, Scene } from "three";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { pass } from "three/tsl";

export function createPostProcessing(scene: Scene, camera: Camera) {
  const scenePass = pass(scene, camera);
  const colour = scenePass.getTextureNode();
  return colour.add(bloom(colour, 0.9, 0.5, 0.25));
}
