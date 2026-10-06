import { unsupported } from "./core-three.mjs";

// Unused imports must never pull upstream rendering/loader code into this artifact.
export const MeshBVH = unsupported;
export const GLTFLoader = unsupported;
export const DRACOLoader = unsupported;
export const MeshoptDecoder = { ready: Promise.resolve(), decodeGltfBuffer: unsupported };
export const mergeGeometries = unsupported;
export const mergeAttributes = unsupported;
export const clone = unsupported;
export class KTX2Loader {
  setTranscoderPath() {}
  setWorkerLimit() {}
  detectSupport = unsupported;
  load = unsupported;
}
export const {
  Fn, attribute, instanceIndex, normalGeometry, normalLocal, positionGeometry,
  positionPrevious, storage, tangentGeometry, tangentLocal, uint, vec4,
  context, mrt, output, velocity,
} = globalThis;
