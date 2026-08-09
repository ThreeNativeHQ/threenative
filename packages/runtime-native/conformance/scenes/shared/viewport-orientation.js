import { assertCondition, startBehaviorScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startBehaviorScene(canvas, dimensions, "viewport-size-orientation", () => {
    assertCondition(
      canvas.width === dimensions.width,
      "canvas width must match requested viewport",
    );
    assertCondition(
      canvas.height === dimensions.height,
      "canvas height must match requested viewport",
    );
    assertCondition(Number.isFinite(window.innerWidth), "window.innerWidth must be finite");
    assertCondition(Number.isFinite(window.innerHeight), "window.innerHeight must be finite");
    const canvasLandscape = canvas.width >= canvas.height;
    const windowLandscape = window.innerWidth >= window.innerHeight;
    assertCondition(
      canvasLandscape === windowLandscape,
      "viewport orientation must match the canvas",
    );
    return { width: canvas.width, height: canvas.height, orientation: "landscape" };
  });
}
