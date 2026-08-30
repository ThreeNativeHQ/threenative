import { motionBlur } from "three/addons/tsl/display/MotionBlur.js";
import { velocity } from "three/tsl";
import { startRealismEffectsScene } from "./realism-effects-scene.js";

export function startScene(canvas, dimensions) {
  return startRealismEffectsScene(canvas, dimensions, "MotionBlurEffect", ({ color }) => motionBlur(color, velocity, 4));
}
