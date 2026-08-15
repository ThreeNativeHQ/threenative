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
  raw.toneMappingExposure = 1.05;
  if (renderer.kind !== "webgpu") return;
  const colour = pass(scene, camera).getTextureNode();
  // Threshold high enough that only the emissive cyan blooms: at 0.2 the lit
  // wood blew out too and every crate read as one white shape.
  renderer.setOutputNode(colour.add(bloom(colour, 0.5, 0.45, 0.62)));
}
