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
  assert.match(source, /colorTarget\.format = g_nativeSurfaceFormat/u);
  assert.match(source, /presentLinearTextureToSrgbSurface\(g_currentTextureView\)/u);
  assert.ok(
    (source.match(/configuredFormat != linearSurfaceFormat\(g_nativeSurfaceFormat\)/gu) ?? [])
      .length >= 2,
    "main and offscreen canvas configuration must both fail closed on a mismatched format",
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
