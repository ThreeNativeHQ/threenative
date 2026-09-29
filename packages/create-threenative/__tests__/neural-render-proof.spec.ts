import assert from "node:assert/strict";
import { test } from "vitest";
import { verifyFixturePixels } from "../agent-docs/examples/neural-rendering/fixture-proof.js";

test("diagnostic proof checks actual HDR pixels, channel routing, alpha and current source", () => {
  const original = new Uint16Array([0x4400, 0x3400, 0x3800, 0x3c00]);
  const enhanced = new Uint16Array([0x3800, 0x3400, 0x4400, 0x3c00]);
  const proof = verifyFixturePixels(original, enhanced, [4, 0.25, 0.5]);
  assert.equal(proof.pixels, 1);
  assert.equal(proof.changedPixels, 1);
  assert.throws(() => verifyFixturePixels(original, original, [4, 0.25, 0.5]), /CHANNEL/);
  assert.throws(() => verifyFixturePixels(original, enhanced, [0.25, 3, 1]), /SOURCE/);
});

test("an empty, all-zero, truncated or non-HDR readback cannot pass the fixture", () => {
  for (const pixels of [new Uint16Array(), new Uint16Array(4), new Uint16Array(3), new Uint16Array([0x3c00, 0, 0, 0x3c00])]) {
    assert.throws(() => verifyFixturePixels(pixels, pixels, [4, 0.25, 0.5]));
  }
});
