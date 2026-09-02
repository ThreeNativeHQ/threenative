import type { IThreeNativeConfig } from "@threenative/core";

export default {
  app: {
    id: "com.threenative.vfxgallery",
    name: "ThreeNative VFX Gallery",
    version: "1.0.0",
    build: 1,
  },
  display: {
    fullscreen: true,
    keepScreenOn: true,
    orientation: "landscape",
  },
  nativeEntry: "src/game.ts",
  renderer: { preferWebGPU: true },
} satisfies IThreeNativeConfig;
