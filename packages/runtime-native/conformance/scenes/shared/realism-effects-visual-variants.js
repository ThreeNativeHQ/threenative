import { gradualBackground } from "../../../../create-threenative/templates/starter/src/render/effects/gradualBackground.ts";
import { lensDistortion } from "../../../../create-threenative/templates/starter/src/render/effects/lensDistortion.ts";
import { sparkle } from "../../../../create-threenative/templates/starter/src/render/effects/sparkle.ts";
import { startRealismEffectsScene } from "./realism-effects-scene.js";

const CHANGED_OPTIONS = {
  "GradualBackgroundEffect": { strength: 0.95 },
  "LensDistortionEffect": { k1: -0.42 },
  "SparkleEffect": { threshold: 0.22 },
};

export function startScene(canvas, dimensions) {
  const effect = globalThis.__TN_REALISM_EFFECT__;
  const variant = globalThis.__TN_REALISM_EFFECT_VARIANT__;
  if (!(effect in CHANGED_OPTIONS) || !["off", "default", "changed"].includes(variant)) {
    throw new Error(`Unknown realism-effects visual variant: ${effect}/${variant}`);
  }
  return startRealismEffectsScene(
    canvas,
    dimensions,
    `${effect}:${variant}`,
    ({ color, depth }) => {
      if (variant === "off") return color;
      if (effect === "LensDistortionEffect") {
        return lensDistortion(
          color,
          variant === "changed" ? CHANGED_OPTIONS.LensDistortionEffect : undefined,
        );
      }
      if (effect === "SparkleEffect") {
        return sparkle(
          color,
          variant === "changed" ? CHANGED_OPTIONS.SparkleEffect : undefined,
        );
      }
      return gradualBackground(color, {
        depth,
        ...(variant === "changed" ? CHANGED_OPTIONS.GradualBackgroundEffect : {}),
      });
    },
  );
}
