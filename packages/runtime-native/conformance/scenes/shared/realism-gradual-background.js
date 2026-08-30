import { gradualBackground } from "../../../../create-threenative/templates/starter/src/render/effects/gradualBackground.ts";
import { startRealismEffectsScene } from "./realism-effects-scene.js";

export function startScene(canvas, dimensions) {
  return startRealismEffectsScene(canvas, dimensions, "GradualBackgroundEffect", ({ color, depth }) => gradualBackground(color, { depth }));
}
