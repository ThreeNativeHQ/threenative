import { assertCondition, startBehaviorScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  // The scene renders into the host canvas, because that is the one the harness screenshots
  // (`captureBrowserCanvas` takes `#c`). Rendering into a canvas created here instead left `#c`
  // without a frame, and the row failed as `capture is uniform: expected more than one RGBA color`
  // on every runner while every assertion below still passed.
  //
  // `detachedCanvas` keeps what that indirection was there to prove: `createElement` plus
  // `appendChild` produce a real, independent canvas, and sizing it does not disturb the renderer's
  // own canvas. It is asserted against, never rendered into.
  const detachedCanvas = document.createElement("canvas");
  detachedCanvas.width = dimensions.width;
  detachedCanvas.height = dimensions.height;
  document.body.appendChild(detachedCanvas);
  return startBehaviorScene(canvas, dimensions, "document-window-stubs", async () => {
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
    textContext.font = "600 17px ui-monospace, monospace";
    assertCondition(Math.abs(textContext.measureText("iiii").width - textContext.measureText("WWWW").width) < 0.1, "CSS monospace fallback must preserve equal glyph advances");
    assertCondition(
      textContext.measureText("PREPARING TERRAIN").width > 20,
      "Canvas2D must resolve real glyphs for loading text",
    );
    assertCondition(typeof textContext.ellipse === "function", "Canvas2D must draw procedural ellipses");
    textContext.fillStyle = "#ff0000";
    textContext.beginPath();
    textContext.ellipse(32, 32, 20, 8, Math.PI / 2, 0, Math.PI * 2);
    textContext.fill();
    const ellipsePixels = textContext.getImageData(0, 0, 64, 64).data;
    assertCondition(ellipsePixels[(16 * 64 + 32) * 4] > 240, "rotated ellipse must cover its long axis");
    assertCondition(ellipsePixels[(32 * 64 + 16) * 4 + 3] === 0, "ellipse must preserve its short axis");
    let rejectedRadius = false;
    try {
      textContext.ellipse(0, 0, -1, 8, 0, 0, 1);
    } catch {
      rejectedRadius = true;
    }
    assertCondition(rejectedRadius, "ellipse must reject a negative radius");
    assertCondition(typeof textContext.createLinearGradient === "function", "Canvas2D must draw procedural gradients");
    textContext.clearRect(0, 0, 64, 64);
    const gradient = textContext.createLinearGradient(0, 0, 64, 0);
    gradient.addColorStop(0, "#ff0000");
    gradient.addColorStop(1, "#0000ff");
    textContext.fillStyle = gradient;
    textContext.fillRect(0, 0, 64, 16);
    let gradientPixels = textContext.getImageData(0, 0, 64, 16).data;
    assertCondition(gradientPixels[0] > 240 && gradientPixels[63 * 4 + 2] > 240, "gradient must preserve endpoint colors");
    assertCondition(gradientPixels[32 * 4] > 115 && gradientPixels[32 * 4 + 2] > 115, "gradient must interpolate its middle");
    gradient.addColorStop(0.5, "#00ff00");
    textContext.fillRect(0, 0, 64, 16);
    gradientPixels = textContext.getImageData(0, 0, 64, 16).data;
    assertCondition(gradientPixels[32 * 4 + 1] > 240, "assigned gradients must observe later color stops");
    const secondContext = document.createElement("canvas").getContext("2d");
    secondContext.fillStyle = gradient;
    secondContext.fillRect(0, 0, 64, 16);
    assertCondition(secondContext.getImageData(32, 0, 1, 1).data[1] > 240, "gradients must work on another canvas");
    let rejectedStop = false;
    try { gradient.addColorStop(-1, "#ffffff"); } catch { rejectedStop = true; }
    assertCondition(rejectedStop, "gradient must reject an out-of-range stop");
    textContext.strokeStyle = "#ffffff";
    textContext.lineWidth = 16;
    textContext.lineCap = "round";
    textContext.beginPath();
    textContext.moveTo(16, 48);
    textContext.lineTo(48, 48);
    textContext.stroke();
    assertCondition(textContext.getImageData(9, 48, 1, 1).data[3] > 200, "Canvas2D round caps must extend beyond path endpoints");
    textContext.save();
    textContext.lineCap = "square";
    textContext.restore();
    assertCondition(textContext.lineCap === "round", "restoring state must restore the line cap getter");
    textContext.lineCap = "invalid";
    assertCondition(textContext.lineCap === "round", "invalid line caps must leave the current style unchanged");
    // Read back an actual canvas upload: CPU drawing checks alone miss a black
    // CanvasTexture when the native frame stream drops the external-image source.
    const device = await (await navigator.gpu.requestAdapter()).requestDevice();
    const uploaded = device.createTexture({ size: [64, 16], format: "rgba8unorm", usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT });
    const readback = device.createBuffer({ size: 256 * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    device.queue.copyExternalImageToTexture({ source: createdCanvas }, { texture: uploaded }, [64, 16]);
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: uploaded }, { buffer: readback, bytesPerRow: 256 }, [64, 16]);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const uploadedPixels = new Uint8Array(readback.getMappedRange());
    assertCondition(uploadedPixels[0] > 240 && uploadedPixels[32 * 4 + 1] > 240, "Canvas2D pixels must reach the GPU texture");
    readback.unmap();
    readback.destroy();
    uploaded.destroy();
    assertCondition(createdCanvas !== detachedCanvas, "text and detached canvases must be distinct");
    assertCondition(detachedCanvas !== canvas, "created canvas must not alias the host canvas");
    assertCondition(
      canvas.width === dimensions.width && canvas.height === dimensions.height,
      "text canvas sizing must not resize the renderer",
    );
    assertCondition(typeof canvas.getContext === "function", "host canvas.getContext must exist");
    return { windowAlias: true, canvasTag: createdCanvas.tagName ?? "CANVAS", independentCanvases: true };
  });
}
