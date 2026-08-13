import { ACESFilmicToneMapping, type Camera, type Scene } from "three";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { pass } from "three/tsl";

type OutputRenderer = { kind: string; raw: unknown; setOutputNode(node: unknown): void };

export function setupPost(renderer: OutputRenderer, scene: Scene, camera: Camera): void {
  const raw = renderer.raw as { toneMapping?: number; toneMappingExposure?: number };
  raw.toneMapping = ACESFilmicToneMapping;
  raw.toneMappingExposure = 1.18;
  if (renderer.kind !== "webgpu") return;
  const color = pass(scene, camera).getTextureNode();
  renderer.setOutputNode(color.add(bloom(color, 0.35, 0.5, 0.2)));
}
