import type { IThreeNativeConfig } from "@threenative/core";

export default {
  app: {
    id: "com.threenative.cratefall",
    name: "cratefall",
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
    title: "cratefall", // Desktop window title.
    width: 1280,
    height: 720,
    resizable: true,
  },
  loading: {
    // Read by src/render/loading.ts, which is your file. Delete that file to drop the screen.
    backdropColor: "#0d1b2a",
    trackColor: "#274060",
    progressColor: "#8fd694",
    showProgressBar: true,
    // image: "public/logo.png",   // drawn centred above the bar
  },
  nativeEntry: "src/game.ts",
  renderer: { preferWebGPU: true }, // Use WebGPU when the host exposes it.
} satisfies IThreeNativeConfig;
