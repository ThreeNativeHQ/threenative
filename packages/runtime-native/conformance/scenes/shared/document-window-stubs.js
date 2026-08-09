import { assertCondition, startBehaviorScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startBehaviorScene(canvas, dimensions, "document-window-stubs", () => {
    assertCondition(window === globalThis, "window must alias the global object");
    assertCondition(window.document === document, "window.document must alias document");
    assertCondition(
      typeof document.createElement === "function",
      "document.createElement must exist",
    );
    assertCondition(
      typeof document.body?.appendChild === "function",
      "body.appendChild must exist",
    );
    const createdCanvas = document.createElement("canvas");
    assertCondition(createdCanvas !== null, "createElement('canvas') must return a canvas stub");
    assertCondition(typeof canvas.getContext === "function", "host canvas.getContext must exist");
    return { windowAlias: true, canvasTag: createdCanvas.tagName ?? "CANVAS" };
  });
}
