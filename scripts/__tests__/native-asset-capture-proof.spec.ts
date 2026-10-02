import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { expect, test } from "vitest";
import { requiredPlaytestCapabilities } from "../../packages/playtest/src/assertion-schema.js";
import { validatePlaytestScenario } from "../../packages/playtest/src/scenario.js";
import {
  assertNativeAssetCapture,
  inspectNativeAssetScreenshot,
} from "../native-asset-capture-proof.js";

const cleanConsole = [{ type: "log", text: "TN_NATIVE_SMOKE_FIRST_FRAME" }];

// Synthetic pixels are unit inputs only. Published evidence must come from the native runner.
function image(missingRegion = -1, transparent = false): Buffer {
  const png = new PNG({ width: 960, height: 640 });
  const colours = [
    [
      [20, 210, 225],
      [240, 85, 35],
    ],
    [
      [235, 45, 170],
      [245, 205, 35],
    ],
    [
      [95, 210, 60],
      [85, 100, 235],
    ],
  ];
  for (let y = 180; y < 440; y++)
    for (let x = 0; x < 960; x++) {
      const region = Math.floor(x / 320);
      if (region === missingRegion) continue;
      const rgb = colours[region]?.[x % 32 < 16 ? 0 : 1] ?? [0, 0, 0];
      png.data.set(
        [rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0, transparent ? 0 : 255],
        (y * 960 + x) * 4,
      );
    }
  return PNG.sync.write(png);
}

function report(): Parameters<typeof assertNativeAssetCapture>[0] {
  return {
    pass: true,
    runtime: "native",
    target: "desktop",
    assertionResults: [{ pass: true, id: "resources.0" }],
    diagnostics: [],
    capture: {
      target: "desktop",
      rendererKind: "webgpu",
      adapter: { description: "llvmpipe" },
      browserArgs: [],
      captureMethod: "device.screenshot",
      viewport: { width: 960, height: 640 },
    },
  };
}

test("requires both rendered colours for all three asset routes", () => {
  expect(inspectNativeAssetScreenshot(image()).counts).toHaveLength(3);
  for (const region of [0, 1, 2])
    expect(() => inspectNativeAssetScreenshot(image(region))).toThrow(`Specimen ${region}`);
});
test("rejects an empty or wrong-sized capture", () => {
  expect(() => inspectNativeAssetScreenshot(Buffer.from([]))).toThrow();
  expect(() =>
    inspectNativeAssetScreenshot(PNG.sync.write(new PNG({ width: 32, height: 32 }))),
  ).toThrow();
});
test("requires native provenance and nonempty live assertions", () => {
  expect(() => assertNativeAssetCapture(report(), cleanConsole)).not.toThrow();
  for (const mutation of [
    { assertionResults: [] },
    { pass: false },
    { capture: undefined },
    { capture: { target: "web", rendererKind: "webgpu", adapter: { description: "GPU" } } },
    { capture: { target: "desktop", rendererKind: "webgpu", adapter: { description: "" } } },
    { diagnostics: [{ severity: "warning", code: "TN_PLAYTEST_SOFTWARE_DEVICE_LOST" }] },
  ])
    expect(() =>
      assertNativeAssetCapture(
        { ...report(), ...mutation } as Parameters<typeof assertNativeAssetCapture>[0],
        cleanConsole,
      ),
    ).toThrow();
});

test("invisible RGB cannot satisfy the native screenshot proof", () => {
  expect(() => inspectNativeAssetScreenshot(image(-1, true))).toThrow("Specimen 0");
});

test.each([
  "[WebGPU] Device error (Validation): invalid texture format",
  "[FATAL] The GPU device was lost: driver reset",
  "TN_ASSETS_UNRESOLVED: authored model failed to load",
  "TypeError: native renderer failed",
])("native console failures remain fatal even when classified as log: %s", (text) => {
  expect(() =>
    assertNativeAssetCapture(report(), [...cleanConsole, { type: "log", text }]),
  ).toThrow(text);
});

test("native scenario retains supported diagnostics without requesting an unavailable observer", () => {
  const scenario = validatePlaytestScenario(
    JSON.parse(
      readFileSync(
        "examples/abyss-framework/playtests/vq-native-asset-capabilities.playtest.json",
        "utf8",
      ),
    ),
    "vq01",
  );
  expect(requiredPlaytestCapabilities(scenario, "desktop")).not.toContain("runtime.diagnostics");
  expect(scenario.assert?.diagnostics?.noConsoleErrors).toBe(true);
  expect(scenario.assert?.diagnostics?.runtimeReady).toBe(true);
});

test("native console evidence cannot be omitted or empty", () => {
  for (const console of [undefined, [], [{ type: "log", text: "no frame marker" }]]) {
    expect(() => assertNativeAssetCapture(report(), console)).toThrow();
  }
});

test("unclassified error-labelled native lines remain fatal", () => {
  expect(() =>
    assertNativeAssetCapture(report(), [
      ...cleanConsole,
      { type: "error", text: "Unexpected host failure" },
    ]),
  ).toThrow("Unexpected host failure");
});
