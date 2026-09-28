import { DataTexture, type Material, MeshLambertMaterial, MeshStandardMaterial } from "three";
import type { NodeMaterial } from "three/webgpu";
import { describe, expect, it } from "vitest";
import {
  MIP_ALPHA_SCALE,
  cutoutSurface,
  mipAdjustedCutoff,
  mipLevelFromFootprint,
  mipScaledAlpha,
} from "../src/render/foliage-alpha.js";

const CUTOFF = 0.5;
/**
 * A mip block inside a needle card, modelled as its own density: the block's opaque texels carry
 * alpha 1.0 and average with the transparent ones, so the sampled alpha is `density * 1.0`. The 9%
 * the tree textures are measured at is the whole image, whose margins are exactly the transparent
 * part of the sprite, and no fragment inside the canopy samples those.
 */
const NEEDLE_DENSITY = 0.45;

/** The deepest mip a block of this density is compensated for: the fix's reach, in mip levels. */
function reach(density: number): number {
  return (CUTOFF / density - 1) / MIP_ALPHA_SCALE;
}

/** A leaf card as a GLB's `BLEND` material arrives: transparent, with its needle map. */
function needles(map: DataTexture | undefined): MeshStandardMaterial {
  const material = new MeshStandardMaterial();
  material.transparent = true;
  if (map !== undefined) material.map = map;
  return material;
}

function needleMap(): DataTexture {
  return new DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
}

function isNode(material: object): material is Material & NodeMaterial {
  return Reflect.get(material, "isNodeMaterial") === true;
}

describe("foliage alpha", () => {
  it("keeps a needle above the cutoff through the mip chain, and an opaque texel untouched", () => {
    // The comparison the shader makes is the scaled alpha against the cutoff; `mipAdjustedCutoff`
    // is the same inequality with the scale divided out, so both forms are held to it.
    for (let mip = 1; mip <= 6; mip += 1) {
      expect(mipScaledAlpha(NEEDLE_DENSITY, mip)).toBeGreaterThan(CUTOFF);
      expect(NEEDLE_DENSITY).toBeGreaterThan(mipAdjustedCutoff(CUTOFF, mip));
    }
    // Mip 0 is the fragment as authored: the compensation is off, so an opaque texel is untouched.
    expect(mipScaledAlpha(1, 0)).toBe(1);
    expect(mipAdjustedCutoff(CUTOFF, 0)).toBe(CUTOFF);
    // A fragment closer than one texel per pixel is still mip 0, never a boosted one.
    expect(mipScaledAlpha(NEEDLE_DENSITY, -4)).toBe(NEEDLE_DENSITY);

    // The reach, which is the whole claim: 2.5x at mip 6 is as far as a 0.5 cutoff is compensated,
    // so a block denser than 0.4 is carried from mip 1, one denser than 0.2 from mip 6, and a
    // block at the whole image's 9% mean is carried to mip 18 — past the 11 a 2048px map has. A
    // needle card sampling a tenth needs a lower cutoff; the compensation is not that lever.
    expect(reach(0.4)).toBeCloseTo(1, 6);
    expect(reach(0.2)).toBeCloseTo(6, 6);
    expect(reach(0.09)).toBeCloseTo(18.22, 2);
    expect(mipScaledAlpha(0.09, 6)).toBeCloseTo(0.225, 6);
    expect(mipAdjustedCutoff(CUTOFF, 6)).toBeCloseTo(0.2, 6);
  });

  it("reads the mip level off the uv footprint, which is where a 2048px card lands at 100 m", () => {
    // A 4 m card covering 53 screen pixels out of 2048 texels: mip 5.3, deep into the chain that
    // averages a needle card away.
    expect(mipLevelFromFootprint(53 / 2048, 53 / 2048, 2048)).toBeCloseTo(Math.log2(53), 5);
    expect(mipLevelFromFootprint(1 / 2048, 1 / 2048, 2048)).toBeCloseTo(0, 6);
    // Zoomed in past one texel per pixel the footprint is under a texel, so the level is negative
    // and the compensation clamps it to mip 0 rather than shrinking alpha.
    expect(mipLevelFromFootprint(1e-4, 1e-4, 2048)).toBeLessThan(0);
  });

  it("draws a mapped cutout as a node whose cutoff the mip level decides", () => {
    const map = needleMap();
    const authored = needles(map);
    const cutout = cutoutSurface(authored, CUTOFF);

    expect(cutout).not.toBe(authored);
    expect(cutout.transparent).toBe(false);
    expect(cutout.depthWrite).toBe(true);
    expect(cutout.alphaTest).toBe(CUTOFF);
    // The map, the colours and the rest of the surface are the package's own, by reference.
    const surface = cutout as MeshStandardMaterial;
    expect(surface.map).toBe(map);
    expect(surface.color.equals(authored.color)).toBe(true);
    expect(isNode(surface)).toBe(true);
    // The documented marker of the mip-aware form: three compares the alpha against this node, and
    // `alphaTest` keeps the authored cutoff for every reader that only understands a number.
    const node = cutout as NodeMaterial;
    expect(node.alphaTestNode).not.toBeNull();
    // The package's own material is never mutated — every cell batch shares this one cutout.
    expect(authored.transparent).toBe(true);
    expect((authored as MeshStandardMaterial).alphaTestNode).toBeUndefined();
  });

  it("keeps a cutout with no mip chain plain, and a class with no node form with it", () => {
    const unmapped = needles(undefined);
    const plain = cutoutSurface(unmapped, CUTOFF) as MeshStandardMaterial;
    expect(plain.alphaTest).toBe(CUTOFF);
    expect(plain.transparent).toBe(false);
    // Nothing to compensate: no map, no mip chain, so nothing to read a mip level from.
    expect(plain.alphaTestNode).toBeNull();

    const lambert = new MeshLambertMaterial();
    lambert.transparent = true;
    lambert.map = needleMap();
    const fallback = cutoutSurface(lambert, 0.25);
    expect(fallback).toBeInstanceOf(MeshLambertMaterial);
    expect(fallback.alphaTest).toBe(0.25);
    expect(isNode(fallback)).toBe(false);
  });
});
