/** Game-owned Fab art. Optional, local-only; missing species keep their procedural fallback. */
import { type IAssetLoader, baseGeometryOf } from "@threenative/core";
import {
  Box3,
  BufferAttribute,
  type BufferGeometry,
  DoubleSide,
  type Group,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  RepeatWrapping,
  type Texture,
  Vector3,
} from "three";
import {
  attribute,
  cameraViewMatrix,
  dFdx,
  dFdy,
  dot,
  float,
  instanceIndex,
  length,
  log2,
  max,
  mix,
  mx_noise_float,
  normalMap,
  normalViewGeometry,
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
import { MeshPhysicalNodeMaterial, type Node } from "three/webgpu";
import { GROUND_MAPS, ROCKFACE_MAPS, WORLD_ROCKS } from "../world/terrainAssets.js";
import {
  BIOMES,
  type WorldName,
  alpineRockAlbedo,
  alpineRockColor,
  alpineSnowCover,
  biomeWeights,
  desertRockColor,
} from "./biomes.js";
import { lightNeedles } from "./propMaterials.js";
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
for (const one of WORLD_ROCKS) STONE.add(one.asset);
const phase = float(instanceIndex).mul(12.9898).sin().mul(43758.545).fract().mul(6.2831);
const gust = sin(time.mul(0.1).add(phase));

function surface(
  source: MeshStandardMaterial,
  asset: string,
  world: WorldName,
  snowMap?: Texture,
): MeshPhysicalNodeMaterial {
  const stone = STONE.has(asset);
  const cutout = !stone && source.alphaTest > 0;
  const canopy = asset === "spruce" || asset === "sapling";
  const kite = source.name.startsWith("ScotsPine");
  const fieldGrass = asset === "grass" && source.name === "open-world-demo";
  const otherBiome = world !== "forest" && world !== "coastal";
  const material = new MeshPhysicalNodeMaterial({
    map: source.map,
    normalMap: canopy ? null : source.normalMap,
    roughness: stone ? 0.96 : 1,
    specularIntensity: canopy || (world === "tundra" && cutout) ? 0 : cutout ? 0.02 : 0.3,
    metalness: 0,
  });
  if (!otherBiome && canopy && !cutout) material.normalMap = source.normalMap;
  if (source.map) {
    source.map.anisotropy = 8;
    const sampled = texture(source.map, uv());
    // Cooked albedo is already sRGB (KTX2 DFD transfer=2); never apply a second decode or lift.
    const tint =
      cutout && canopy
        ? otherBiome
          ? ([0.3, 0.42, 0.32] as const)
          : ([0.6, 0.78, 0.34] as const)
        : cutout && asset !== "poppy"
          ? otherBiome
            ? ([0.55, 0.82, 0.42] as const)
            : ([0.6, 0.78, 0.45] as const)
          : asset === "poppy"
            ? ([1, 1, 0.85] as const)
            : canopy && source.name === "branch"
              ? ([0.45, 0.38, 0.25] as const)
              : ([1, 1, 1] as const);

    material.colorNode = sampled.rgb.mul(vec3(...tint));
    if (world === "forest" && canopy && cutout) {
      const grain = dot(sampled.rgb, vec3(0.2126, 0.7152, 0.0722));
      const wood = smoothstep(0.04, 0.16, sampled.r.sub(sampled.g));
      material.colorNode = mix(
        grain.mul(vec3(0.28, 0.72, 0.54)),
        sampled.rgb.mul(vec3(0.24, 0.22, 0.14)),
        wood,
      );
    }
    if (!otherBiome && canopy && !cutout && !kite)
      material.colorNode = sampled.rgb.mul(vec3(0.42, 0.27, 0.15));
    if (!otherBiome && (asset === "grass" || asset === "scrub")) {
      const tip = smoothstep(0.008, asset === "grass" ? 0.34 : 0.065, positionGeometry.y);
      const dry = smoothstep(0.65, 0.92, sin(phase).mul(0.5).add(0.5));
      const dune = world === "coastal" ? smoothstep(7.5, 2.2, positionWorld.y) : float(0);
      const green = mix(vec3(0.32, 0.48, 0.18), vec3(0.84, 0.92, 0.46), tip);
      const straw = mix(vec3(0.4, 0.29, 0.12), vec3(1.18, 0.94, 0.48), tip);
      const grain = dot(sampled.rgb, vec3(0.2126, 0.7152, 0.0722));
      material.colorNode = mix(sampled.rgb.mul(green), straw.mul(grain), dry.max(dune));
      if (fieldGrass)
        material.colorNode = mix(vec3(0.025, 0.052, 0.008), vec3(0.2, 0.31, 0.065), tip).mul(
          grain.mul(24).clamp(0.4, 1.4),
        );
      material.aoNode = mix(0.35, 0.95, tip);
    }
    if (otherBiome && stone)
      material.colorNode = sampled.rgb.mul(
        world === "desert"
          ? vec3(1.12, 0.8, 0.54)
          : world === "alpine"
            ? vec3(0.94, 0.98, 1.02)
            : vec3(0.7, 0.78, 0.61),
      );
    if (world === "desert" && stone) material.colorNode = desertRockColor(sampled.rgb);
    if (world === "alpine" && stone)
      material.colorNode = alpineRockColor(alpineRockAlbedo(source.map));
    if (otherBiome && cutout && !canopy)
      material.colorNode = sampled.rgb.mul(
        world === "desert"
          ? vec3(0.85, 0.64, 0.32)
          : world === "tundra"
            ? vec3(0.64, 0.67, 0.42)
            : vec3(0.72, 0.8, 0.55),
      );
    if (world === "desert" && asset === "grass")
      material.colorNode = vec3(1.28, 0.94, 0.52).mul(
        dot(sampled.rgb, vec3(0.2126, 0.7152, 0.0722)),
      );
    if (world === "tundra" && cutout && !canopy) {
      const root = smoothstep(0.015, 0.14, positionGeometry.y);
      material.colorNode = mix(vec3(0.025, 0.035, 0.013), material.colorNode, root);
      material.aoNode = mix(0.15, 0.8, root);
    }
    if (stone) {
      const base = attribute<"float">("groundBlend", "float");
      const growth = smoothstep(-0.15, 0.3, mx_noise_float(positionWorld.mul(2.1)));
      const moss = base
        .mul(world === "alpine" ? 0.12 : 0.9)
        .add(
          normalWorldGeometry.y
            .max(0)
            .mul(growth)
            .mul(world === "alpine" ? 0 : 0.38),
        )
        .clamp(0, 0.95);
      material.colorNode = mix(
        material.colorNode,
        world === "desert"
          ? vec3(0.23, 0.16, 0.095)
          : world === "alpine"
            ? vec3(0.12, 0.13, 0.12)
            : vec3(0.045, 0.078, 0.019),
        moss,
      );
      material.aoNode = mix(1, 0.65, base);
      if (world === "alpine" || world === "tundra") {
        // Alpine keeps the heightfield's upward-face mask across mesh seams; tundra uses its ground rule.
        const snow =
          world === "alpine"
            ? smoothstep(0.12, 0.82, alpineSnowCover())
            : (biomeWeights(BIOMES[world], float(1).sub(normalWorldGeometry.y), float(0), growth)
                .snow as Node<"float">);
        material.colorNode = mix(
          material.colorNode,
          world === "alpine"
            ? (snowMap
                ? texture(snowMap, positionWorld.xz.div(12)).rgb
                : vec3(0.82, 0.86, 0.9)
              ).mul(vec3(...BIOMES.alpine.snowTint))
            : vec3(0.84, 0.87, 0.91),
          snow,
        );
        material.roughnessNode = mix(0.96, 0.82, snow);
        if (source.normalMap)
          material.normalNode = normalMap(texture(source.normalMap), vec2(mix(1, 0.2, snow)));
      }
    }
    if (cutout) {
      // Shadow overrides and VirtualShadowNode classify cutouts by this scalar, not the node.
      material.alphaTest = source.alphaTest;
      material.side = DoubleSide;
      material.shadowSide = DoubleSide;
      // Keep Three's DoubleSide back-face normal flip; overriding it lights undersides as sky faces.
      if (canopy) {
        const inner = attribute<"float">("inner", "float");
        material.colorNode = material.colorNode.mul(
          mix(otherBiome ? 0.42 : 0.48, 1, otherBiome ? inner : inner.pow(2)),
        );
        if (world === "forest")
          material.colorNode = material.colorNode.mul(
            mix(0.3, 1, smoothstep(0.35, 0.9, sampled.a)),
          );
        material.aoNode = otherBiome
          ? mix(0.12, 0.58, inner)
          : world === "forest"
            ? mix(0.06, 0.85, inner.pow(2))
            : mix(0.26, 0.72, inner.pow(2));
        if (world === "forest") material.normalNode = normalViewGeometry;
      } else if (asset === "poppy") {
        // Keep the photographed red petals; lift only the nearly black stems/seed pods.
        const dark = smoothstep(0.045, 0.008, sampled.r.max(sampled.g).max(sampled.b));
        material.colorNode = mix(material.colorNode, vec3(0.028, 0.055, 0.009), dark.mul(0.75));
        material.emissiveNode = material.colorNode.mul(0.045);
      } else if (asset !== "poppy" && source.normalMap && world !== "tundra") {
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
      // Low tundra mats must reject blurred photographic background in alpha mips.
      material.alphaTestNode =
        world === "tundra" && !canopy
          ? float(0.5)
          : float(world === "forest" ? source.alphaTest : 0.42).div(float(1).add(mip.mul(0.25)));
      material.opacityNode = sampled.a;
      if (canopy) {
        lightNeedles(material, material.aoNode as Node<"float">);
        if (!otherBiome)
          material.emissiveNode = (material.emissiveNode as Node<"vec3">).mul(
            world === "forest" ? 0.05 : 0.18,
          );
        if (world === "alpine" && material.emissiveNode)
          material.emissiveNode = (material.emissiveNode as Node<"vec3">).mul(0.4);
      } else if (asset !== "poppy") material.emissiveNode = material.colorNode.mul(0.025);
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
export async function loadPack(
  assets?: IAssetLoader,
  world: WorldName = "forest",
): Promise<IPackProps> {
  const parts = new Map<string, IPropPart[]>();
  const built: { geometry: BufferGeometry; material: Material }[] = [];
  const selected = species.filter(
    (one) =>
      world === "forest" ||
      world === "coastal" ||
      (world === "alpine" &&
        ["spruce", "sapling", "grass", "scrub", "boulder", "scree", "riverrock"].includes(
          one.asset,
        )) ||
      (world === "tundra" &&
        ["scrub", "sapling", "boulder", "scree", "riverrock"].includes(one.asset)) ||
      (world === "desert" &&
        ["grass", "scrub", "boulder", "scree", "riverrock"].includes(one.asset)),
  );
  if (world === "forest" || world === "coastal")
    selected.push(
      ...WORLD_ROCKS.filter((one) => one.asset === "mountain").map((one) => ({
        ...one,
        path: one.path.replace(/^temperate\//, "").replace(/\.glb$/, ""),
      })),
    );
  if (world === "tundra")
    selected.push({ asset: "bush", variant: 0, path: "scrub/0", metres: 0.45 });
  if (world === "alpine" || world === "desert")
    selected.push(
      ...WORLD_ROCKS.filter((one) =>
        world === "alpine" ? one.asset === "mountain" : one.asset !== "mountain",
      ).map((one) => ({
        ...one,
        path: one.path.replace(/^temperate\//, "").replace(/\.glb$/, ""),
      })),
    );
  const rockface =
    world === "alpine" && assets
      ? await Promise.all(
          [ROCKFACE_MAPS.diffuse, ROCKFACE_MAPS.normal, GROUND_MAPS.snow.diffuse].map(
            (path, index) =>
              path
                ? assets
                    .texture(path, { data: index === 1, wrap: RepeatWrapping })
                    .catch(() => undefined)
                : undefined,
          ),
        )
      : [];
  const loaded = await Promise.all(
    selected.map(async (one) => {
      if (!assets) return undefined;
      try {
        if (world === "forest" && one.asset === "spruce" && !one.level) {
          const pine = await assets
            .model<{ scene?: Group }>("temperate/kite-spruce/0.glb")
            .catch(() => undefined);
          if (pine) return pine;
        }
        if (world === "forest" && one.asset === "sapling") {
          const spruce = await assets
            .model<{ scene?: Group }>("temperate/needle-spruce/0.glb")
            .catch(() => undefined);
          if (spruce) return spruce;
        }
        if (world === "forest" && one.asset === "grass") {
          const grass = await assets
            .model<{ scene?: Group }>("temperate/fieldgrass/0.glb")
            .catch(() => undefined);
          if (grass) return grass;
        }
        return await assets.model<{ scene?: Group }>(`temperate/${one.path}.glb`);
      } catch {
        return undefined;
      }
    }),
  );
  loaded.forEach((gltf, index) => {
    const one = selected[index];
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
      let source = mesh.material as MeshStandardMaterial;
      if (world === "alpine" && stone && rockface[0]) {
        source = source.clone();
        source.map = rockface[0];
        source.normalMap = rockface[1] ?? null;
      }
      if (!source.map) return;
      // One whole-model scale/base for all sections: scaling each part separately detached crowns.
      const geometry = baseGeometryOf(mesh).clone().applyMatrix4(mesh.matrixWorld);
      const centre = box.getCenter(new Vector3());
      const centredStone = stone && (world === "forest" || world === "coastal");
      geometry.translate(centredStone ? -centre.x : 0, -box.min.y, centredStone ? -centre.z : 0);
      geometry.scale(factor, factor, factor);
      if (world === "alpine" && one.asset === "mountain") {
        geometry.scale(0.65, 1.45, 1.8);
        const longest = Math.max(size.x * 0.65, size.y * 1.45, size.z * 1.8) * factor;
        geometry.scale(24 / longest, 24 / longest, 24 / longest);
      }
      if (world === "tundra" && one.asset === "grass") geometry.scale(1.35, 1, 1.35);
      if (world === "tundra" && one.asset === "bush") geometry.scale(0.18, 1, 0.18);
      if (world === "tundra" && one.asset === "scrub") geometry.scale(1.1, 2, 1.1);
      if (one.asset === "spruce") geometry.scale(1.12, 1, 1.12);
      if (world === "coastal" && one.asset === "grass") geometry.scale(0.55, 1.35, 0.55);
      if (world === "forest" && one.asset === "poppy") geometry.scale(1, 1.4, 1);
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
        if (world === "forest") {
          const crownNormals = new Float32Array(positions.count * 3);
          const direction = new Vector3();
          for (let i = 0; i < positions.count; i++) {
            direction
              .set(positions.getX(i), Math.max(0.1, radii[band(i)] ?? 0) * 0.45, positions.getZ(i))
              .normalize();
            direction.toArray(crownNormals, i * 3);
          }
          geometry.setAttribute("normal", new BufferAttribute(crownNormals, 3));
        }
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
      const material = surface(source, one.asset, world, rockface[2]);
      if (source !== mesh.material) source.dispose();
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
