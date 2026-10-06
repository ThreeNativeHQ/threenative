export * from "./core-three.mjs";
import { unsupported } from "./core-three.mjs";

// Core still owns createRenderer/wrapRenderer; the player owns the GPU and draws these handles.
export class WebGPURenderer {
  constructor({ canvas }) { this.domElement = canvas; }
  setPixelRatio() {}
  setSize(width, height) {
    this.domElement.width = width;
    this.domElement.height = height;
  }
  render(scene, camera) {
    globalThis.tn.scene = scene;
    globalThis.tn.camera = camera;
  }
  dispose() {}
}

export const RenderPipeline = unsupported;
export const StorageBufferAttribute = unsupported;
export const MeshBasicNodeMaterial = unsupported;
export const MeshLambertNodeMaterial = unsupported;
export const MeshMatcapNodeMaterial = unsupported;
export const MeshNormalNodeMaterial = unsupported;
export const MeshPhongNodeMaterial = unsupported;
export const MeshPhysicalNodeMaterial = unsupported;
export const MeshStandardNodeMaterial = unsupported;
export const MeshToonNodeMaterial = unsupported;
