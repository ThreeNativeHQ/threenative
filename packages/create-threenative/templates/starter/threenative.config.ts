import type { IThreeNativeConfig } from "@threenative/core";

export default {
  app: {
    id: "com.threenative.__PROJECT_ID__",
    name: "__PROJECT_NAME__",
    version: "1.0.0",
    build: 1,
    icon: "public/icon.png",
    icons: { web: { favicon: "public/favicon.svg" } },
  },
  display: {
    orientation: "landscape", // Mobile viewport orientation.
    fullscreen: true, // Keep the game surface edge to edge.
    keepScreenOn: true, // Do not dim during a play session.
  },
  window: {
    title: "__PROJECT_NAME__", // Desktop window title.
    width: 1280,
    height: 720,
    resizable: true,
  },
  bootSplash: {
    backgroundColor: "#0d1b2a",
  },
  nativeEntry: "src/game.ts",
  renderer: { preferWebGPU: true }, // Use WebGPU when the host exposes it.
  // One UI on every target: src/ui/ renders through the platform's own browser-class renderer,
  // so the same React, Tailwind, CSS and SVG run on web, desktop, Android and iOS alike.
  // Switch to "native" for a UI drawn as part of the rendered frame, with no web view and no
  // extra process — and own the appearance difference that comes with it.
  ui: { renderer: "web" },
} satisfies IThreeNativeConfig;
