import { assertCondition, startBehaviorScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  const rendererCanvas = document.createElement("canvas");
  rendererCanvas.width = dimensions.width;
  rendererCanvas.height = dimensions.height;
  document.body.appendChild(rendererCanvas);
  return startBehaviorScene(rendererCanvas, dimensions, "document-window-stubs", () => {
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
    createdCanvas.width = 440;
    createdCanvas.height = 64;
    const textContext = createdCanvas.getContext("2d");
    textContext.font = "17px monospace";
    assertCondition(
      textContext.measureText("PREPARING TERRAIN").width > 20,
      "Canvas2D must resolve real glyphs for loading text",
    );
    assertCondition(createdCanvas !== rendererCanvas, "text and renderer canvases must be distinct");
    assertCondition(rendererCanvas !== canvas, "created canvas must not alias the host canvas");
    assertCondition(
      rendererCanvas.width === dimensions.width && rendererCanvas.height === dimensions.height,
      "text canvas sizing must not resize the renderer",
    );
    assertCondition(typeof canvas.getContext === "function", "host canvas.getContext must exist");
    return { windowAlias: true, canvasTag: createdCanvas.tagName ?? "CANVAS", independentCanvases: true };
  });
}
