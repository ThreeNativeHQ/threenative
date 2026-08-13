import type { IThreeNativeConfig } from "@threenative/core";

export default {
  app: {
    id: "com.threenative.__PROJECT_ID__",
    name: "__PROJECT_NAME__",
    version: "1.0.0",
    build: 1,
  },
  display: {
    orientation: "landscape",
    fullscreen: true,
    keepScreenOn: true,
  },
  window: {
    title: "__PROJECT_NAME__",
    width: 1280,
    height: 720,
    resizable: true,
  },
  loading: {
    backdropColor: "#07111d",
    trackColor: "#16324a",
    progressColor: "#ffcf4a",
    showProgressBar: true,
  },
  nativeEntry: "src/game.ts",
  renderer: { preferWebGPU: true },
} satisfies IThreeNativeConfig;
