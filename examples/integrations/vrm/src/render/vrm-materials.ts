import { MToonMaterialLoaderPlugin, VRMLoaderPlugin } from "@pixiv/three-vrm";
import { MToonNodeMaterial } from "@pixiv/three-vrm/nodes";
import type { GLTFParser } from "three/addons/loaders/GLTFLoader.js";
/** Editable visual choice, deliberately outside framework core. */
export function vrmWebGpuPlugin(parser: GLTFParser): VRMLoaderPlugin {
  return new VRMLoaderPlugin(parser, {
    mtoonMaterialPlugin: new MToonMaterialLoaderPlugin(parser, { materialType: MToonNodeMaterial }),
  });
}
