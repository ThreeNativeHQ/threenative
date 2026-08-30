// Generated for you: ordinary Three.js; ThreeNative does not read this file.
//
// `WorldEnvironment` (in this folder) builds the lighting chain: which stages run, in what
// order, and an honest report of what happened — the chain prints `TN_RENDER_CHAIN` naming
// every stage as applied or refused with a reason. It decides no colour and no strength;
// the values below are arguments, and they are yours.
//
// The two presets are the PRD-278 default: SSGI and SSR are interior-scale stages that the
// starter's small outdoor scene does not need at mobile frame budgets, so they ship off
// there; on desktop they are on. Every stage's cost and the one-line enable for the rest
// (godrays, contact AO, vignette) is `agent-docs/visual-baseline.md`.
import type { Camera, DirectionalLight, Scene } from "three";
import { WorldEnvironment } from "./worldEnvironment.js";
import type { OutputRenderer } from "./worldEnvironment.js";

const sharpenStrength = 0.28;

const desktopPreset = {
  ssgiEnabled: true,
  ssgiQuality: "medium",
  denoiseEnabled: true,
  ssrEnabled: true,
  ssrResolutionScale: 0.5,
  bloomEnabled: true,
  bloomStrength: 0.7,
  sharpenEnabled: true,
  sharpenStrength,
  tonemapMode: "aces",
  exposure: 1.15,
} as const;

const mobilePreset = {
  bloomEnabled: true,
  bloomStrength: 0.7,
  sharpenEnabled: true,
  sharpenStrength,
  tonemapMode: "aces",
  exposure: 1.15,
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
