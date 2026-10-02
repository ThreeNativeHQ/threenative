/** Game-owned Fab art. Optional, local-only; missing species keep their procedural fallback. */
import type { IAssetLoader } from "@threenative/core";
import {
  Box3,
  type BufferGeometry,
  DoubleSide,
  type Group,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  Vector3,
} from "three";
import {
  dFdx,
  dFdy,
  float,
  instanceIndex,
  length,
  log2,
  max,
  positionGeometry,
  positionLocal,
  sin,
  texture,
  time,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { MeshStandardNodeMaterial } from "three/webgpu";
import type { IPropPart, PropRole } from "./props.js";

interface IPackSpecies {
  readonly asset: string;
  readonly variant: number;
  readonly path: string;
  readonly metres: number;
  readonly level?: number;
}
const species: IPackSpecies[] = [];
for (let i = 0; i < 5; i++) {
  species.push({
    asset: "spruce",
    variant: i,
    path: `spruce/${i}`,
    metres: [12, 14, 13, 17, 15][i] ?? 12,
  });
  // Reduced full-tree geometry preserves the adult silhouette and its trunk at distance.
  species.push({
    asset: "spruce",
    variant: i,
    path: `spruce/${i}-far`,
    metres: [12, 14, 13, 17, 15][i] ?? 12,
    level: 1,
  });
}
for (const [asset, heights] of Object.entries({
  sapling: [1.1, 2.1, 3.0],
  grass: [0.42, 0.65, 0.8, 0.45],
  scrub: [0.085, 0.065, 0.018],
  poppy: [0.35, 0.48, 0.5, 0.3],
  fern: [0.7, 0.6],
  boulder: [2.1, 5.2, 2.5],
  riverrock: [0.8],
  scree: [5.8],
  cliff: [18],
})) {
  heights.forEach((metres, variant) =>
    species.push({ asset, variant, metres, path: `${asset}/${variant}` }),
  );
}
const STONE = new Set(["boulder", "riverrock", "scree", "cliff"]);
const phase = float(instanceIndex).mul(12.9898).sin().mul(43758.545).fract().mul(6.2831);
const gust = sin(time.mul(0.1).add(phase));

function surface(source: MeshStandardMaterial, asset: string): MeshStandardNodeMaterial {
  const stone = STONE.has(asset);
  const cutout = !stone && source.alphaTest > 0;
  const material = new MeshStandardNodeMaterial({
    map: source.map,
    normalMap: stone ? source.normalMap : null,
    roughness: stone ? 0.88 : 0.92,
    metalness: 0,
  });
  if (source.map) {
    source.map.anisotropy = 8;
    const sampled = texture(source.map, uv());
    // These atlases were authored for Unreal exposure. A small lift and leaf transmission retain
    // shaded needle detail under this game's AgX curve without washing bark or flowers white.
    material.colorNode = sampled.rgb.mul(
      vec3(...(cutout && asset !== "poppy" ? ([1.55, 1.65, 1.25] as const) : ([1, 1, 1] as const))),
    );
    if (cutout) {
      material.side = DoubleSide;
      material.shadowSide = DoubleSide;
      material.alphaToCoverage = true;
      const image = source.map.image as { width?: number; height?: number };
      const size = vec2(image?.width ?? 2048, image?.height ?? 2048);
      const mip = max(
        log2(max(length(dFdx(uv()).mul(size)), length(dFdy(uv()).mul(size))).max(1)),
        float(0),
      );
      material.alphaTestNode = float(0.42).div(float(1).add(mip.mul(0.25)));
      material.opacityNode = sampled.a;
      if (asset !== "poppy") material.emissiveNode = sampled.rgb.mul(0.28);
    }
  }
  if (!stone) {
    const bend = gust
      .mul(positionGeometry.y.max(0).pow(1.5))
      .mul(asset === "spruce" ? 0.008 : 0.025);
    const offset = vec3(
      positionLocal.x.add(bend),
      positionLocal.y,
      positionLocal.z.add(bend.mul(0.55)),
    );
    material.positionNode = offset;
    material.castShadowPositionNode = offset;
  }
  return material;
}

export interface IPackProps {
  readonly parts: Map<string, IPropPart[]>;
  readonly dispose: () => void;
}
export async function loadPack(assets?: IAssetLoader): Promise<IPackProps> {
  const parts = new Map<string, IPropPart[]>();
  const built: { geometry: BufferGeometry; material: Material }[] = [];
  const loaded = await Promise.all(
    species.map(async (one) => {
      if (!assets) return undefined;
      try {
        return await assets.model<{ scene?: Group }>(`temperate/${one.path}.glb`);
      } catch {
        return undefined;
      }
    }),
  );
  loaded.forEach((gltf, index) => {
    const one = species[index];
    const root = gltf?.scene;
    if (!root || !one) return;
    root.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(root);
    const size = box.getSize(new Vector3());
    const stone = STONE.has(one.asset);
    const current = stone ? Math.max(size.x, size.y, size.z) : size.y;
    if (!(current > 1e-6)) return;
    const factor = one.metres / current;
    const entry = parts.get(`${one.asset}:${one.variant}`) ?? [];
    root.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const source = mesh.material as MeshStandardMaterial;
      if (!source.map) return;
      // One whole-model scale/base for all sections: scaling each part separately detached crowns.
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      geometry.translate(0, -box.min.y, 0);
      geometry.scale(factor, factor, factor);
      const material = surface(source, one.asset);
      const role: PropRole = stone ? "stone" : source.alphaTest > 0 ? "pine" : "bark";
      built.push({ geometry, material });
      entry.push({ geometry, material, role, level: one.level ?? 0, variant: one.variant });
    });
    if (entry.some((part) => (part.level ?? 0) === 0))
      parts.set(`${one.asset}:${one.variant}`, entry);
  });
  return {
    parts,
    dispose: () => {
      for (const one of built) {
        one.geometry.dispose();
        one.material.dispose();
      }
      parts.clear();
    },
  };
}
