import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const bindingsSource = readFileSync(
  fileURLToPath(new URL("../src/webgpu/bindings.cpp", import.meta.url)),
  "utf8",
);

function assertResizeAttachmentContract(source) {
  assert.match(
    source,
    /static bool readCanvasDimension\([\s\S]*?getProperty\(canvas, propertyName\)/u,
    "surface synchronization must read the canvas backing dimensions",
  );
  assert.match(
    source,
    /static bool syncSurfaceSizeToCanvas\([\s\S]*?config\.width = width;[\s\S]*?config\.height = height;[\s\S]*?wgpuSurfaceConfigure\(g_surface, &config\)/u,
    "canvas backing dimensions must reconfigure the native surface before acquisition",
  );
  const mainCanvasContext = source.slice(
    source.indexOf("// Create GPUCanvasContext"),
    source.indexOf("// Set global canvas"),
  );
  // Acquisition became idempotent within a frame, so the texture is declared first and assigned
  // in the branch that actually acquires. The invariant is unchanged and still the point: the
  // surface is reconfigured to the canvas size before anything acquires an image from it.
  assert.match(
    mainCanvasContext,
    /syncSurfaceSizeToCanvas\(g_engine->getGlobalProperty\("canvas"\)\)[\s\S]*?texture = getCurrentSwapchainTexture\(\)/u,
    "the main canvas must synchronize before it obtains the color attachment",
  );

  // Bounded by the capture function's own end. This slice used to end at a comment that no longer
  // exists, so indexOf returned -1 and it silently searched the rest of the file -- the assertion
  // still passed while scoping nothing.
  const captureStart = source.indexOf("static void captureFrameScreenshot()");
  assert.notEqual(captureStart, -1, "screenshot capture must live in captureFrameScreenshot()");
  const captureEnd = source.indexOf("static void presentPendingSurface()", captureStart);
  assert.notEqual(captureEnd, -1, "captureFrameScreenshot() must precede presentPendingSurface()");
  const screenshotCapture = source.slice(captureStart, captureEnd);
  assert.match(
    screenshotCapture,
    /g_screenshotBufferSize = requiredSize;[\s\S]*?\}\s*g_screenshotBytesPerRow = bytesPerRow;/u,
    "screenshot readback must refresh its row stride for every canvas size",
  );
}

test("native canvas resize keeps surface color and depth attachments the same size", () => {
  assert.doesNotThrow(() => assertResizeAttachmentContract(bindingsSource));
});

test("native surface acquisition cannot bypass canvas resize propagation", () => {
  const withoutResizeSync = bindingsSource.replace(
    'syncSurfaceSizeToCanvas(g_engine->getGlobalProperty("canvas"))',
    "// resize synchronization removed",
  );
  assert.throws(() => assertResizeAttachmentContract(withoutResizeSync));
});
