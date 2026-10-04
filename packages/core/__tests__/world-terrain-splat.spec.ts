import { CompressedArrayTexture, CompressedTexture, DataArrayTexture, Texture } from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTerrainSplat, stackLayers } from "../src/world-terrain-splat.js";

const table = {
  base: { id: "moss", normal: true, tile: 3, tint: [0.36, 0.47, 0.27] },
  breakup: { push: 0.25, scale: 0.35 },
  layers: [
    { channel: "r", hi: 1.35, id: "litter", lo: 0.3, mask: "litter", tile: 3, tint: [1, 1, 1] },
    {
      channel: "b",
      hi: 0.75,
      id: "grass",
      lo: 0.25,
      mask: "b",
      normal: true,
      tile: 3.5,
      tint: [1, 1, 1],
    },
    {
      channel: "r",
      hi: 0.85,
      id: "rock",
      lo: 0.45,
      mask: "a",
      tile: 7,
      tint: [1, 1, 1],
      triplanar: true,
    },
  ],
  macro: { max: 1.12, min: 0.8, scale: 0.05 },
  splat: { masks: { a: [0, "rgb"], b: [1, "rgb"], litter: [0, "a"] }, planes: 2, size: 4 },
  textures: "terrain/tex",
};

function world(layers: Record<string, string> | undefined): unknown {
  return {
    extent: { minX: -8, minZ: -8, sizeX: 16, sizeZ: 16 },
    terrain: { heightmap: "terrain/heightmap.u16", ...(layers === undefined ? {} : { layers }) },
  };
}

function served(files: Record<string, unknown>): { assets: never; requested: string[] } {
  const requested: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = files[url];
      if (body === undefined) return new Response(null, { status: 404 });
      return body instanceof Uint8Array
        ? new Response(new Blob([body as BlobPart]))
        : new Response(JSON.stringify(body));
    }),
  );
  const assets = {
    resolve: async (path: string) => [path],
    texture: async (path: string) => {
      requested.push(path);
      return bitmap(4, 4);
    },
  };
  return { assets: assets as never, requested };
}

/** An uncompressed layer of a given size, as the asset loader hands one back (an ImageBitmap). */
function bitmap(width: number, height: number): Texture {
  const texture = new Texture();
  texture.image = { width, height } as never;
  return texture;
}

/** A renderer that records the GPU copies it is asked for, one per array layer. */
function copyingRenderer(): { raw: unknown; layers: number[] } {
  const layers: number[] = [];
  return {
    layers,
    raw: {
      copyTextureToTexture: (
        _source: unknown,
        _destination: unknown,
        _r: unknown,
        at: { z: number },
      ) => layers.push(at.z),
      initTexture: () => undefined,
    },
  };
}

