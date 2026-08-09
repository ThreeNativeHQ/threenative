import { assertCondition, startBehaviorScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startBehaviorScene(canvas, dimensions, "offscreen-canvas", () => {
    assertCondition(typeof OffscreenCanvas === "function", "OffscreenCanvas must exist");
    const offscreen = new OffscreenCanvas(32, 16);
    assertCondition(
      offscreen.width === 32 && offscreen.height === 16,
      "OffscreenCanvas size mismatch",
    );
    const context = offscreen.getContext("2d");
    assertCondition(context !== null, "OffscreenCanvas 2D context must exist");
    assertCondition(context.canvas === offscreen, "2D context must reference its canvas");
    return { width: offscreen.width, height: offscreen.height };
  });
}
