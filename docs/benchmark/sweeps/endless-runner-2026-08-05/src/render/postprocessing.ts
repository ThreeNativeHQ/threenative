// Generated for you: ordinary Three.js; ThreeNative does not read this file.
import { ACESFilmicToneMapping, type Camera, type Scene } from "three";
import { pass } from "three/tsl";
import { RenderPipeline, type WebGPURenderer } from "three/webgpu";
export function setupPost(renderer: WebGPURenderer, scene: Scene, camera: Camera): void {
  renderer.toneMapping = ACESFilmicToneMapping;
  if (renderer.isWebGPURenderer !== true) return;
  const pipeline = new RenderPipeline(renderer, pass(scene, camera));
  const originalRender = renderer.render.bind(renderer);
  const pipelineRender = () => {
    renderer.render = originalRender;
    try {
      pipeline.render();
    } finally {
      renderer.render = pipelineRender;
    }
  };
  renderer.render = pipelineRender;
}