/** Every distinct texture the material's node graphs sample: one binding each. */
function sampledTextures(material: MeshStandardNodeMaterial): Set<Texture> {
  const found = new Set<Texture>();
  const walk = (
    node: { value?: unknown; getChildren?: () => unknown[] } | null | undefined,
  ): void => {
    if (node === null || node === undefined) return;
    if (node.value instanceof Texture) found.add(node.value);
    for (const child of node.getChildren?.() ?? []) walk(child as typeof node);
  };
  walk(material.colorNode as never);
  walk(material.normalNode as never);
  return found;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("loadTerrainSplat", () => {
  it("builds the package's splat surface from its own table, planes and texture sets", async () => {
    const { assets, requested } = served({
      "world/world.json": world({ splat: "terrain/splat.rgba8", table: "terrain/layers.json" }),
      "world/terrain/layers.json": table,
      "world/terrain/splat.rgba8": new Uint8Array(2 * 4 * 4 * 4),
    });
    const surface = await loadTerrainSplat({ assets, url: "world/world.json" });
    expect(surface).toBeInstanceOf(MeshStandardNodeMaterial);
    expect((surface as MeshStandardNodeMaterial).colorNode).toBeTruthy();
    expect((surface as MeshStandardNodeMaterial).normalNode).toBeTruthy();
    // Every set's albedo, and a normal only where the table asks for one.
    expect(requested.sort()).toEqual(
      [
        "world/terrain/tex/grass_diff.jpg",
        "world/terrain/tex/grass_nrm.jpg",
        "world/terrain/tex/litter_diff.jpg",
        "world/terrain/tex/moss_diff.jpg",
        "world/terrain/tex/moss_nrm.jpg",
        "world/terrain/tex/rock_diff.jpg",
      ].sort(),
    );
  });

  it("refuses a package without terrain layers instead of drawing a default", async () => {
    const { assets } = served({ "world/world.json": world(undefined) });
    await expect(loadTerrainSplat({ assets, url: "world/world.json" })).rejects.toThrow(
      /terrain\.layers/u,
    );
  });

  it("refuses splat data shorter than the planes the table names", async () => {
    const { assets } = served({
      "world/world.json": world({ splat: "terrain/splat.rgba8", table: "terrain/layers.json" }),
      "world/terrain/layers.json": table,
      "world/terrain/splat.rgba8": new Uint8Array(4 * 4 * 4),
    });
    await expect(loadTerrainSplat({ assets, url: "world/world.json" })).rejects.toThrow(/plane 1/u);
  });

  it("stacks sixteen same-size uncompressed layers into one array texture per set", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { assets } = served({
      "world/world.json": world({ splat: "terrain/splat.rgba8", table: "terrain/layers.json" }),
      "world/terrain/layers.json": {
        ...table,
        layers: Array.from({ length: 15 }, (_unused, index) => ({
          channel: "r",
          hi: 1,
          id: `layer-${String(index)}`,
          lo: 0,
          mask: "a",
          normal: true,
          tile: 3,
          tint: [1, 1, 1],
        })),
        splat: { masks: { a: [0, "a"] }, planes: 1, size: 4 },
      },
      "world/terrain/splat.rgba8": new Uint8Array(4 * 4 * 4),
    });
    const surface = (await loadTerrainSplat({
      assets,
      renderer: copyingRenderer() as never,
      url: "world/world.json",
    })) as MeshStandardNodeMaterial;
    // The splat planes plus one array per set: three sampled textures for sixteen layers.
    expect(sampledTextures(surface).size).toBe(3);
    expect(info).toHaveBeenCalledWith("TN_TERRAIN_SPLAT layers=16 samplers=3 stacked=2");
  });

  it("names the sampler count a set that cannot stack costs", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sizes = new Map<string, [number, number]>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "world/world.json")
          return new Response(
            JSON.stringify(world({ splat: "terrain/splat.rgba8", table: "terrain/layers.json" })),
          );
        if (url === "world/terrain/splat.rgba8")
          return new Response(new Blob([new Uint8Array(2 * 4 * 4 * 4)]));
        return new Response(JSON.stringify(table));
      }),
    );
    // One layer at a size the others cannot match, so the albedo set keeps its own samplers.
    sizes.set("world/terrain/tex/rock_diff.jpg", [8, 8]);
    const assets = {
      resolve: async (path: string) => [path],
      texture: async (path: string) => {
        const size = sizes.get(path) ?? [4, 4];
        return bitmap(size[0], size[1]);
      },
    };
    const surface = (await loadTerrainSplat({
      assets: assets as never,
      renderer: copyingRenderer() as never,
      url: "world/world.json",
    })) as MeshStandardNodeMaterial;
    // splat + 4 albedos (one layer's size the rest do not share) + 1 stacked normal set.
    expect(sampledTextures(surface).size).toBe(6);
    expect(info).toHaveBeenCalledWith("TN_TERRAIN_SPLAT layers=4 samplers=6 stacked=1");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("bind 4 samplers"));
  });
});

describe("stackLayers", () => {
  const layer = (fill: number, format = 1023): CompressedTexture => {
    const texture = new CompressedTexture(
      [
        { data: new Uint8Array(16).fill(fill), height: 4, width: 4 },
        { data: new Uint8Array(8).fill(fill), height: 2, width: 2 },
      ] as never,
      4,
      4,
      format as never,
    );
    return texture;
  };

  it("stacks same-format layers into one array texture, every mip concatenated in layer order", () => {
    const stacked = stackLayers([layer(1), layer(2), layer(3)]) as CompressedArrayTexture;
    expect(stacked).toBeInstanceOf(CompressedArrayTexture);
    expect((stacked.image as { depth: number }).depth).toBe(3);
    const mip0 = stacked.mipmaps[0]?.data as Uint8Array;
    expect(mip0.byteLength).toBe(48);
    expect([mip0[0], mip0[16], mip0[32]]).toEqual([1, 2, 3]);
    expect((stacked.mipmaps[1]?.data as Uint8Array).byteLength).toBe(24);
  });

  it("refuses to stack a mixed codec", () => {
    expect(stackLayers([layer(1), layer(2, 1024)])).toBeUndefined();
  });

  it("stacks same-size uncompressed layers through one GPU copy per layer", () => {
    const renderer = copyingRenderer();
    const stacked = stackLayers(
      [bitmap(4, 4), bitmap(4, 4), bitmap(4, 4)],
      renderer as never,
    ) as DataArrayTexture;
    expect(stacked).toBeInstanceOf(DataArrayTexture);
    expect((stacked.image as { depth: number }).depth).toBe(3);
    expect(renderer.layers).toEqual([0, 1, 2]);
  });

  it("refuses uncompressed layers of mixed sizes, and any set with no renderer to copy with", () => {
    expect(stackLayers([bitmap(4, 4), bitmap(8, 8)], copyingRenderer() as never)).toBeUndefined();
    expect(stackLayers([bitmap(4, 4), bitmap(4, 4)])).toBeUndefined();
  });
});
