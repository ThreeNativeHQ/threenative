import { describe, expect, it } from "vitest";
import { type IAtlasSource, atlasManifest, packAtlas } from "../src/atlas/packer.js";
import { resolveSourceTexel, rewriteUvs, uvsTile, wrapTiles } from "../src/atlas/rewrite-uvs.js";
import {
  type IMaterialState,
  dedupeMaterials,
  materialSignature,
  withAtlasTextures,
} from "../src/content/dedupe-materials.js";

function sources(count: number, size = 512): IAtlasSource[] {
  return Array.from({ length: count }, (_value, index) => ({
    height: size,
    key: `texture-${String(index).padStart(3, "0")}`,
    width: size,
  }));
}

describe("packAtlas", () => {
  it("is deterministic: two runs over the same inputs place every source at the same pixel", () => {
    const input = sources(73);
    const shuffled = [...input].reverse();
    // The caller's order comes from a directory listing, so a packer that inherited it would be
    // stable and still not reproducible.
    expect(atlasManifest(packAtlas(input))).toBe(atlasManifest(packAtlas(shuffled)));
  });

  it("packs the reference game's 73 carrier sources and reports where each one went", () => {
    const result = packAtlas(sources(73), { pageSize: 4_096, padding: 4 });
    expect(result.transforms.size).toBe(73);
    expect(result.excluded).toHaveLength(0);
    // 512+8 per source, 7 per row, 7 rows per page: one page holds 49, so 73 needs two.
    expect(result.pages).toHaveLength(2);
    const placed = result.pages.flatMap((page) => page.placements);
    expect(placed).toHaveLength(73);
  });

  it("never overlaps two sources on a page, padding included", () => {
    const result = packAtlas(
      Array.from({ length: 40 }, (_value, index) => ({
        height: 64 + (index % 5) * 100,
        key: `t${String(index)}`,
        width: 64 + (index % 7) * 90,
      })),
      { pageSize: 1_024, padding: 4 },
    );
    for (const page of result.pages) {
      for (let left = 0; left < page.placements.length; left += 1) {
        for (let right = left + 1; right < page.placements.length; right += 1) {
          const a = page.placements[left];
          const b = page.placements[right];
          if (a === undefined || b === undefined) continue;
          const disjoint =
            a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y;
          expect(disjoint).toBe(true);
        }
      }
      for (const placement of page.placements) {
        expect(placement.x + placement.width).toBeLessThanOrEqual(page.width);
        expect(placement.y + placement.height).toBeLessThanOrEqual(page.height);
      }
    }
  });

  it("excludes a tiling source and reports it, rather than clamping it onto a shared page", () => {
    const result = packAtlas([
      { height: 256, key: "ocean", tiles: true, width: 256 },
      { height: 256, key: "hull", width: 256 },
    ]);
    expect(result.transforms.has("ocean")).toBe(false);
    expect(result.transforms.has("hull")).toBe(true);
    expect(result.excluded).toEqual([{ key: "ocean", reason: "tiles" }]);
  });

  it("excludes a source larger than a page instead of scaling it silently", () => {
    const result = packAtlas([{ height: 8_192, key: "sky", width: 8_192 }], { pageSize: 4_096 });
    expect(result.excluded).toEqual([{ key: "sky", reason: "too-large" }]);
  });

  it("refuses a malformed source rather than dividing by its zero", () => {
    expect(() => packAtlas([{ height: 0, key: "broken", width: 64 }])).toThrow(/at least one/u);
  });
});

