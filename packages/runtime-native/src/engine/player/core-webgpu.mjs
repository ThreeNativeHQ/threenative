export * from "./core-three.mjs";
import { unsupported } from "./core-three.mjs";
import { syncUniforms } from "./core-tsl.mjs";

export const { MeshBasicNodeMaterial, MeshStandardNodeMaterial, SpriteNodeMaterial } = globalThis;
Object.setPrototypeOf(MeshBasicNodeMaterial.prototype, globalThis.MeshBasicMaterial.prototype);
Object.setPrototypeOf(MeshStandardNodeMaterial.prototype, globalThis.MeshStandardMaterial.prototype);
Object.setPrototypeOf(SpriteNodeMaterial.prototype, globalThis.SpriteMaterial.prototype);
for (const material of [MeshBasicNodeMaterial, MeshStandardNodeMaterial, SpriteNodeMaterial]) {
  material.prototype.isNodeMaterial = true;
  material.prototype[`is${material.name}`] = true;
}

// Core still owns createRenderer/wrapRenderer; the player owns the GPU and draws these handles.
export class WebGPURenderer {
  constructor({ canvas }) { this.domElement = canvas; }
  setPixelRatio() {}
  setSize(width, height) {
    this.domElement.width = width;
    this.domElement.height = height;
  }
  getDrawingBufferSize(target) { return target.set(this.domElement.width, this.domElement.height); }
  render(scene, camera) {
    syncUniforms();
    globalThis.tn.scene = scene;
    globalThis.tn.camera = camera;
  }
  dispose() {}
}

export class RenderPipeline {
  constructor(renderer) { this.renderer = renderer; }
  render() { globalThis.tn.setPostGraph(this.outputNode); }
  dispose() { globalThis.tn.setPostGraph(null); }
}
export const StorageBufferAttribute = unsupported;
export const MeshLambertNodeMaterial = unsupported;
export const MeshMatcapNodeMaterial = unsupported;
export const MeshNormalNodeMaterial = unsupported;
export const MeshPhongNodeMaterial = unsupported;
export const MeshPhysicalNodeMaterial = unsupported;
export const MeshToonNodeMaterial = unsupported;
