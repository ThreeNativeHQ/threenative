import type { IThreeNativeConfig } from "@threenative/core";

const config: IThreeNativeConfig = {
  app: {
    id: "com.threenative.__PROJECT_ID__",
    name: "__PROJECT_NAME__",
    version: "1.0.0",
    build: 1,
    icon: "public/icon.png",
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
  bootSplash: {
    backgroundColor: "#07131d",
  },
  nativeEntry: "src/game.ts",
  renderer: {
    preferWebGPU: true, // Use WebGPU when the host exposes it.
    // The engine holds the `display.maxFps` budget by scaling the 3D drawing buffer, and reports
    // the scale it settled on in every `TN_FRAME_BUDGET` window. Replace with a number in (0, 1]
    // to pin it — the loop stops and the reporting does not. CSS, UI and camera framing never move.
    resolutionScale: "auto",
  },
  // One UI on every target: src/ui/ renders through the platform's own browser-class renderer,
  // so the same React, Tailwind, CSS and SVG run on web, desktop, Android and iOS alike.
  // Switch to "native" for a UI drawn as part of the rendered frame, with no web view and no
  // extra process — and own the appearance difference that comes with it.
  ui: { renderer: "web" },
};

export default config;
