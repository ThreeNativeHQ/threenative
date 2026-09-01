import assert from "node:assert/strict";
import { test } from "vitest";

import { nativeDefinition } from "../../../test-support/native-definition.js";

function resizeAttachmentDefinitions() {
  return {
    capture: nativeDefinition("captureFrameScreenshot").text,
    currentTextureHandler: nativeDefinition("getCurrentCanvasTexture").text,
    readDimension: nativeDefinition("readCanvasDimension").text,
    syncSize: nativeDefinition("syncSurfaceSizeToCanvas").text,
  };
}

function assertResizeAttachmentContract(definitions) {
  assert.match(
    definitions.readDimension,
    /BindingsState\* state,[\s\S]*?getProperty\(canvas, propertyName\)/u,
    "surface synchronization must read the canvas backing dimensions",
  );
  assert.match(
    definitions.syncSize,
    /config\.width = width;[\s\S]*?config\.height = height;[\s\S]*?wgpuSurfaceConfigure\(state->surface, &config\)/u,
    "canvas backing dimensions must reconfigure the native surface before acquisition",
  );
  assert.match(
    definitions.currentTextureHandler,
    /syncSurfaceSizeToCanvas\(state, state->engine->getGlobalProperty\("canvas"\)\)[\s\S]*?texture = getCurrentSwapchainTexture\(state\)/u,
    "the shared canvas binding must synchronize before it obtains the color attachment",
  );
  assert.match(
    definitions.syncSize,
    /if \(!flushRecordedFrameOps\(state\)\) return false;[\s\S]*?releaseCurrentSurfaceTextureViews\(state\)/u,
    "surface resize must replay recorded work before releasing views still named by that work",
  );
  assert.match(
    definitions.capture,
    /state->screenshot\.screenshotBufferSize = requiredSize;[\s\S]*?\}\s*state->screenshot\.screenshotBytesPerRow = bytesPerRow;/u,
    "screenshot readback must refresh its row stride for every canvas size",
  );
}

test("native canvas resize keeps surface color and depth attachments the same size", () => {
  assert.doesNotThrow(() => assertResizeAttachmentContract(resizeAttachmentDefinitions()));
});

test("native surface acquisition cannot bypass canvas resize propagation", () => {
  const definitions = resizeAttachmentDefinitions();
  definitions.currentTextureHandler = definitions.currentTextureHandler.replace(
    'syncSurfaceSizeToCanvas(state, state->engine->getGlobalProperty("canvas"))',
    "resize synchronization removed",
  );
  assert.throws(() => assertResizeAttachmentContract(definitions));
});
