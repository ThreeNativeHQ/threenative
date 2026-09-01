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
import { vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import { type QualityTier, qualityPreset, resolveQualityTier } from "./quality.js";
import type { OutputRenderer } from "./worldEnvironment.js";
import { WorldEnvironment } from "./worldEnvironment.js";

type AtmosphereLike = {
  aerialPerspective(scenePass: unknown, depth: unknown, inScatteredRadiance?: unknown): unknown;
  radiance(direction: unknown): unknown;
};

export function setupPost(
  renderer: OutputRenderer,
  scene: Scene,
  camera: Camera,
  environment: {
    atmosphere?: AtmosphereLike;
    godraysLight?: DirectionalLight;
    mobile?: boolean;
    /** Forces a tier, ignoring `mobile`. An unknown name throws rather than falling back. */
    tier?: QualityTier;
  } = {},
): void {
  const tier = resolveQualityTier({ mobile: environment.mobile, tier: environment.tier });
  const source = environment.tier === undefined ? "platform" : "override";
  console.info(`TN_QUALITY_TIER ${tier} mobile=${environment.mobile === true} source=${source}`);
  const world = new WorldEnvironment(qualityPreset(tier));
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
              // Same scale as the dome in sky.ts, and for the same reason: this radiance is
              // mixed into every pixel by the haze term, so at 24 it lifted the whole frame.
              (atmosphere.radiance(vec3(0, 0, 1)) as Node<"vec3">).mul(1.5),
            ) as Node<"vec4">,
    godraysLight: environment.godraysLight,
  });
}
