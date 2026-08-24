import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const contextSource = readFileSync(
  fileURLToPath(new URL("../src/webgpu/context.cpp", import.meta.url)),
  "utf8",
);
const bindingsSource = readFileSync(
  fileURLToPath(new URL("../src/webgpu/bindings.cpp", import.meta.url)),
  "utf8",
);

function assertScreenshotFormatContract(context, bindings) {
  assert.match(bindings, /getScreenshotFormat\(BindingsState\* state\)[\s\S]*state->surfaceFormat/u);
  assert.match(context, /WGPUTextureFormat_BGRA8UnormSrgb/u);
  assert.match(context, /WGPUTextureFormat_RGBA8UnormSrgb/u);
  assert.match(context, /output\[0\] = bgra \? pixel\[2\] : pixel\[0\]/u);
  assert.match(context, /output\[2\] = bgra \? pixel\[0\] : pixel\[2\]/u);
  assert.match(context, /Unsupported surface format/u);
  assert.ok(
    (context.match(/copyScreenshotPixels\(/gu) ?? []).length >= 3,
    "saveScreenshot and captureFrame must share the format-aware pixel copy",
  );
}

test("renderer screenshots preserve RGBA surfaces and swizzle BGRA surfaces", () => {
  assert.doesNotThrow(() => assertScreenshotFormatContract(contextSource, bindingsSource));
});

test("renderer screenshot contract fails if RGBA is silently treated as BGRA", () => {
  const alwaysSwizzles = contextSource.replace(
    "output[0] = bgra ? pixel[2] : pixel[0];",
    "output[0] = pixel[2];",
  );
  assert.throws(() => assertScreenshotFormatContract(alwaysSwizzles, bindingsSource));
});
