import { expect, test } from "vitest";
import { assertFluidCapture } from "../fluid-collision-proof.js";

const clean = {
  pass: true,
  diagnostics: [],
  capture: {
    rendererKind: "webgpu",
    adapter: { vendor: "google", architecture: "swiftshader" },
  },
  assertionResults: [{ id: "resources.collision", pass: true }],
};

test("accepts a clean, identified WebGPU collision proof", () => {
  expect(() => assertFluidCapture(clean)).not.toThrow();
});

test("rejects missing assertions, failed assertions, and failed runs", () => {
  expect(() => assertFluidCapture({ ...clean, assertionResults: [] })).toThrow("assertions");
  expect(() => assertFluidCapture({ ...clean, assertionResults: [{ pass: false }] })).toThrow(
    "assertions",
  );
  expect(() => assertFluidCapture({ ...clean, pass: false })).toThrow("failed");
});

test("rejects a downgraded software-device loss and unrelated diagnostics", () => {
  for (const code of ["TN_PLAYTEST_SOFTWARE_DEVICE_LOST", "TN_PLAYTEST_CONSOLE_ERROR"]) {
    expect(() => assertFluidCapture({ ...clean, diagnostics: [{ code }] })).toThrow(code);
  }
});

test("requires actual WebGPU and a nonempty adapter identity", () => {
  expect(() => assertFluidCapture({ ...clean, capture: undefined })).toThrow("WebGPU");
  expect(() => assertFluidCapture({ ...clean, capture: { rendererKind: "webgl2" } })).toThrow(
    "WebGPU",
  );
  expect(() =>
    assertFluidCapture({ ...clean, capture: { rendererKind: "webgpu", adapter: {} } }),
  ).toThrow("adapter");
});

const collisionId = "resource.FluidCollision.collisionPassed";
const gateDisabled = {
  ...clean,
  pass: false,
  diagnostics: [{ code: "TN_PLAYTEST_RESOURCE_ASSERTION_FAILED" }],
  assertionResults: [
    { id: collisionId, pass: false },
    { id: "finite", pass: true },
  ],
};

test("accepts only the expected collision failure when the gate is disabled", () => {
  expect(() => assertFluidCapture(gateDisabled, collisionId)).not.toThrow();
  expect(() => assertFluidCapture(clean, collisionId)).toThrow();
  expect(() => assertFluidCapture({ ...gateDisabled, diagnostics: [] }, collisionId)).toThrow();
});

test("negative control cannot conceal another assertion or device loss", () => {
  expect(() =>
    assertFluidCapture(
      {
        ...gateDisabled,
        assertionResults: [...gateDisabled.assertionResults, { id: "finite", pass: false }],
      },
      collisionId,
    ),
  ).toThrow();
  expect(() =>
    assertFluidCapture(
      {
        ...gateDisabled,
        diagnostics: [...gateDisabled.diagnostics, { code: "TN_PLAYTEST_SOFTWARE_DEVICE_LOST" }],
      },
      collisionId,
    ),
  ).toThrow("TN_PLAYTEST_SOFTWARE_DEVICE_LOST");
});
