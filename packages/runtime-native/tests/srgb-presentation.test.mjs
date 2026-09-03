import assert from "node:assert/strict";
import { test } from "vitest";

import { nativeDefinition } from "../../../test-support/native-definition.js";

function presentationDefinitions() {
  return {
    configure: nativeDefinition("configureCanvasContext").text,
    createTexture: nativeDefinition("createLinearPresentationTexture").text,
    format: nativeDefinition("linearSurfaceFormat").text,
    pipeline: nativeDefinition("ensureSrgbPresentationPipeline").text,
    present: nativeDefinition("presentPendingSurface").text,
  };
}

function assertPresentationBridge(definitions) {
  assert.match(
    definitions.format,
    /RGBA8UnormSrgb[\s\S]*return WGPUTextureFormat_RGBA8Unorm/u,
    "an sRGB-only RGBA surface must expose a linear canvas texture",
  );
  assert.match(
    definitions.createTexture,
    /WGPUTextureUsage_RenderAttachment[\s\S]*WGPUTextureUsage_TextureBinding[\s\S]*WGPUTextureUsage_CopySrc/u,
  );
  assert.match(definitions.pipeline, /fn srgbToLinear\(value: vec3f\)/u);
  assert.match(definitions.pipeline, /colorTarget\.format = state->presentation\.nativeSurfaceFormat/u);
  assert.match(
    definitions.present,
    /presentLinearTextureToSrgbSurface\(state, state->presentation\.currentTextureView\)/u,
  );
  assert.match(
    definitions.configure,
    /configuredFormat != linearSurfaceFormat\(state->presentation\.nativeSurfaceFormat\)/u,
    "the shared canvas configuration must fail closed on a mismatched format",
  );
}

function assertSuccessfulPresentAccounting(definitions) {
  const present = definitions.present;
  const result = present.indexOf("const bool presented =");
  const success = present.indexOf("if (presented)");
  const count = present.indexOf("state->profiling.presentCount += 1;");
  const marker = present.indexOf("TN_SURFACE_FRAME:");
  assert.ok(result >= 0, "surface presentation must record the bridge result");
  assert.ok(success > result, "successful-present accounting must follow the bridge result");
  assert.ok(count > success, "presentCount must increase only after a successful present");
  assert.ok(marker > success, "TN_SURFACE_FRAME must describe a successful present");
}

test("sRGB-only native surfaces present Three.js encoded output through a linear canvas", () => {
  assert.doesNotThrow(() => {
    const definitions = presentationDefinitions();
    assertPresentationBridge(definitions);
    assertSuccessfulPresentAccounting(definitions);
  });
});

test("presentation contract rejects removal of the inverse transfer", () => {
  const definitions = presentationDefinitions();
  definitions.pipeline = definitions.pipeline.replace(
    "fn srgbToLinear(value: vec3f) -> vec3f",
    "fn preserveEncodedValue(value: vec3f) -> vec3f",
  );
  assert.throws(() => assertPresentationBridge(definitions));
});
