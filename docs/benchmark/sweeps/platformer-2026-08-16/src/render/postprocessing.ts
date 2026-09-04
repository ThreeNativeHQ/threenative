// Generated for you: ordinary Three.js; ThreeNative does not read this file.
import { ACESFilmicToneMapping, type Camera, type Scene } from "three";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { pass } from "three/tsl";
type OutputRenderer = {
  kind: string;
  raw: unknown;
  setOutputNode(node: unknown): void;
};

export function setupPost(renderer: OutputRenderer, scene: Scene, camera: Camera): void {
  const raw = renderer.raw as { toneMapping?: number; toneMappingExposure?: number };
  raw.toneMapping = ACESFilmicToneMapping;
  raw.toneMappingExposure = 1.06;
  if (renderer.kind !== "webgpu") return;
  // A high threshold, because a sunny sky is *everywhere* above the midpoint:
  // the starter's 0.2 threshold blooms the entire frame into milk. This picks
  // out the coins and the goal ring and leaves the grass alone.
  const colour = pass(scene, camera).getTextureNode();
  renderer.setOutputNode(colour.add(bloom(colour, 0.32, 0.6, 0.88)));
}
