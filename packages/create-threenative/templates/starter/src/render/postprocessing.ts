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
import {
  type IAdaptiveQualityOptions,
  type IQualityWindow,
  createAdaptiveQuality,
  formatQualityAdaptation,
} from "./adaptiveQuality.js";
import { painterlyStageNames, painterlyStages } from "./painterly.js";
import { type QualityTier, qualityPreset } from "./quality.js";
import { type OutputRenderer, WorldEnvironment } from "./worldEnvironment.js";

interface IPostController {
  debug(): Record<string, unknown>;
  observe(window: IQualityWindow): void;
  dispose(): void;
}

let active: IPostController | undefined;

/** The starter's game.ts connects its existing completed frame-window callback here. */
export function observeQualityWindow(window: IQualityWindow): void {
  active?.observe(window);
}

export function setupPost(
  renderer: OutputRenderer,
  scene: Scene,
  camera: Camera,
  environment: IAdaptiveQualityOptions & {
    godraysLight?: DirectionalLight;
    mobile?: boolean;
    /** Forces a tier while keeping its costs observed. Unknown names throw. */
    tier?: QualityTier;
  } = {},
): IPostController {
  const policy = createAdaptiveQuality(environment, environment);
  active?.dispose();
  let disposed = false;
  let disposeGraph: (() => void) | undefined;
  let observation: Record<string, unknown> = {
    tier: policy.tier,
    source: policy.pinned ? "pinned" : "auto",
  };
  function apply(): void {
    // Replacement is serialized: no old graph or subscription remains alive beside the new one.
    disposeGraph?.();
    const settings = qualityPreset(policy.tier);
    const world = new WorldEnvironment({
      ...settings,
      authoredStageNames: painterlyStageNames(settings),
      authoredStages: painterlyStages(settings),
    });
    const applied = world.apply(renderer, scene, camera, {
      godraysLight: environment.godraysLight,
    });
    disposeGraph = applied.dispose;
    observation = { ...observation, stages: applied.stages, dropped: applied.dropped };
  }
  apply();
  const source = environment.tier === undefined ? "platform" : "override";
  console.info(
    `TN_QUALITY_TIER ${policy.tier} mobile=${environment.mobile === true} source=${source}`,
  );
  const controller = {
    debug: () => observation,
    observe(window: IQualityWindow): void {
      if (disposed) return;
      const decision = policy.observe(window);
      if (decision.changed) apply();
      observation = {
        stages: observation.stages,
        dropped: observation.dropped,
        ...decision,
        ...(Number.isInteger(window.window) ? { window: window.window } : {}),
      };
      console.info(formatQualityAdaptation(decision));
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      disposeGraph?.();
      disposeGraph = undefined;
      if (active === controller) active = undefined;
    },
  };
  active = controller;
  return controller;
}
