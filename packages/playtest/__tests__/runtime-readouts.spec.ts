import { expect, test } from "vitest";

import { isRuntimeReadout } from "../src/runner/runner.js";

/**
 * Round 9's vanilla arm published its debug HUD through the bridge's documented `diagnostics`
 * channel and lost both sealed scenarios to it: `{id:"fps",label:"FPS",value:30}` was counted as a
 * runtime error, so a proof asserting `noRuntimeDiagnostics` failed the build for owning a frame
 * counter. A game that used the documented API as documented could not pass.
 */
test("a labelled scalar is a readout, not a runtime error", () => {
  expect(isRuntimeReadout({ id: "fps", label: "FPS", value: 30 })).toBe(true);
  expect(isRuntimeReadout({ id: "coins", label: "Coins", value: 0 })).toBe(true);
  expect(isRuntimeReadout({ id: "backend", label: "Backend", value: "webgpu" })).toBe(true);
  expect(isRuntimeReadout({ label: "Paused", value: false })).toBe(true);
});

/**
 * The other half, and the half that matters more. This package fails closed: an error counter that
 * quietly stops counting is the defect it exists to prevent, so anything that is not unmistakably a
 * readout stays an error. Nothing here is a judgement call about intent — an entry either declares
 * the readout shape or it does not.
 */
test("anything that is not unmistakably a readout stays a runtime error", () => {
  // Declares itself an error, even while wearing the readout shape.
  expect(isRuntimeReadout({ label: "FPS", severity: "error", value: 30 })).toBe(false);
  expect(isRuntimeReadout({ label: "FPS", type: "error", value: 30 })).toBe(false);
  expect(isRuntimeReadout({ error: "boom", label: "FPS", value: 30 })).toBe(false);
  expect(isRuntimeReadout({ type: "pageerror" })).toBe(false);
  expect(isRuntimeReadout({ type: "assert" })).toBe(false);

  // Ambiguous shapes. None of these is reclassified, because guessing is how the counter goes
  // quiet.
  expect(isRuntimeReadout("TypeError: undefined is not a function")).toBe(false);
  expect(isRuntimeReadout({ message: "physics step diverged" })).toBe(false);
  expect(isRuntimeReadout({ label: "Contacts", value: { count: 3 } })).toBe(false);
  expect(isRuntimeReadout({ value: 30 })).toBe(false);
  expect(isRuntimeReadout({ label: "FPS" })).toBe(false);
  expect(isRuntimeReadout([{ label: "FPS", value: 30 }])).toBe(false);
  expect(isRuntimeReadout(null)).toBe(false);
  expect(isRuntimeReadout(undefined)).toBe(false);
  expect(isRuntimeReadout(30)).toBe(false);
});
