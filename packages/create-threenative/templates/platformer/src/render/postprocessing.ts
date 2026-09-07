// Generated for you: ordinary Three.js; ThreeNative does not read this file.
//
// This file wires two things together and decides nothing itself. `quality.ts`, in this folder,
// owns which stages run at which tier and records what each one measured. `WorldEnvironment`,
// also in this folder, builds them and prints `TN_WORLD_ENVIRONMENT` naming every stage as
// applied or refused **with a reason**, so a stage that silently no-op'd is never mistaken for
// one you turned off.
//
// To make the game cheaper or prettier everywhere, edit `quality.ts`. To force one tier for one
// run — a desktop that is dropping frames, a capture you want to compare — pass it:
// `setupPost(renderer, scene, camera, { tier: "low" })`. Overriding does not silence the report:
// `TN_QUALITY_TIER` names the tier that ran either way.
import type { Camera, DirectionalLight, Scene } from "three";
import { type QualityTier, qualityPreset, resolveQualityTier } from "./quality.js";
import type { OutputRenderer } from "./worldEnvironment.js";
import { WorldEnvironment } from "./worldEnvironment.js";

type ProfileGlobals = typeof globalThis & {
  __THREENATIVE_PROFILE__?: { hostedSoftware?: unknown };
};

export function setupPost(
  renderer: OutputRenderer,
  scene: Scene,
  camera: Camera,
  environment: {
    godraysLight?: DirectionalLight;
    mobile?: boolean;
    /** Forces a tier, ignoring `mobile`. An unknown name throws rather than falling back. */
    tier?: QualityTier;
  } = {},
): void {
  // The native production collector explicitly marks a software-only hosted smoke run. This is
  // a profile input, not a host fact: the normal desktop game remains high, while this run uses
  // the existing low look so screenshot and lifecycle evidence can settle on a CPU adapter.
  const hostedSoftware =
    (globalThis as ProfileGlobals).__THREENATIVE_PROFILE__?.hostedSoftware === true;
  const requestedTier: QualityTier | undefined =
    environment.tier ?? (hostedSoftware ? "low" : undefined);
  const tier = resolveQualityTier({ mobile: environment.mobile, tier: requestedTier });
  const source =
    environment.tier !== undefined ? "override" : hostedSoftware ? "hosted-software" : "platform";
  console.info(`TN_QUALITY_TIER ${tier} mobile=${environment.mobile === true} source=${source}`);
  const world = new WorldEnvironment(qualityPreset(tier));
  world.apply(renderer, scene, camera, { godraysLight: environment.godraysLight });
}
