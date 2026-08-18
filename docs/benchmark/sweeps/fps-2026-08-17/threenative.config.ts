import type { IThreeNativeConfig } from "@threenative/core";

export default {
  app: {
    id: "com.threenative.fpsframework",
    name: "fps-framework",
    version: "1.0.0",
    build: 1,
    icon: "public/icon.png",
  },
  display: {
    orientation: "landscape", // Mobile viewport orientation.
    fullscreen: true, // Keep the game surface edge to edge.
    keepScreenOn: true, // Do not dim during a play session.
  },
  window: {
    title: "fps-framework", // Desktop window title.
    width: 1280,
    height: 720,
    resizable: true,
  },
  loading: {
    backdropColor: "#0d1b2a",
    trackColor: "#274060",
    progressColor: "#8fd694",
    showProgressBar: true,
    // image: "public/logo.png",   // drawn centred above the bar
  },
  nativeEntry: "src/game.ts",
  renderer: { preferWebGPU: true }, // Use WebGPU when the host exposes it.
} satisfies IThreeNativeConfig;
