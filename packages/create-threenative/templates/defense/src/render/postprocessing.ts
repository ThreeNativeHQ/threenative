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
import type { OutputRenderer } from "./worldEnvironment.js";
import { WorldEnvironment } from "./worldEnvironment.js";

// Scene-referred exposure: multiplied into the pass before the tone curve, so the gather, the
// reflections and the bloom threshold all see the same exposed image.
const exposure = 1.15;

// Unchanged from this template's previous chain — strength, radius and threshold are a look
// decision that was already tuned to this scene's palette.
const glow = {
  bloomEnabled: true,
  bloomRadius: 0.5,
  bloomStrength: 0.42,
  bloomThreshold: 0.2,
} as const;

const desktopPreset = {
  ...glow,
  denoiseEnabled: true,
  exposure,
  ssgiEnabled: true,
  // Room scale, not contact scale: about two thirds of the 26-unit shadow extent
  // `lighting.ts` lights — a lit board seen from above, where the bounce off the ground plane is most of the effect.
  ssgiRadius: 18,
  ssgiQuality: "medium",
  ssrEnabled: true,
  // `SSRNode` defaults this to **1 world unit**, which on a scene this size reads as
  // "reflections are on and do nothing" — the ray dies a metre from where it started.
  ssrMaxDistance: 44,
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
  environment: { godraysLight?: DirectionalLight; mobile?: boolean } = {},
): void {
  const world = new WorldEnvironment(environment.mobile === true ? mobilePreset : desktopPreset);
  world.apply(renderer, scene, camera, { godraysLight: environment.godraysLight });
}
