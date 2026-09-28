import type { IThreeNativeConfig } from "@threenative/core";

const config: IThreeNativeConfig = {
  app: {
    id: "com.threenative.csgdoorway",
    name: "csg-doorway",
    version: "1.0.0",
    build: 1,
  },
  display: {
    orientation: "landscape",
    fullscreen: true,
    keepScreenOn: true,
    maxFps: 60,
  },
  window: { title: "csg-doorway", width: 1280, height: 720 },
  nativeEntry: "src/game.ts",
  renderer: {
    preferWebGPU: true,
    resolutionScale: 1,
    antialias: false,
  },
  ui: { renderer: "native" },
};

export default config;
