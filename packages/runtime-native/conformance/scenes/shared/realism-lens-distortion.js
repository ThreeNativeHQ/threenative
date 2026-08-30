import { lensDistortion } from "../../../../create-threenative/templates/starter/src/render/effects/lensDistortion.ts";
import { startRealismEffectsScene } from "./realism-effects-scene.js";

export function startScene(canvas, dimensions) {
  return startRealismEffectsScene(canvas, dimensions, "LensDistortionEffect", ({ color }) => lensDistortion(color));
}
