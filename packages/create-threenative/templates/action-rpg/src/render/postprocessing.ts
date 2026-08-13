import { ACESFilmicToneMapping, type Camera, type Scene } from "three";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { pass } from "three/tsl";

type OutputRenderer = {
  readonly kind: string;
  readonly raw: unknown;
  setOutputNode(node: unknown): void;
};

export function setupPost(renderer: OutputRenderer, scene: Scene, camera: Camera): void {
  const raw = renderer.raw as { toneMapping?: number; toneMappingExposure?: number };
  raw.toneMapping = ACESFilmicToneMapping;
  raw.toneMappingExposure = 1.08;
  if (renderer.kind !== "webgpu") return;
  const colour = pass(scene, camera).getTextureNode();
  renderer.setOutputNode(colour.add(bloom(colour, 0.72, 0.42, 0.18)));
}
