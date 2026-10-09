export * from "./core-three.mjs";
import { unsupported } from "./core-three.mjs";
import { syncUniforms } from "./core-tsl.mjs";
import { ShadowMap } from "../../../../three-native/src/shadow-map.ts";

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
  // three's `renderer.info`, read from the last frame the player drew (one frame behind the
  // simulation, as a GPU-timed reading is). `reset` has nothing to clear: the player counts per frame.
  info = {
    render: {
      get drawCalls() { return globalThis.tn.renderInfo().drawCalls; },
      get calls() { return globalThis.tn.renderInfo().drawCalls; },
      get triangles() { return globalThis.tn.renderInfo().triangles; },
    },
    compute: {},
    frame: 0,
    reset() {},
  };
  // WebGPURenderer's defaults; the player applies them before each frame it draws.
  shadowMap = new ShadowMap();
  toneMapping = 0;
  toneMappingExposure = 1;
  outputColorSpace = "srgb";
  setPixelRatio() {}
  // WebGPUCapabilities.getMaxAnisotropy: WebGPU samplers clamp maxAnisotropy to 16.
  getMaxAnisotropy() { return 16; }
  setSize(width, height) {
    this.domElement.width = width;
    this.domElement.height = height;
  }
  getDrawingBufferSize(target) { return target.set(this.domElement.width, this.domElement.height); }
  render(scene, camera) {
    syncUniforms();
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
    syncUniforms();
    globalThis.tn.setRendererState(this.renderer);
    globalThis.tn.setPostGraph(this.outputNode);
  }
  dispose() { globalThis.tn.setPostGraph(null); }
}
// three's NodeUpdateType, the constants a node's update schedule names.
export const NodeUpdateType = Object.freeze({ NONE: "none", FRAME: "frame", RENDER: "render", OBJECT: "object" });
export const StorageBufferAttribute = unsupported;
export const MeshLambertNodeMaterial = unsupported;
export const MeshMatcapNodeMaterial = unsupported;
export const MeshNormalNodeMaterial = unsupported;
export const MeshPhongNodeMaterial = unsupported;
export const MeshPhysicalNodeMaterial = unsupported;
export const MeshToonNodeMaterial = unsupported;
