// The portable surface a full-world export hands to another game.
//
// The live ground is a `MeshStandardNodeMaterial`: six tiled layers blended by the world's own
// slope, curvature and painted splat, with a normal map projected on three axes and a noise
// gradient folded into its relief. A GLB carries no node graph, so none of that can travel.
//
// What travels instead is the same starter maps, chosen here rather than in a package, bound to the
// canonical baked uv, and weighted per vertex by the terrain's own splat through `vertexColors`.
// So a receiving game gets this game's CC0 albedo, normal, roughness and occlusion, this game's
// metres-per-tile, and this game's own layer weights as colour — a static bake of the appearance
// rather than a substitute for it.
import type { IAssetLoader } from "@threenative/core";
import { DoubleSide, MeshStandardMaterial, RepeatWrapping, type Texture } from "three";

/**
 * Which CC0 starter maps the portable ground binds. This mapping is the game's, not the package's.
 *
 * Rooted at `/` rather than relative, because the export runs inside the editor at
 * `/terrain-editor/`, where a relative path would resolve under the route and 404. `src/render/
 * terrain.ts` and `propMaterials.ts` ask for the same set relatively because the runtime game is
 * served from the root; an export that loaded no art would be indistinguishable from one that did.
 */
const PORTABLE_MAPS = {
  ao: "/leafy_grass/leafy_grass_ao_1k.jpg",
  colour: "/leafy_grass/leafy_grass_diff_1k.jpg",
  normal: "/leafy_grass/leafy_grass_nor_gl_1k.jpg",
  roughness: "/leafy_grass/leafy_grass_rough_1k.jpg",
} as const;

/** Metres one tile of the grass set spans, matching `src/render/terrain.ts`'s own choice. */
const TILE_METRES = 2.6;

/**
 * Which starter maps each portable prop role binds.
 *
 * The same sets the live surfaces use (`src/render/propMaterials.ts`), on the same terms: an albedo
 * is colour and a normal/roughness map is a measurement. A cutout role carries its own alpha cutoff,
 * which is what a GLB can express; the live surfaces' mip-compensated discard and two-sided canopy
 * light are shader behaviour and stay in the game.
 */
const PORTABLE_PROP_MAPS: Record<string, { maps: string[]; cutout?: number }> = {
  bark: {
    maps: [
      "/bark_brown_02/bark_brown_02_diff_1k.jpg",
      "/bark_brown_02/bark_brown_02_nor_gl_1k.jpg",
      "/bark_brown_02/bark_brown_02_rough_1k.jpg",
    ],
  },
  stone: {
    maps: [
      "/mossy_rock/mossy_rock_diff_1k.jpg",
      "/mossy_rock/mossy_rock_nor_gl_1k.jpg",
      "/mossy_rock/mossy_rock_rough_1k.jpg",
    ],
  },
  crown: { maps: ["/needle-atlas.png"], cutout: 0.42 },
  fern: { maps: ["/fern_02/fern_02_diff_512.jpg"], cutout: 0.4 },
  needles: { maps: ["/fir_tree_01/fir_tree_01_twig_diff_1k.jpg"], cutout: 0.42 },
  petal: { maps: ["/needle-atlas.png"], cutout: 0.42 },
  pine: { maps: ["/needle-atlas.png"], cutout: 0.11 },
};

/** The albedo a role falls back to, so a map that will not load never costs the export its shape. */
const PORTABLE_PROP_FALLBACK: Record<string, number> = {
  bark: 0x4a3428,
  crown: 0x2c4a2a,
  fern: 0x2f4d22,
  grass: 0x7f9a4a,
  needles: 0x24401f,
  petal: 0xb8181a,
  pine: 0x24401f,
  stem: 0x6f8a3a,
  stone: 0x6e6f62,
};

async function map(
  assets: IAssetLoader,
  path: string,
  data: boolean,
  repeat: number,
): Promise<Texture | undefined> {
  // `data` is the colour-space contract the exporter checks: albedo is sRGB, and a normal,
  // roughness or occlusion map is a measurement, so it is sampled linear.
  const texture = await assets.texture(path, { data, wrap: RepeatWrapping }).catch(() => undefined);
  if (texture === undefined) return undefined;
  texture.repeat.set(repeat, repeat);
  return texture;
}

/**
 * The exported world's ground: this game's starter PBR maps over this game's baked layer weights.
 *
 * A map that will not load leaves that slot empty rather than failing the export; the receiving
 * game then draws the vertex colours on their own, which is the same fallback the live ground takes
 * on a host with no asset server.
 *
 * @param size the world's extent in metres, which with {@link TILE_METRES} sets the tiling count
 */
export async function createPortableGround(
  assets: IAssetLoader,
  size: number,
): Promise<MeshStandardMaterial> {
  const repeat = size / TILE_METRES;
  const [colour, normal, roughness, ao] = await Promise.all([
    map(assets, PORTABLE_MAPS.colour, false, repeat),
    map(assets, PORTABLE_MAPS.normal, true, repeat),
    map(assets, PORTABLE_MAPS.roughness, true, repeat),
    map(assets, PORTABLE_MAPS.ao, true, repeat),
  ]);
  const material = new MeshStandardMaterial({
    metalness: 0,
    roughness: 0.94,
    // The baked palette is in linear space already, so the receiving game multiplies it by the
    // albedo texture rather than converting twice.
    vertexColors: true,
  });
  if (colour) material.map = colour;
  if (normal) material.normalMap = normal;
  if (roughness) material.roughnessMap = roughness;
  if (ao) material.aoMap = ao;
  return material;
}

/** One portable prop surface per role, on the same terms as {@link createPortableGround}. */
export interface IPortableProps {
  readonly materials: Record<string, MeshStandardMaterial>;
  dispose(): void;
}

/**
 * The exported world's prop surfaces: this game's starter maps as plain `MeshStandardMaterial`.
 *
 * The live props draw through node materials — triplanar stone, wind in the vertex stage, a
 * mip-compensated alpha test and a two-sided canopy light — and none of that is expressible in a
 * GLB. What travels is the same textures with the same colour spaces and the cutout each role's
 * alpha implies, so an exported spruce is still this game's spruce rather than a green box.
 */
export async function createPortableProps(assets: IAssetLoader): Promise<IPortableProps> {
  const materials: Record<string, MeshStandardMaterial> = {};
  const textures: Texture[] = [];
  for (const role of Object.keys(PORTABLE_PROP_FALLBACK)) {
    const specification = PORTABLE_PROP_MAPS[role];
    const material = new MeshStandardMaterial({
      color: PORTABLE_PROP_FALLBACK[role],
      metalness: 0,
      roughness: 0.94,
      // Grass, stems and petals carry their own gradient in the geometry's colour attribute.
      vertexColors: role === "grass" || role === "stem",
    });
    if (specification?.cutout !== undefined) {
      material.alphaTest = specification.cutout;
      material.side = DoubleSide;
    }
    const [colour, normal, roughness] = await Promise.all(
      (specification?.maps ?? []).map(
        async (path, index) =>
          (await assets
            .texture(path, { data: index > 0, wrap: RepeatWrapping })
            .catch(() => undefined)) as Texture | undefined,
      ),
    );
    textures.push(...[colour, normal, roughness].filter((found): found is Texture => !!found));
    if (colour) material.map = colour;
    if (normal) material.normalMap = normal;
    if (roughness) material.roughnessMap = roughness;
    materials[role] = material;
  }
  return {
    materials,
    dispose: () => {
      for (const material of Object.values(materials)) material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}
