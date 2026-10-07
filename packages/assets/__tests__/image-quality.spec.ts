import { describe, expect, it } from "vitest";
import { deltaE00, imageQuality } from "../src/image-quality.js";
import { measureKtx2 } from "../src/image-quality.js";
import { encodeToKTX2 } from "../src/ktx2-encoder.js";

function pixels(noise = false): Uint8Array {
  const data = new Uint8Array(32 * 32 * 4);
  let seed = 123;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i + c] = noise ? seed >>> 24 : 128;
    }
    data[i + 3] = 255;
  }
  return data;
}

describe("image quality instrument", () => {
  it("scores identical pixels at 1 and rejects unrelated noise", () => {
    const data = pixels();
    expect(imageQuality(data, data, 32, 32).ssim).toBe(1);
    expect(imageQuality(data, data, 32, 32).meanDeltaE00).toBe(0);
    expect(imageQuality(data, pixels(true), 32, 32).status).toBe("below-floor");
  });

  it("matches CIEDE2000 reference pairs, including hue wrap", () => {
    expect(deltaE00([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
    expect(deltaE00([50, 0, 0], [50, -1, 2])).toBeCloseTo(2.3669, 4);
    expect(deltaE00([50, 2.49, -0.001], [50, -2.49, 0.001])).toBeCloseTo(7.1792, 4);
  });

  it("a badly compressed synthetic image fails while a flat one passes", async () => {
    for (const noise of [false, true]) {
      const data = pixels(noise);
      const encoded = await encodeToKTX2(data, {
        imageDecoder: async () => ({ data, width: 32, height: 32 }),
        isUASTC: false,
        qualityLevel: 1,
      });
      const score = await measureKtx2(data, encoded, 32, 32);
      expect(score.status).toBe(noise ? "below-floor" : "pass");
    }
  });

  it("detects alpha coverage changes independently of identical RGB", () => {
    const source = pixels();
    const output = source.slice();
    source[3] = 127;
    output[3] = 128;
    const score = imageQuality(source, output, 32, 32, { alphaThresholds: [0.5] });
    expect(score.ssim).toBe(1);
    expect(score.meanDeltaE00).toBe(0);
    expect(score.alpha.coverage[0]).toMatchObject({ changedPixels: 1 });
    expect(score.status).toBe("below-floor");
    source[7] = 128;
    output[7] = 127;
    const swapped = imageQuality(source, output, 32, 32, { alphaThresholds: [0.5] });
    expect(swapped.alpha.coverage[0]?.source).toBe(swapped.alpha.coverage[0]?.decoded);
    expect(swapped.alpha.coverage[0]?.changedPixels).toBe(2);
    expect(swapped.status).toBe("below-floor");
  });

  it("fails the colour floor even when luma SSIM passes", () => {
    const source = pixels();
    const output = source.slice();
    for (let i = 0; i < output.length; i += 4) {
      output[i] = 255;
      output[i + 1] = 101;
      output[i + 2] = 21;
    }
    const score = imageQuality(source, output, 32, 32);
    expect(score.ssim).toBeGreaterThan(0.95);
    expect(score.meanDeltaE00).toBeGreaterThan(3);
    expect(score.status).toBe("below-floor");
  });

  it("does not certify normal/data slots with colour metrics", () => {
    const data = pixels();
    expect(imageQuality(data, data, 32, 32, { slots: ["normalTexture"] })).toMatchObject({
      status: "unvalidated-slots",
      meanDeltaE00: null,
    });
    expect(
      imageQuality(data, data, 32, 32, { slots: ["baseColorTexture", "normalTexture"] }).status,
    ).toBe("unvalidated-slots");
  });

  it("fails closed on invalid dimensions, pixels and alpha thresholds", () => {
    expect(() => imageQuality(pixels(), new Uint8Array(4), 32, 32)).toThrow();
    expect(() => imageQuality(pixels(), pixels(), 0, 32)).toThrow();
    expect(() =>
      imageQuality(pixels(), pixels(), 32, 32, { alphaThresholds: [Number.NaN] }),
    ).toThrow();
  });
});
