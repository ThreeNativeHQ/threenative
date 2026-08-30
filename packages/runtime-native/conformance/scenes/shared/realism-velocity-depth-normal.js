import { colorizeVelocity, startRealismEffectsScene } from "./realism-effects-scene.js";

export function startScene(canvas, dimensions) {
  return startRealismEffectsScene(canvas, dimensions, "VelocityDepthNormalPass", ({ color, normal, velocity }) => ({
    node: color,
    outputNode: colorizeVelocity(velocity.add(normal.xy)),
  }), { temporal: true });
}
