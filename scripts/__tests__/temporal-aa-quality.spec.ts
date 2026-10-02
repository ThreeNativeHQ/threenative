import { describe, expect, it } from "vitest";
import { linearFrame, measureSequence } from "../temporal-aa-quality.js";

const image = (width: number, height: number, colour: (x: number, y: number) => number[]) => ({
  width,
  height,
  data: Uint8Array.from(
    Array.from({ length: width * height }, (_, i) => [
      ...colour(i % width, Math.floor(i / width)),
      255,
    ]).flat(),
  ),
});

describe("temporal sequence measurements", () => {
  it("integrates the supersampled reference in linear light rather than averaging encoded sRGB", () => {
    const result = linearFrame(
      image(2, 2, (x) => (x === 0 ? [0, 0, 0] : [255, 255, 255])),
      1,
      1,
    );
    expect([...result.rgb]).toEqual([0.5, 0.5, 0.5]);
  });

  it("rejects incompatible raster dimensions and incomplete sequences", () => {
    expect(() =>
      linearFrame(
        image(3, 2, () => [0, 0, 0]),
        2,
        2,
      ),
    ).toThrow(/integer/);
    expect(() => measureSequence([], [], 2)).toThrow(/sequence/);
  });

  const reference = Array.from({ length: 6 }, (_, frame) =>
    linearFrame(
      image(24, 16, (x, y) => {
        if (x >= 3 && x < 13 && y >= 3 && y < 13) return frame < 3 ? [255, 0, 0] : [0, 0, 255];
        return x < 17 + (frame % 2) ? [0, 0, 0] : [255, 255, 255];
      }),
      24,
      16,
    ),
  );

  it("subtracts true scene movement: an exact moving reference has zero residual instability", () => {
    const result = measureSequence(reference, reference, 3);
    expect(result.edgeError).toBe(0);
    expect(result.residualInstability).toBe(0);
    expect(result.reveal.map((frame) => frame.staleFraction)).toEqual([0, 0, 0]);
    expect(result.revealedPixels).toBeGreaterThan(0);
  });

  it("detects frozen history on newly revealed pixels and distinguishes it from a correct frame", () => {
    const frozen = reference.map((frame, index) =>
      index < 3 ? frame : (reference[2] as typeof frame),
    );
    const result = measureSequence(reference, frozen, 3);
    expect(result.reveal.every((frame) => frame.staleFraction > 0.99)).toBe(true);
    expect(result.reveal.every((frame) => frame.meanAbsoluteError > 0.6)).toBe(true);
  });

  it("detects alternating edge errors even when their signed mean cancels", () => {
    const bad = reference.map((frame, index) => ({
      ...frame,
      rgb: Float64Array.from(frame.rgb, (value) => value + (index % 2 ? 0.1 : -0.1)),
    }));
    const result = measureSequence(reference, bad, 3);
    expect(result.edgeError).toBeCloseTo(0.1);
    expect(result.residualInstability).toBeCloseTo(0.2);
  });
});
