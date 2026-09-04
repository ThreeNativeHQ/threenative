// The starter's painterly look: an ink outline, a Kuwahara smear, and a watercolour wash.
//
// This file exists because `worldEnvironment.ts` may not contain it. That file is the render-chain
// plumbing every kit copies verbatim, and `shared-render-sources.spec.ts` fails when one kit's copy
// stops matching the others — which is exactly what happens when a kit's own art direction is
// written into it. Bloom and vignette live in there because they are grading primitives every kit
// wants; kuwahara, outline and watercolour are one kit's aesthetic, and an aesthetic shipped into
// ten kits so that one can use it is the preset system the charter closed with evidence.
//
// So the plumbing exposes a seam — `authoredStageNames` and `authoredStages` — and this is what the
// starter passes through it.

import { createKuwaharaStage } from "./kuwahara.js";
import { createOutlineStage } from "./outline.js";
import { createWatercolorStage } from "./watercolor.js";
import type { ChainStage, IWorldEnvironmentStageContext } from "./worldEnvironment.js";

/** The knobs the quality presets set. Every one is this kit's, not the framework's. */
export interface IPainterlyOptions {
  readonly outlineEnabled?: boolean;
  readonly outlineInkColor?: number;
  readonly outlineStrength?: number;
  readonly outlineThreshold?: number;
  readonly outlineSoftness?: number;
  readonly outlineDepthWeight?: number;
  readonly kuwaharaEnabled?: boolean;
  readonly kuwaharaRadius?: number;
  readonly kuwaharaResolutionScale?: number;
  readonly kuwaharaAnisotropy?: number;
  readonly kuwaharaStrength?: number;
  readonly watercolorEnabled?: boolean;
  readonly watercolorLevels?: number;
  readonly watercolorPaperStrength?: number;
  readonly watercolorShadowStrength?: number;
  readonly watercolorShadowTint?: number;
  readonly watercolorStrength?: number;
}

/**
 * Which stages run, in chain order.
 *
 * The chain reads this before the scene pass exists — with nothing requested it sets an exposure
 * and never builds a pass at all — so it has to be answerable from the options alone.
 */
export function painterlyStageNames(options: IPainterlyOptions): readonly string[] {
  const names: string[] = [];
  if (options.outlineEnabled === true) names.push("outline");
  if (options.kuwaharaEnabled === true) names.push("kuwahara");
  if (options.watercolorEnabled === true) names.push("watercolor");
  return names;
}

/**
 * The complete authored graph, dormant stages included.
 *
 * All three are always defined even when only one is requested, because `watercolor after
 * kuwahara` and `kuwahara after outline` are anchors that must keep naming a stage that exists —
 * otherwise enabling one stage on its own resolves against a name the chain never heard of.
 */
export function painterlyStages(
  options: IPainterlyOptions,
): (context: IWorldEnvironmentStageContext) => readonly ChainStage[] {
  return ({ depthNode }) => [
    createOutlineStage({
      depthNode,
      depthWeight: options.outlineDepthWeight ?? 0.65,
      inkColor: options.outlineInkColor ?? 0x142331,
      softness: options.outlineSoftness ?? 0.16,
      strength: options.outlineStrength ?? 0.8,
      threshold: options.outlineThreshold ?? 0.12,
    }),
    createKuwaharaStage({
      anisotropy: options.kuwaharaAnisotropy ?? 0.72,
      radius: options.kuwaharaRadius ?? 5,
      resolutionScale: options.kuwaharaResolutionScale ?? 0.5,
      strength: options.kuwaharaStrength ?? 0.82,
    }),
    createWatercolorStage({
      levels: options.watercolorLevels ?? 8,
      paperStrength: options.watercolorPaperStrength ?? 0.2,
      shadowStrength: options.watercolorShadowStrength ?? 0.16,
      shadowTint: options.watercolorShadowTint ?? 0x6d5a52,
      strength: options.watercolorStrength ?? 0.72,
    }),
  ];
}
