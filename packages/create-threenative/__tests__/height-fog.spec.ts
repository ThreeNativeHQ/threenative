import { describe, expect, it } from "vitest";
import {
  HEIGHT_FOG,
  type HeightFogParams,
  distanceDensity,
  heightFogDepth,
  heightFogTransmittance,
} from "../templates/starter/src/render/sky.js";

const params: HeightFogParams = { ...HEIGHT_FOG };

/** Midpoint march of the same density along the ray, base-2 optical depth. */
function march(p: HeightFogParams, cameraY: number, fragmentY: number, length: number): number {
  const steps = 4096;
  let depth = 0;
  for (let i = 0; i < steps; i++) {
    const t = ((i + 0.5) / steps) * length;
    const y = cameraY + ((fragmentY - cameraY) * t) / length;
    const exponent = Math.min(127, Math.max(-127, -p.heightFalloff * (y - p.fogHeight)));
    if (t >= p.startDistance) depth += p.density * 2 ** exponent * (length / steps);
  }
  return depth;
}

describe("height fog", () => {
  it("should match a 4096-step march for cameras below, inside and above the layer", () => {
    const cases: [number, number, number][] = [];
    for (const cameraY of [-30, 0, 2, 40, 300]) {
      for (const degrees of [-89, -45, -10, 0, 10, 45, 89]) {
        for (const length of [5, 150, 1000]) {
          cases.push([cameraY, cameraY + length * Math.sin((degrees * Math.PI) / 180), length]);
        }
      }
    }
    for (const [cameraY, fragmentY, length] of cases) {
      const closed = heightFogDepth(params, cameraY, fragmentY, length);
      const numeric = march(params, cameraY, fragmentY, length);
      expect(Math.abs(closed - numeric)).toBeLessThanOrEqual(
        0.01 * Math.max(numeric, 1e-9) + 1e-12,
      );
    }
  });

  it("should stay finite at the exponent clamp", () => {
    const steep = { ...params, heightFalloff: 5 };
    const depth = heightFogDepth(steep, -1000, 1000, 2000);
    expect(Number.isFinite(depth)).toBe(true);
    expect(heightFogTransmittance(steep, -1000, 1000, 2000)).toBe(0);
  });

  it("should fog low ground more than a ridge at the same distance", () => {
    const low = heightFogTransmittance(params, 2, 2, 400);
    const ridge = heightFogTransmittance(params, 2, 150, 400);
    expect(low).toBeLessThan(ridge);
  });

  it("should keep the old eye-level haze within 2%", () => {
    const dist = distanceDensity(params);
    const total = Math.exp(-((dist * 150) ** 2)) * heightFogTransmittance(params, 2, 2, 150);
    expect(Math.abs(total - Math.exp(-((0.003 * 150) ** 2)))).toBeLessThan(
      0.02 * Math.exp(-((0.003 * 150) ** 2)),
    );
  });

  it("should never be more transparent than the distance term, and stay opaque where it is", () => {
    // PRD-461 recipe: linear near 128 m, far 256 m. The product is 0 at far from far above the layer.
    const smooth = (near: number, far: number, z: number) => {
      const x = Math.min(1, Math.max(0, (z - near) / (far - near)));
      return x * x * (3 - 2 * x);
    };
    for (const cameraY of [0, 500]) {
      const distanceT = 1 - smooth(128, 256, 256);
      const combined = distanceT * heightFogTransmittance(params, cameraY, cameraY, 256);
      expect(combined).toBe(0);
    }
    for (const z of [10, 130, 200]) {
      const distanceT = 1 - smooth(128, 256, z);
      expect(distanceT * heightFogTransmittance(params, 2, 2, z)).toBeLessThanOrEqual(distanceT);
    }
  });
});