describe("rewriteUvs", () => {
  it("resolves a sampled texel back to the same source texel within one texel", () => {
    const result = packAtlas(sources(9, 256), { pageSize: 1_024, padding: 4 });
    const transform = result.transforms.get("texture-004");
    expect(transform).toBeDefined();
    const uv = new Float32Array([0, 0, 0.5, 0.5, 1, 1, 0.25, 0.75]);
    const original = Float32Array.from(uv);
    rewriteUvs(uv, transform as NonNullable<typeof transform>);

    for (let index = 0; index < uv.length; index += 2) {
      const resolved = resolveSourceTexel(
        [uv[index] ?? 0, uv[index + 1] ?? 0],
        transform as NonNullable<typeof transform>,
        { height: 256, width: 256 },
      );
      expect(resolved.x).toBeCloseTo((original[index] ?? 0) * 256, 3);
      expect(resolved.y).toBeCloseTo((original[index + 1] ?? 0) * 256, 3);
    }
  });

  it("keeps every rewritten coordinate inside its own page rectangle", () => {
    const result = packAtlas(sources(4, 256), { pageSize: 1_024, padding: 4 });
    const transform = result.transforms.get("texture-002");
    const uv = new Float32Array([0, 0, 1, 1]);
    rewriteUvs(uv, transform as NonNullable<typeof transform>);
    for (let index = 0; index < uv.length; index += 1) {
      expect(uv[index]).toBeGreaterThanOrEqual(0);
      expect(uv[index]).toBeLessThanOrEqual(1);
    }
  });

  it("refuses a buffer that does not hold pairs", () => {
    expect(() =>
      rewriteUvs(new Float32Array([0, 0, 1]), {
        offsetX: 0,
        offsetY: 0,
        page: 0,
        scaleX: 1,
        scaleY: 1,
      }),
    ).toThrow(/pairs/u);
  });

  it("calls a surface tiling from its own UVs and from its sampler, not from its pixels", () => {
    expect(uvsTile(new Float32Array([0, 0, 1, 1]))).toBe(false);
    expect(uvsTile(new Float32Array([0, 0, 2, 1]))).toBe(true);
    expect(uvsTile(new Float32Array([0, -0.5, 1, 1]))).toBe(true);
    // Exporter slack at the boundary is not tiling.
    expect(uvsTile(new Float32Array([-1e-6, 1 + 1e-6]))).toBe(false);
    expect(wrapTiles(33_071, 33_071)).toBe(false);
    expect(wrapTiles(10_497, 33_071)).toBe(true);
    expect(wrapTiles(undefined, undefined)).toBe(false);
  });
});

describe("dedupeMaterials", () => {
  const base: IMaterialState = {
    flags: { doubleSided: false },
    name: "hull-part-01",
    textures: { baseColor: "hull-01.png" },
    uniforms: { metallic: 1, roughness: 0.5 },
  };

  it("does not collapse two materials that differ only in a non-atlas uniform", () => {
    const materials: IMaterialState[] = [
      base,
      { ...base, name: "hull-part-02", uniforms: { metallic: 1, roughness: 0.6 } },
    ];
    const { census } = dedupeMaterials(withAtlasTextures(materials, () => "page-0"));
    expect(census.buckets).toBe(2);
    expect(census.singletons).toBe(2);
  });

  it("collapses materials that differ only in the private texture the atlas replaced", () => {
    const materials: IMaterialState[] = [
      base,
      { ...base, name: "hull-part-02", textures: { baseColor: "hull-02.png" } },
      { ...base, name: "hull-part-03", textures: { baseColor: "hull-03.png" } },
    ];
    // Before: one texture each, so nothing collapses. This is the 213-singleton shape.
    expect(dedupeMaterials(materials).census).toEqual({ buckets: 3, materials: 3, singletons: 3 });
    // After: the three share a page, and the materials are now the same material.
    const atlased = withAtlasTextures(materials, () => "atlas-page-0");
    expect(dedupeMaterials(atlased).census).toEqual({ buckets: 1, materials: 3, singletons: 0 });
  });

  it("leaves a material whose source the atlas excluded pointing at its own texture", () => {
    const materials: IMaterialState[] = [
      base,
      { ...base, name: "ocean", textures: { baseColor: "ocean-tiling.png" } },
    ];
    const atlased = withAtlasTextures(materials, (texture) =>
      texture === "ocean-tiling.png" ? undefined : "atlas-page-0",
    );
    const { census } = dedupeMaterials(atlased);
    expect(census.buckets).toBe(2);
    expect(census.singletons).toBe(2);
  });

  it("ignores the material name, which is what made every imported part a singleton", () => {
    expect(materialSignature(base)).toBe(materialSignature({ ...base, name: "something-else" }));
  });

  it("keeps materials apart on a flag the signature does not understand", () => {
    const exotic: IMaterialState = { ...base, flags: { doubleSided: false, someFutureFlag: "on" } };
    expect(materialSignature(exotic)).not.toBe(materialSignature(base));
  });
});
