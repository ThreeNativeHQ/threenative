export * from "./core-three.mjs";
import { unsupported } from "./core-three.mjs";

export const { MeshBasicNodeMaterial, MeshStandardNodeMaterial, SpriteNodeMaterial } = globalThis;
Object.setPrototypeOf(MeshBasicNodeMaterial.prototype, globalThis.MeshBasicMaterial.prototype);
Object.setPrototypeOf(MeshStandardNodeMaterial.prototype, globalThis.MeshStandardMaterial.prototype);
Object.setPrototypeOf(SpriteNodeMaterial.prototype, globalThis.SpriteMaterial.prototype);
for (const material of [MeshBasicNodeMaterial, MeshStandardNodeMaterial, SpriteNodeMaterial]) {
  material.prototype.isNodeMaterial = true;
  material.prototype[`is${material.name}`] = true;
}

// Core still owns createRenderer/wrapRenderer; the player owns the GPU and draws these handles.
// The facade's backend answers three's adapter request with the player's GPU adapter, so core reads
// the same `adapter.info` identity (and software-adapter verdict) it reads in a browser.
class NativeBackend {
  gpu = { requestAdapter: () => globalThis.tn.requestAdapter() };
}

export class WebGPURenderer {
  constructor({ canvas }) { this.domElement = canvas; }
  backend = new NativeBackend();
  // WebGPURenderer's defaults; the player applies them before each frame it draws.
  shadowMap = { enabled: false, type: 1 };
  toneMapping = 0;
  toneMappingExposure = 1;
  outputColorSpace = "srgb";
  setPixelRatio() {}
  setSize(width, height) {
    this.domElement.width = width;
    this.domElement.height = height;
  }
  getDrawingBufferSize(target) { return target.set(this.domElement.width, this.domElement.height); }
  render(scene, camera) {
    globalThis.tn.scene = scene;
    globalThis.tn.camera = camera;
    globalThis.tn.setRendererState(this);
  }
  dispose() {}
}

// three's RenderPipeline(renderer, outputNode): the player installs the node graph as its post pass
// (once per graph) and draws it with the renderer's settings.
export class RenderPipeline {
  constructor(renderer, outputNode = null) {
    this.renderer = renderer;
    this.outputNode = outputNode;
  }
  render() {
    globalThis.tn.setRendererState(this.renderer);
    globalThis.tn.setPostGraph(this.outputNode);
  }
  dispose() { globalThis.tn.setPostGraph(null); }
}
export const StorageBufferAttribute = unsupported;
export const MeshLambertNodeMaterial = unsupported;
export const MeshMatcapNodeMaterial = unsupported;
export const MeshNormalNodeMaterial = unsupported;
export const MeshPhongNodeMaterial = unsupported;
export const MeshPhysicalNodeMaterial = unsupported;
export const MeshToonNodeMaterial = unsupported;
