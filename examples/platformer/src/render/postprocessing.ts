// Ordinary Three.js. Everything a screenshot shows lives here, in the game.
import { type Camera, NeutralToneMapping, type Scene } from "three";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { pass } from "three/tsl";
import { RenderPipeline, type WebGPURenderer } from "three/webgpu";

/**
 * Neutral tone mapping (saturation survives it — ACES would grey the palette
 * out) plus a high-threshold bloom, so only the coins, gems and sky rim glow.
 *
 * The pipeline is installed by wrapping `renderer.render`, because the core's
 * loop is what calls it and the loop is not ours to edit.
 */
export function setupPost(renderer: WebGPURenderer, scene: Scene, camera: Camera): void {
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.16;
  if (renderer.isWebGPURenderer !== true) return;

  const pipeline = new RenderPipeline(renderer);
  const colour = pass(scene, camera).getTextureNode();
  pipeline.outputNode = colour.add(bloom(colour, 0.32, 0.45, 0.92));

  const original = renderer.render.bind(renderer);
  const wrapped = () => {
    renderer.render = original;
    try {
      pipeline.render();
    } finally {
      renderer.render = wrapped;
    }
  };
  renderer.render = wrapped;
}
