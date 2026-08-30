import { colorizeVelocity, startRealismEffectsScene } from "./realism-effects-scene.js";

export function startScene(canvas, dimensions) {
  return startRealismEffectsScene(canvas, dimensions, "VelocityPass", ({ velocity }) => ({
    node: velocity,
    outputNode: colorizeVelocity(velocity),
  }), { temporal: true });
}
