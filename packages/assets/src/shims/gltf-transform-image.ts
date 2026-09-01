function unavailable(): never {
  throw new Error("TN_ASSETS_GLTF_IMAGE_HELPER_UNUSED: use the ThreeNative texture pass instead.");
}

export const getPixels = unavailable;
export const savePixels = unavailable;
