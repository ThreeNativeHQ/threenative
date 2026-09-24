import { Document } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { censusDocument, materialStateOf, totalCensus } from "../src/content/census.js";

/**
 * Builds a document shaped like the content this exists for: one mesh per part, one material per
 * part, one private texture per material — and UVs that either stay inside the unit square or
 * leave it, which is the thing that decides whether an atlas is available at all.
 */
function pack(options: { parts: number; tiling: boolean; size?: number }): Document {
  const document = new Document();
  const buffer = document.createBuffer();
  const scene = document.createScene();
  const size = options.size ?? 256;
  const pixels = new Uint8Array(size * size * 4);
  for (let part = 0; part < options.parts; part += 1) {
    const image = document
      .createTexture(`tex-${String(part)}`)
      .setImage(Uint8Array.from([...pixels.subarray(0, 8), part]))
      .setMimeType("image/png")
      .setURI(`tex-${String(part)}.png`);
    // The census reads the declared size; a fake needs it to be readable the same way.
    Object.defineProperty(image, "getSize", { value: () => [size, size] });
    const material = document
      .createMaterial(`part-${String(part)}`)
      .setBaseColorTexture(image)
      .setRoughnessFactor(0.5)
      .setMetallicFactor(1);
    const span = options.tiling ? 4 : 1;
    const uv = document
      .createAccessor(`uv-${String(part)}`)
      .setType("VEC2")
      .setArray(new Float32Array([0, 0, span, 0, span, span]))
      .setBuffer(buffer);
    const position = document
      .createAccessor(`pos-${String(part)}`)
      .setType("VEC3")
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]))
      .setBuffer(buffer);
    const primitive = document
      .createPrimitive()
      .setAttribute("POSITION", position)
      .setAttribute("TEXCOORD_0", uv)
      .setMaterial(material);
    const mesh = document.createMesh(`mesh-${String(part)}`).addPrimitive(primitive);
    scene.addChild(document.createNode(`node-${String(part)}`).setMesh(mesh));
  }
  return document;
}

describe("censusDocument", () => {
  it("collapses a one-texture-per-material pack once the textures share a page", () => {
    const census = censusDocument("pack.glb", pack({ parts: 12, tiling: false }));
    expect(census.materials).toBe(12);
    expect(census.textureSources).toBe(12);
    // As authored, every material owns a private texture, so nothing can be merged — the shape
    // that produced 213 singletons on the reference game.
    expect(census.before.buckets).toBe(12);
    expect(census.before.singletons).toBe(12);
    // Atlased, the materials become the same material.
    expect(census.after.buckets).toBe(1);
    expect(census.after.singletons).toBe(0);
    expect(census.excluded).toBe(0);
  });

  it("refuses to atlas a pack whose geometry samples outside the unit square, and says so", () => {
    const census = censusDocument("tiling.glb", pack({ parts: 12, tiling: true }));
    expect(census.excluded).toBe(12);
    expect(census.atlasPages).toBe(0);
    // The atlas is simply not available here, and the census must not pretend otherwise.
    expect(census.after.buckets).toBe(census.before.buckets);
    expect(census.after.singletons).toBe(census.before.singletons);
  });

  it("reads a material into the state the signature is taken over", () => {
    const document = pack({ parts: 1, tiling: false });
    const material = document.getRoot().listMaterials()[0];
    expect(material).toBeDefined();
    const state = materialStateOf(material as NonNullable<typeof material>);
    expect(state.textures.baseColor).toBe("tex-0.png");
    expect(state.uniforms.roughness).toBe(0.5);
    expect(state.flags.alphaMode).toBe("OPAQUE");
  });

  it("totals a set of models without inventing a model of its own", () => {
    const first = censusDocument("a.glb", pack({ parts: 3, tiling: false }));
    const second = censusDocument("b.glb", pack({ parts: 5, tiling: true }));
    const total = totalCensus([first, second]);
    expect(total.materials).toBe(8);
    expect(total.before.singletons).toBe(first.before.singletons + second.before.singletons);
    expect(total.excluded).toBe(5);
  });
});
