import { Quaternion, Vector3 } from "three";
import { vec2 } from "three/tsl";
import { describe, expect, it } from "vitest";
import { WaterSurface3D } from "../src/water-surface.js";

const reflection = { resolutionScale: 0.5 } as const;

function isNode(value: unknown): boolean {
  return (
    typeof value === "object" && value !== null && (value as { isNode?: boolean }).isNode === true
  );
}

describe("WaterSurface3D", () => {
  it("rejects malformed options rather than defaulting them", () => {
    expect(
      () => new WaterSurface3D(undefined as unknown as { level: number; maxThickness: number }),
    ).toThrow(/requires options/u);
    expect(() => new WaterSurface3D({ level: Number.NaN, maxThickness: 2 })).toThrow(/level/u);
    expect(() => new WaterSurface3D({ level: 0, maxThickness: 0 })).toThrow(/maxThickness/u);
    expect(() => new WaterSurface3D({ level: 0, maxThickness: -1 })).toThrow(/maxThickness/u);
    expect(
      () => new WaterSurface3D({ level: 0, maxThickness: 2, reflection: { resolutionScale: 0 } }),
    ).toThrow(/resolutionScale/u);
    expect(
      () => new WaterSurface3D({ level: 0, maxThickness: 2, reflection: { resolutionScale: 1.5 } }),
    ).toThrow(/resolutionScale/u);
  });

  it("puts the mirror plane at the water level facing up, and keeps it out of the scene graph", () => {
    const surface = new WaterSurface3D({ level: 12.5, maxThickness: 3, reflection });
    const target = surface.target;
    if (target === undefined) throw new Error("reflection target missing");

    // A water level is a world fact. Parenting the mirror to a scaled or rotated mesh — three's
    // own example does — skews the plane; this target belongs to no parent at all.
    expect(target.parent).toBeNull();
    expect(target.matrixWorld.elements[13]).toBeCloseTo(12.5, 6);
    const worldPosition = new Vector3().setFromMatrixPosition(target.matrixWorld);
    expect(worldPosition.y).toBeCloseTo(12.5, 6);

    // The reflector mirrors about the target's local +Z, so that axis has to be world up.
    const facing = new Vector3(0, 0, 1)
      .applyQuaternion(new Quaternion().setFromRotationMatrix(target.matrixWorld))
      .normalize();
    expect(facing.x).toBeCloseTo(0, 5);
    expect(facing.y).toBeCloseTo(1, 5);
    expect(facing.z).toBeCloseTo(0, 5);

    surface.setLevel(-4.25);
    expect(surface.level).toBe(-4.25);
    expect(new Vector3().setFromMatrixPosition(target.matrixWorld).y).toBeCloseTo(-4.25, 6);
    expect(() => surface.setLevel(Number.POSITIVE_INFINITY)).toThrow(/level/u);
  });

  it("refuses to move once released, and releases only once", () => {
    const surface = new WaterSurface3D({ level: 0, maxThickness: 3, reflection });
    surface.dispose();
    expect(surface.released).toBe(true);
    surface.dispose();
    expect(() => surface.setLevel(2)).toThrow(/released/u);
  });

  it("has no reflection to hand out when none was asked for", () => {
    const surface = new WaterSurface3D({ level: 0, maxThickness: 3 });
    expect(surface.target).toBeUndefined();
    expect(() => surface.reflectionAt()).toThrow(/without reflection/u);
    // The two readings that need no second pass still work.
    expect(isNode(surface.refractionAt())).toBe(true);
    expect(isNode(surface.thicknessAt())).toBe(true);
  });

  it("returns nodes for every reading, offset or not", () => {
    const surface = new WaterSurface3D({ level: 0, maxThickness: 3, reflection });
    const offset = vec2(0.01, -0.02);
    for (const node of [
      surface.reflectionAt(),
      surface.reflectionAt(offset),
      surface.refractionAt(),
      surface.refractionAt(offset),
      surface.thicknessAt(),
      surface.thicknessAt(offset),
    ])
      expect(isNode(node)).toBe(true);
  });
});
