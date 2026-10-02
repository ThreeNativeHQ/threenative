/** Game-owned Fab art. Optional, local-only; missing species keep their procedural fallback. */
import type { IAssetLoader } from "@threenative/core";
import {
  Box3,
  BufferAttribute,
  type BufferGeometry,
  DoubleSide,
  type Group,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  Vector3,
} from "three";
import {
  attribute,
  cameraViewMatrix,
  dFdx,
  dFdy,
  float,
  instanceIndex,
  length,
  log2,
  max,
  mix,
  mx_noise_float,
  normalWorldGeometry,
  positionGeometry,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  texture,
  time,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { MeshPhysicalNodeMaterial } from "three/webgpu";
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
    metres: [12, 14, 13, 10, 11][i] ?? 12,
  });
  // Reduced full-tree geometry preserves the adult silhouette and its trunk at distance.
  species.push({
    asset: "spruce",
    variant: i,
    path: `spruce/${i}-far`,
    metres: [12, 14, 13, 10, 11][i] ?? 12,
    level: 1,
  });
}
for (const [asset, heights] of Object.entries({
  sapling: [1.1, 2.1, 3.0],
  grass: [0.28, 0.4, 0.5, 0.32],
  scrub: [0.085, 0.065, 0.018],
  poppy: [0.38, 0.5, 0.42, 0.4],
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

function surface(source: MeshStandardMaterial, asset: string): MeshPhysicalNodeMaterial {
  const stone = STONE.has(asset);
  const cutout = !stone && source.alphaTest > 0;
  const canopy = asset === "spruce" || asset === "sapling";
  const material = new MeshPhysicalNodeMaterial({
    map: source.map,
    normalMap: canopy ? null : source.normalMap,
    roughness: stone ? 0.96 : 1,
    specularIntensity: canopy ? 0 : cutout ? 0.02 : 0.3,
    metalness: 0,
  });
  if (source.map) {
    source.map.anisotropy = 8;
    const sampled = texture(source.map, uv());
    // Cooked albedo is already sRGB (KTX2 DFD transfer=2); never apply a second decode or lift.
    const tint =
      cutout && canopy
        ? ([0.34, 0.95, 0.18] as const)
        : cutout && asset !== "poppy"
          ? ([0.55, 0.82, 0.42] as const)
          : asset === "poppy"
            ? ([1, 1, 0.85] as const)
            : canopy && source.name === "branch"
              ? ([0.45, 0.38, 0.25] as const)
              : ([1, 1, 1] as const);
    material.colorNode = sampled.rgb.mul(vec3(...tint));
    if (stone) {
      const base = attribute<"float">("groundBlend", "float");
      const growth = smoothstep(-0.15, 0.3, mx_noise_float(positionWorld.mul(2.1)));
      const moss = base
        .mul(0.9)
        .add(normalWorldGeometry.y.max(0).mul(growth).mul(0.38))
        .clamp(0, 0.95);
      material.colorNode = mix(material.colorNode, vec3(0.045, 0.078, 0.019), moss);
      material.aoNode = mix(1, 0.65, base);
    }
    if (cutout) {
      // Shadow overrides and VirtualShadowNode classify cutouts by this scalar, not the node.
      material.alphaTest = source.alphaTest;
      material.side = DoubleSide;
      material.shadowSide = DoubleSide;
      // Keep Three's DoubleSide back-face normal flip; overriding it lights undersides as sky faces.
      if (canopy) {
        const inner = attribute<"float">("inner", "float");
        material.colorNode = material.colorNode.mul(mix(0.42, 1, inner));
        material.aoNode = mix(0.12, 0.58, inner);
      } else if (asset === "poppy") {
        // Keep the photographed red petals; lift only the nearly black stems/seed pods.
        const dark = smoothstep(0.045, 0.008, sampled.r.max(sampled.g).max(sampled.b));
        material.colorNode = mix(material.colorNode, vec3(0.028, 0.055, 0.009), dark.mul(0.75));
        material.emissiveNode = material.colorNode.mul(0.045);
      } else if (asset !== "poppy" && source.normalMap) {
        // Ground foliage keeps photographed relief around its bent, upward leaf normal.
        const relief = texture(source.normalMap, uv()).xy.mul(2).sub(1).mul(0.45);
        material.normalNode = vec3(relief.x, 1, relief.y)
          .normalize()
          .transformDirection(cameraViewMatrix);
      }
      const image = source.map.image as { width?: number; height?: number };
      const size = vec2(image?.width ?? 2048, image?.height ?? 2048);
      const mip = max(
        log2(max(length(dFdx(uv()).mul(size)), length(dFdy(uv()).mul(size))).max(1)),
        float(0),
      );
      material.alphaTestNode = float(0.42).div(float(1).add(mip.mul(0.25)));
      material.opacityNode = sampled.a;
      if (asset !== "poppy") material.emissiveNode = material.colorNode.mul(canopy ? 0.035 : 0.025);
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
      if (one.asset === "spruce") geometry.scale(1.12, 1, 1.12);
      // spruce_full_03_low ships zero normals. Repair the optional art, including existing cooks.
      const normals = geometry.getAttribute("normal");
      if (!normals || Math.hypot(normals.getX(0), normals.getY(0), normals.getZ(0)) < 0.01)
        geometry.computeVertexNormals();
      const positions = geometry.getAttribute("position");
      if (source.alphaTest > 0 && (one.asset === "spruce" || one.asset === "sapling")) {
        // Radial coverage per height band: tips see sky, needles near the trunk do not.
        const radii = new Float32Array(16);
        const band = (i: number) =>
          Math.min(15, Math.max(0, Math.floor((positions.getY(i) / one.metres) * 16)));
        for (let i = 0; i < positions.count; i++)
          radii[band(i)] = Math.max(
            radii[band(i)] ?? 0,
            Math.hypot(positions.getX(i), positions.getZ(i)),
          );
        const inner = Float32Array.from({ length: positions.count }, (_, i) =>
          Math.min(
            1,
            Math.hypot(positions.getX(i), positions.getZ(i)) / Math.max(0.1, radii[band(i)] ?? 0),
          ),
        );
        geometry.setAttribute("inner", new BufferAttribute(inner, 1));
      }
      if (stone) {
        const blend = Float32Array.from({ length: positions.count }, (_, i) =>
          Math.max(
            0,
            Math.min(1, (0.48 - positions.getY(i) / Math.max(0.01, size.y * factor)) / 0.28),
          ),
        );
        geometry.setAttribute("groundBlend", new BufferAttribute(blend, 1));
      }
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
