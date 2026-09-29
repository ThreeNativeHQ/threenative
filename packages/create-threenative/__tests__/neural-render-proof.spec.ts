import assert from "node:assert/strict";
import { test } from "vitest";
import { verifyFixturePixels } from "../agent-docs/examples/neural-rendering/fixture-proof.js";

/** float32 -> float16 bits, so the fixture can be written the way the GPU would store it. */
function toHalf(value: number): number {
  if (value === 0) return 0;
  const sign = value < 0 ? 0x8000 : 0;
  const magnitude = Math.abs(value);
  const exponent = Math.floor(Math.log2(magnitude));
  const biased = exponent + 15;
  if (biased <= 0) return sign | Math.round(magnitude / 2 ** -24);
  if (biased >= 31) return sign | 0x7c00;
  return sign | (biased << 10) | Math.min(1023, Math.round((magnitude / 2 ** exponent - 1) * 1024));
}

test("diagnostic proof re-derives the GPU grade, preserves alpha and checks the current source", () => {
  // [4, 0.25, 0.5] plus one saturated mid-grey, graded exactly as the shader does.
  const original = new Uint16Array([
    0x4400, 0x3400, 0x3800, 0x3c00, 0x3800, 0x3800, 0x3800, 0x3c00,
  ]);
  const graded = (value: number, luma: number): number => {
    const saturated = luma + (value - luma) * 1.45;
    return Math.max(0, (saturated - 0.18) * 1.18 + 0.18);
  };
  const luma = (r: number, g: number, b: number): number => r * 0.2126 + g * 0.7152 + b * 0.0722;
  const write = (target: Uint16Array, offset: number, r: number, g: number, b: number): void => {
    const l = luma(r, g, b);
    target[offset] = toHalf(graded(r, l));
    target[offset + 1] = toHalf(graded(g, l));
    target[offset + 2] = toHalf(graded(b, l));
  };
  const enhanced = new Uint16Array(original.length);
  enhanced[3] = original[3] ?? 0;
  enhanced[7] = original[7] ?? 0;
  write(enhanced, 0, 4, 0.25, 0.5);
  write(enhanced, 4, 0.5, 0.5, 0.5);

  const proof = verifyFixturePixels(original, enhanced, [4, 0.25, 0.5]);
  assert.equal(proof.pixels, 2);
  assert.ok(proof.changedPixels > 0);
  assert.throws(() => verifyFixturePixels(original, original, [4, 0.25, 0.5]), /GRADE/);
  assert.throws(() => verifyFixturePixels(original, enhanced, [0.25, 3, 1]), /SOURCE/);
});

test("an empty, all-zero, truncated or non-HDR readback cannot pass the fixture", () => {
  for (const pixels of [
    new Uint16Array(),
    new Uint16Array(4),
    new Uint16Array(3),
    new Uint16Array([0x3c00, 0, 0, 0x3c00]),
  ]) {
    assert.throws(() => verifyFixturePixels(pixels, pixels, [4, 0.25, 0.5]));
  }
});
