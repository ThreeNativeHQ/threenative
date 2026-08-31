// Generated for you: ordinary Three.js; the stage order and fallback report are game-owned.
import type { Camera, DirectionalLight, Scene } from "three";
import type { OutputRenderer } from "./worldEnvironment.js";
import { WorldEnvironment } from "./worldEnvironment.js";

const desktopPreset = {
  bloomEnabled: true,
  bloomStrength: 0.38,
  denoiseEnabled: false,
  exposure: 1.12,
  ssgiEnabled: false,
  ssrEnabled: false,
  tonemapMode: "aces",
} as const;

const mobilePreset = {
  bloomEnabled: true,
  bloomStrength: 0.28,
  exposure: 1.12,
  ssgiEnabled: false,
  ssrEnabled: false,
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
