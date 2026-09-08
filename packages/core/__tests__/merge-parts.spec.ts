import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ExtrudeGeometry,
  Matrix4,
  Mesh,
  Shape,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { describe, expect, it, vi } from "vitest";
import { mergeParts } from "../src/merge-parts.js";

/** The mismatch that actually happens: a lofted profile is non-indexed, a primitive is indexed. */
function extruded(): ExtrudeGeometry {
  const profile = new Shape();
  profile.moveTo(0, 0);
  profile.lineTo(1, 0);
  profile.lineTo(1, 1);
  profile.lineTo(0, 0);
  return new ExtrudeGeometry(profile, { bevelEnabled: false, depth: 0.5 });
}

describe("mergeParts", () => {
  function morphedBox(): BoxGeometry {
    const geometry = new BoxGeometry(1, 1, 1);
    const positions = geometry.getAttribute("position");
    const morph = new Float32Array(positions.count * 3);
    for (let vertex = 0; vertex < positions.count; vertex += 1) morph[vertex * 3 + 1] = 0.25;
    geometry.morphAttributes.position = [new BufferAttribute(morph, 3)];
    geometry.morphTargetsRelative = true;
    return geometry;
  }

  it("should merge a non-indexed extrusion with an indexed box (PRD-277 AC4)", () => {
    const extrusion = extruded();
    const box = new BoxGeometry(1, 1, 1);

    // The control: this is what a game gets today without the helper.
    const raw = mergeGeometries([extrusion, box], false);
    expect(raw).toBeNull();

    const merged = mergeParts([{ geometry: extrusion }, { geometry: box }], { label: "hull" });
    expect(merged.index).toBeNull();
    expect(merged.getAttribute("position").count).toBe(
      extrusion.getAttribute("position").count + box.toNonIndexed().getAttribute("position").count,
    );
    expect(merged.getAttribute("normal")).toBeDefined();
  });

  it("should place each part by its own matrix, and take a Mesh as a part", () => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1));
    mesh.position.set(0, 10, 0);
    const matrixBefore = mesh.matrix.clone();
    const merged = mergeParts([mesh], { label: "crate" });
    merged.computeBoundingBox();
    expect(merged.boundingBox?.min.y).toBeCloseTo(9.5, 5);
    expect(merged.boundingBox?.max.y).toBeCloseTo(10.5, 5);
    expect(mesh.matrix.elements).toEqual(matrixBefore.elements);
    // The game's own geometry is never mutated.
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox?.max.y).toBeCloseTo(0.5, 5);
  });

  it("should place explicit geometry inputs by their matrix without mutating it", () => {
    const matrix = new Matrix4().makeTranslation(0, -3, 0);
    const matrixBefore = matrix.clone();
    const merged = mergeParts([{ geometry: new BoxGeometry(1, 1, 1), matrix }], {
      label: "explicit-crate",
    });
    merged.computeBoundingBox();
    expect(merged.boundingBox?.min.y).toBeCloseTo(-3.5, 5);
    expect(merged.boundingBox?.max.y).toBeCloseTo(-2.5, 5);
    expect(matrix.elements).toEqual(matrixBefore.elements);
  });

  it("should keep every part's own colour in the merged geometry (PRD-277 AC2)", () => {
    const tones = [0x8b2f1a, 0x2f8b1a, 0x1a2f8b] as const;
    const parts = tones.map((color) => ({ color, geometry: new BoxGeometry(1, 1, 1) }));
    const merged = mergeParts(parts, { label: "banner" });

    const colors = merged.getAttribute("color");
    const perPart = new BoxGeometry(1, 1, 1).toNonIndexed().getAttribute("position").count;
    expect(colors.itemSize).toBe(3);
    expect(colors.count).toBe(perPart * tones.length);
    tones.forEach((tone, index) => {
      const expected = new Color(tone);
      for (let vertex = 0; vertex < perPart; vertex += 1) {
        const at = index * perPart + vertex;
        expect(colors.getX(at)).toBeCloseTo(expected.r, 6);
        expect(colors.getY(at)).toBeCloseTo(expected.g, 6);
        expect(colors.getZ(at)).toBeCloseTo(expected.b, 6);
      }
    });
  });

  it("should refuse a merge it cannot normalise, naming the label (PRD-277 AC3)", () => {
    const parts = [{ geometry: new BoxGeometry(1, 1, 1) }, { geometry: new BufferGeometry() }];

    // The control: three.js reports to the console and hands back a null that propagates.
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      mergeGeometries(
        parts.map((part) => part.geometry.toNonIndexed()),
        false,
      ),
    ).toBeNull();
    errors.mockRestore();

    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => mergeParts(parts, { label: "gatehouse" })).toThrow(/gatehouse/u);
    quiet.mockRestore();
  });

  it("should fail closed on an empty part list and on a partly coloured one", () => {
    expect(() => mergeParts([], { label: "nothing" })).toThrow(/nothing/u);
    expect(() =>
      mergeParts(
        [{ color: 0xffffff, geometry: new BoxGeometry(1, 1, 1) }, { geometry: new BoxGeometry() }],
        { label: "half-painted" },
      ),
    ).toThrow(/half-painted/u);
  });

  it("should strip morph targets from flattened parts in either input order", () => {
    const morphed = morphedBox();
    const plain = new BoxGeometry(1, 1, 1);

    for (const parts of [
      [{ geometry: morphed }, { geometry: plain }],
      [{ geometry: plain }, { geometry: morphed }],
    ]) {
      const merged = mergeParts(parts, { label: "morph-trim" });
      expect(Object.keys(merged.morphAttributes)).toEqual([]);
      expect(merged.morphTargetsRelative).toBe(false);
      expect(merged.getAttribute("position").count).toBe(
        morphed.toNonIndexed().getAttribute("position").count +
          plain.toNonIndexed().getAttribute("position").count,
      );
    }

    expect(Object.keys(morphed.morphAttributes)).toEqual(["position"]);
    expect(morphed.morphTargetsRelative).toBe(true);
  });

  it("should drop attributes that cannot survive a merge and keep only position and colour", () => {
    const geometry = new BoxGeometry(1, 1, 1);
    geometry.setAttribute(
      "uv2",
      new BufferAttribute(new Float32Array(geometry.getAttribute("position").count * 2), 2),
    );
    const merged = mergeParts([{ geometry }, { geometry: new BoxGeometry(1, 1, 1) }], {
      label: "trim",
    });
    expect(Object.keys(merged.attributes).sort()).toEqual(["normal", "position"]);
  });
});
