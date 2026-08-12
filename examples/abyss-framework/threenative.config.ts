import type { IThreeNativeConfig } from "@threenative/core";

export default {
  app: {
    id: "com.threenative.loadingleak",
    name: "ThreeNative Loading Leak",
    version: "1.0.0",
    build: 1,
  },
  display: {
    fullscreen: true,
    keepScreenOn: true,
    orientation: "landscape",
  },
  nativeEntry: "src/loading-leak-game.ts",
  renderer: { preferWebGPU: true },
} satisfies IThreeNativeConfig;
