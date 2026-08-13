// Generated for you: ordinary Three.js postprocessing, owned by this game.
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
  raw.toneMappingExposure = 1.12;
  if (renderer.kind !== "webgpu") return;
  const colour = pass(scene, camera).getTextureNode();
  renderer.setOutputNode(colour.add(bloom(colour, 0.75, 0.48, 0.2)));
}
