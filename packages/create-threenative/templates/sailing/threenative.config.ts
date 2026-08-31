import type { IThreeNativeConfig } from "@threenative/core";

const config: IThreeNativeConfig = {
  app: {
    id: "com.threenative.__PROJECT_ID__",
    name: "__PROJECT_NAME__",
    version: "1.0.0",
    build: 1,
    icons: { web: { favicon: "public/favicon.svg" } },
  },
  display: {
    orientation: "landscape",
    fullscreen: true,
    keepScreenOn: true,
    maxFps: 60,
  },
  window: {
    title: "__PROJECT_NAME__",
    width: 1280,
    height: 720,
    resizable: true,
  },
  bootSplash: { backgroundColor: "#061b2b" },
  nativeEntry: "src/game.ts",
  renderer: {
    preferWebGPU: true,
    resolutionScale: "auto",
  },
  assets: { models: "none", textures: "none" },
  ui: { renderer: "web" },
};

export default config;
