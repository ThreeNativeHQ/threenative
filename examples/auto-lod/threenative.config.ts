import type { IThreeNativeConfig } from "@threenative/core";

const config: IThreeNativeConfig = {
  app: {
    id: "com.threenative.auto-lod",
    name: "auto-lod",
    version: "1.0.0",
    build: 1,
  },
  display: {
    orientation: "landscape",
    fullscreen: true,
    keepScreenOn: true,
    maxFps: 60,
  },
  window: { title: "auto-lod", width: 1280, height: 720 },
  nativeEntry: "src/game.ts",
  renderer: {
    preferWebGPU: true,
    // Pinned so the triangle count is a property of the camera route, not of the resolution
    // scaler's warm-up. The LOD budget is measured in raster pixels either way.
    resolutionScale: 1,
    antialias: false,
  },
  // The explicit opt-in. Default-on lands after qualification; `{}` resolves to enabled/balanced.
  assets: { lod: {} },
};

export default config;
