import { RGBAFormat, UnsignedByteType } from "three";
import { describe, expect, it } from "vitest";
import { softCircleDataTexture } from "../src/textures.js";

function alpha(data: Uint8Array, size: number, x: number, y: number): number {
  return data[(y * size + x) * 4 + 3] as number;
}

describe("softCircleDataTexture", () => {
  it("builds an RGBA byte texture whose alpha falls off radially", () => {
    const texture = softCircleDataTexture(5, 0.25);
    expect(texture.image.width).toBe(5);
    expect(texture.image.height).toBe(5);
    expect(texture.format).toBe(RGBAFormat);
    expect(texture.type).toBe(UnsignedByteType);
    // `needsUpdate` is a setter without a getter in three r185; the bumped version is the
    // observable upload flag, and a fresh texture starts at zero.
    expect(texture.version).toBe(1);

    const data = texture.image.data as Uint8Array;
    // Every pixel is opaque white in RGB; only the alpha channel carries the falloff.
    expect([data[0], data[1], data[2]]).toEqual([255, 255, 255]);
    // Centre, half-radius edge midpoint, half-radius diagonal, rim and corner — expected values
    // from min(1, (1 - d) / (1 - hardness)) ** 1.6 rounded to bytes.
    expect(alpha(data, 5, 2, 2)).toBe(255);
    expect(alpha(data, 5, 3, 2)).toBe(133);
    expect(alpha(data, 5, 3, 3)).toBe(57);
    expect(alpha(data, 5, 4, 2)).toBe(0);
    expect(alpha(data, 5, 4, 4)).toBe(0);
  });

  it("keeps a solid core out to the rim at hardness 1", () => {
    const data = softCircleDataTexture(5, 1).image.data as Uint8Array;
    expect(alpha(data, 5, 2, 2)).toBe(255);
    expect(alpha(data, 5, 3, 2)).toBe(255);
    expect(alpha(data, 5, 3, 3)).toBe(255);
    expect(alpha(data, 5, 4, 2)).toBe(0);
    expect(alpha(data, 5, 4, 4)).toBe(0);
  });

  it("defaults to a 64px quarter-hardness sprite", () => {
    const texture = softCircleDataTexture();
    expect(texture.image.width).toBe(64);
    const data = texture.image.data as Uint8Array;
    expect(data.length).toBe(64 * 64 * 4);
    expect(alpha(data, 64, 32, 32)).toBe(255);
    expect(alpha(data, 64, 63, 63)).toBe(0);
  });

  it("fails closed for invalid size and hardness", () => {
    expect(() => softCircleDataTexture(0)).toThrow(/size/);
    expect(() => softCircleDataTexture(8.5)).toThrow(/size/);
    expect(() => softCircleDataTexture(16, -0.1)).toThrow(/hardness/);
    expect(() => softCircleDataTexture(16, 1.5)).toThrow(/hardness/);
    expect(() => softCircleDataTexture(16, Number.NaN)).toThrow(/hardness/);
  });
});
