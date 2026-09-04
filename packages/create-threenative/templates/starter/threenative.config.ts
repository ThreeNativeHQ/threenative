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
    orientation: "landscape", // Mobile viewport orientation.
    fullscreen: true, // Keep the game surface edge to edge.
    keepScreenOn: true, // Do not dim during a play session.
    maxFps: 60, // Set 120 to opt into a supported high-refresh display mode.
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
  renderer: {
    preferWebGPU: true, // Use WebGPU when the host exposes it.
    // The engine holds the `display.maxFps` budget by scaling the 3D drawing buffer, and reports
    // the scale it settled on in every `TN_FRAME_BUDGET` window. Replace with a number in (0, 1]
    // to pin it — the loop stops and the reporting does not. CSS, UI and camera framing never move.
    resolutionScale: "auto",
    // Multisampling resolves triangle edges. A cutout silhouette — foliage, a fence, hair — is
    // carved inside the triangle by an alpha test, so it resolves through the coverage mask or
    // not at all, which is what this spends the samples above on. It costs no target and no
    // extra pass; set it false for a deliberately hard-edged look. `TN_ALPHA_ANTIALIASING`
    // reports what it did, and says so when a single-sampled surface leaves it nothing to do.
    alphaAntialiasing: true,
  },
  assets: {
    // The compile step's defaults are what a game with real art wants, and everything this
    // change adds — target-aware compression, the off-thread decode, byte-weighted progress —
    // is live for any project that omits this object. This template still pins both passes off,
    // for the reason the pin has always given: these two demo files are small enough that
    // compression only ever grew them.
    //
    // And enabling them here hung the lane that proves this template. `golden-path-template
    // (starter)` stopped producing output after its build and was killed at its 45-minute
    // timeout on runs 33801767525 and 33805466971 — twice, while the same job takes 2-3 minutes
    // on `main` and the `platformer` leg, whose config this change does not touch, passed in 95
    // seconds beside it. Turning the default on for the shipped templates is a separate change
    // that owes that hang a diagnosis first; it is not this one's to smuggle in.
    models: "none",
    textures: "none",
  },
  // One UI on every target: src/ui/ renders through the platform's own browser-class renderer,
  // so the same React, Tailwind, CSS and SVG run on web, desktop, Android and iOS alike.
  // Switch to "native" for a UI drawn as part of the rendered frame, with no web view and no
  // extra process — and own the appearance difference that comes with it.
  ui: { renderer: "web" },
};

export default config;
