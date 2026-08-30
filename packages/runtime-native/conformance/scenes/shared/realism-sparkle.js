import { sparkle } from "../../../../create-threenative/templates/starter/src/render/effects/sparkle.ts";
import { startRealismEffectsScene } from "./realism-effects-scene.js";

export function startScene(canvas, dimensions) {
  return startRealismEffectsScene(canvas, dimensions, "SparkleEffect", ({ color }) => sparkle(color));
}
