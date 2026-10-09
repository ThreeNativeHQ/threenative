import { describe, expect, it } from "vitest";
import { Material, defineObjectSurface } from "../src/object-surface.js";

class BufferGeometry {
  readonly stored = new Map<string, unknown>();
  setAttribute(name: string, attribute: unknown) {
    this.stored.set(name, attribute);
    return this;
  }
  deleteAttribute(name: string) {
    this.stored.delete(name);
    return this;
  }
  hasAttribute(name: string) {
    return this.stored.has(name);
  }
  getAttribute(name: string) {
    return this.stored.get(name);
  }
}

describe("defineObjectSurface", () => {
  it("enumerates geometry.attributes, so Object.entries works on an engine geometry", () => {
    class MeshStandardMaterial {}
    defineObjectSurface({
      bufferGeometry: BufferGeometry,
      geometries: [],
      materials: [MeshStandardMaterial],
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", "p");
    geometry.setAttribute("custom", "c");
    const { attributes } = geometry as unknown as { attributes: Record<string, unknown> };
    expect(Object.entries(attributes)).toEqual([
      ["position", "p"],
      ["custom", "c"],
    ]);
    expect(new MeshStandardMaterial()).toBeInstanceOf(Material);
    expect(
      (MeshStandardMaterial.prototype as { isMeshStandardMaterial?: boolean })
        .isMeshStandardMaterial,
    ).toBe(true);
  });

  it("keeps a material flag the back end already defined read-only", () => {
    class MeshBasicMaterial {}
    Object.defineProperty(MeshBasicMaterial.prototype, "isMeshBasicMaterial", {
      configurable: true,
      value: true,
    });
    expect(() =>
      defineObjectSurface({
        bufferGeometry: BufferGeometry,
        geometries: [],
        materials: [MeshBasicMaterial],
      }),
    ).not.toThrow();
    expect(new MeshBasicMaterial()).toBeInstanceOf(Material);
  });
});
