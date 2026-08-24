import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const bindingsSource = readFileSync(
  fileURLToPath(new URL("../src/webgpu/bindings.cpp", import.meta.url)),
  "utf8",
);

function assertPresentationBridge(source) {
  assert.match(
    source,
    /RGBA8UnormSrgb[\s\S]*return WGPUTextureFormat_RGBA8Unorm/u,
    "an sRGB-only RGBA surface must expose a linear canvas texture",
  );
  assert.match(
    source,
    /WGPUTextureUsage_RenderAttachment[\s\S]*WGPUTextureUsage_TextureBinding[\s\S]*WGPUTextureUsage_CopySrc/u,
  );
  assert.match(source, /fn srgbToLinear\(value: vec3f\)/u);
  assert.match(source, /colorTarget\.format = state->nativeSurfaceFormat/u);
  assert.match(source, /presentLinearTextureToSrgbSurface\(state, state->currentTextureView\)/u);
  assert.ok(
    (source.match(/configuredFormat != linearSurfaceFormat\(state->nativeSurfaceFormat\)/gu) ?? [])
      .length >= 1,
    "the shared canvas configuration must fail closed on a mismatched format",
  );
  assert.equal(
    (source.match(/installCanvasContextBindings\(state, canvasContext(?:, (?:false|true))?\)/gu) ?? [])
      .length,
    2,
    "main and offscreen canvases must share the table-driven context bindings",
  );
}

test("sRGB-only native surfaces present Three.js encoded output through a linear canvas", () => {
  assert.doesNotThrow(() => assertPresentationBridge(bindingsSource));
});

test("presentation contract rejects removal of the inverse transfer", () => {
  const withoutInverseTransfer = bindingsSource.replace(
    "fn srgbToLinear(value: vec3f) -> vec3f",
    "fn preserveEncodedValue(value: vec3f) -> vec3f",
  );
  assert.throws(() => assertPresentationBridge(withoutInverseTransfer));
});
