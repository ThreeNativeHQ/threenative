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
  assert.match(
    mainCanvasContext,
    /syncSurfaceSizeToCanvas\(g_engine->getGlobalProperty\("canvas"\)\)[\s\S]*?WGPUTexture texture = getCurrentSwapchainTexture\(\)/u,
    "the main canvas must synchronize before it obtains the color attachment",
  );

  const screenshotCapture = source.slice(
    source.indexOf("// Copy texture to screenshot buffer ONLY"),
    source.indexOf("// Present the surface only if:"),
  );
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
