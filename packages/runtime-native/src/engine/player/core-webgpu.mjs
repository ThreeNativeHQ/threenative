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
// three's renderer.shadowMap: `enabled` and `type` reach the player's renderer, which draws no shadow
// map while it is off. The player refuses a type it has no filter for.
class ShadowMap {
  #enabled = false;
  #type = 1; // PCFShadowMap, three's default
  get enabled() { return this.#enabled; }
  set enabled(value) { this.#apply(value === true, this.#type); }
  get type() { return this.#type; }
  set type(value) { this.#apply(this.#enabled, value); }
  #apply(enabled, type) {
    if (typeof globalThis.tn.setShadowMap !== "function")
      throw new Error("TN_NATIVE_SHADOWMAP_UNBOUND: this host draws no shadow maps");
    globalThis.tn.setShadowMap(enabled, type);
    this.#enabled = enabled;
    this.#type = type;
  }
}

export class WebGPURenderer {
  constructor({ canvas }) {
    this.domElement = canvas;
    this.shadowMap = new ShadowMap();
  }
  setPixelRatio() {}
  setSize(width, height) {
    this.domElement.width = width;
    this.domElement.height = height;
  }
  getDrawingBufferSize(target) { return target.set(this.domElement.width, this.domElement.height); }
  render(scene, camera) {
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
