// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// `WorldEnvironment`, in this folder, builds the lighting chain: which stages run, in what
// order, and an honest report of what happened. It prints `TN_WORLD_ENVIRONMENT` naming every
// stage as applied or refused **with a reason**, so a stage that silently no-op'd is never
// mistaken for one you turned off. It decides no colour and no strength — every value below is
// an argument, and they are yours.
//
// SSGI and SSR are the expensive pair, so they ship on for desktop and off for mobile. That
// split is the shipped default, not a ceiling: turn either on for mobile by adding it to
// `mobilePreset` and read the frame cost back out of `TN_FRAME_BUDGET`. What each stage costs,
// and the one-line enable for the ones that ship off everywhere (godrays, contact AO,
// vignette), is in `agent-docs/visual-baseline.md`.
import type { Camera, DirectionalLight, Scene } from "three";
import { vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import type { OutputRenderer } from "./worldEnvironment.js";
import { WorldEnvironment } from "./worldEnvironment.js";

type AtmosphereLike = {
  aerialPerspective(scenePass: unknown, depth: unknown, inScatteredRadiance?: unknown): unknown;
  radiance(direction: unknown): unknown;
};

// Scene-referred exposure: multiplied into the pass before the tone curve, so the gather, the
// reflections and the bloom threshold all see the same exposed image.
const exposure = 1.15;

// Unchanged from this template's previous chain — strength, radius and threshold are a look
// decision that was already tuned to this scene's palette.
const glow = {
  bloomEnabled: true,
  bloomRadius: 0.5,
  bloomStrength: 0.5,
  bloomThreshold: 0.2,
} as const;

// No SSGI here, and this is the one template where that is a measured decision rather than a
// taste one: its sky, sun colour and depth haze are a volumetric `Atmosphere`, which already owns
// most of the frame. With the gather on, `playtests/play.playtest.json` measured **34.2 ms p95
// against the 33 ms ceiling**; without it the same scenario passes. Turn it on when you replace
// the atmosphere with a flat sky, and read the p95 back out of `TN_FRAME_BUDGET`.
const desktopPreset = {
  ...glow,
  exposure,
  ssrEnabled: true,
  // `SSRNode` defaults this to **1 world unit**, which on a scene this size reads as
  // "reflections are on and do nothing" — the ray dies a metre from where it started.
  ssrMaxDistance: 20,
  // A reflection carries almost no high-frequency detail, so half resolution costs a quarter
  // of the rays and is very hard to see in the result.
  ssrResolutionScale: 0.5,
  // RCAS puts back the micro-detail the half-resolution reflection and the denoiser take out.
  // The same cause everywhere, so the same value everywhere: **0 is maximum sharpening and 2
  // is none** — it is a radius, not a gain.
  sharpenEnabled: true,
  sharpenStrength: 0.3,
  tonemapMode: "aces",
} as const;

// No SSGI, no SSR, and therefore nothing for the sharpener to put back.
const mobilePreset = {
  ...glow,
  exposure,
  tonemapMode: "aces",
} as const;

export function setupPost(
  renderer: OutputRenderer,
  scene: Scene,
  camera: Camera,
  environment: {
    atmosphere?: AtmosphereLike;
    godraysLight?: DirectionalLight;
    mobile?: boolean;
  } = {},
): void {
  const world = new WorldEnvironment(environment.mobile === true ? mobilePreset : desktopPreset);
  const atmosphere = environment.atmosphere;
  world.apply(renderer, scene, camera, {
    // The chain builds the scene pass, so aerial perspective — which needs that pass and its
    // view-Z — is composed here, first, before exposure and before any stage. Delete this
    // property to drop aerial perspective while keeping the sky and the rest of the chain.
    baseColour:
      atmosphere === undefined
        ? undefined
        : (scenePass) =>
            atmosphere.aerialPerspective(
              scenePass,
              scenePass.getViewZNode(),
              (atmosphere.radiance(vec3(0, 0, 1)) as Node<"vec3">).mul(24),
            ) as Node<"vec4">,
    godraysLight: environment.godraysLight,
  });
}
