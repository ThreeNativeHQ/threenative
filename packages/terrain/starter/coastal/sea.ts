// The coastal kit's sea: a flat sheet of water at the level the bake wrote, drawn with the same water
// material as the lakes. The sky shows in it at grazing angles, the body colour shows where it is deep, and
// it fades to nothing where the ground rises through the level, so the shoreline is where the ground meets
// the water. Change the colours here to change the sea; nothing in a package decides them.
import type { ICtx } from "@threenative/core";
import { WaterSurface3D } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { Color, DoubleSide, type Material, Mesh, PlaneGeometry } from "three";
import {
  cameraPosition,
  clamp,
  dot,
  float,
  mix,
  normalize,
  positionWorld,
  pow,
  smoothstep,
  vec3,
} from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

/** The layer the sky sits on, so the sea's mirror can show it (see `sky.ts`). */
export const SKY_REFLECTION_LAYER = 3;
/** The mirrored sky at grazing angles, in linear light: the sea's blue. */
const SHEEN = new Color(0x9fb8c2);
/** Deep water's own colour. */
const BODY = new Color(0x123a44);
/** Metres of water over the ground below which the sea fades to nothing at the shore. */
const SHORE_DEPTH = 0.3;

/**
 * The sea's surface: the sky mirrored at grazing angles, the body colour where it is deep, and the shore
 * thinned to nothing. Schlick at water's 1.333 index, as the lakes use.
 */
function seaMaterial(surface: WaterSurface3D): MeshBasicNodeMaterial {
  const view = normalize(cameraPosition.sub(positionWorld));
  const facing = clamp(dot(vec3(0, 1, 0), view), float(0), float(1));
  const fresnel = float(0.02).add(pow(float(1).sub(facing), 5).mul(0.98));
  const thickness = surface.thicknessAt();
  const body = vec3(BODY.r, BODY.g, BODY.b);
  const submerged = mix(surface.refractionAt(), body, smoothstep(float(0.4), float(3), thickness));
  const material = new MeshBasicNodeMaterial({ transparent: true, side: DoubleSide });
  // The HDR mirror is compressed, then tinted: its horizon is neutral, the sea should not be.
  const mirror = surface.reflectionAt();
  const compressed = mirror.div(mirror.add(vec3(1, 1, 1)));
  material.colorNode = mix(submerged, compressed.mul(vec3(SHEEN.r, SHEEN.g, SHEEN.b)), fresnel);
  material.opacityNode = smoothstep(float(0), float(SHORE_DEPTH), thickness);
  return material;
}

/** The sea in the scene. `dispose` removes the mesh and releases its water surface. */
export interface ICoastalSea {
  readonly mesh: Mesh;
  dispose(): void;
}

/**
 * Adds the sea at `level` metres over the world's extent. The caller owns the returned handle.
 */
export function addCoastalSea(
  ctx: ICtx<Record<string, unknown>, IPhysicsContext>,
  level: number,
  extent: {
    readonly minX: number;
    readonly minZ: number;
    readonly sizeX: number;
    readonly sizeZ: number;
  },
): ICoastalSea {
  const surface = new WaterSurface3D({
    level,
    maxThickness: 4,
    reflection: { resolutionScale: 0.5, layers: 1 << SKY_REFLECTION_LAYER, refreshInterval: 4 },
  });
  const geometry = new PlaneGeometry(extent.sizeX, extent.sizeZ, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, seaMaterial(surface));
  mesh.position.set(extent.minX + extent.sizeX / 2, level, extent.minZ + extent.sizeZ / 2);
  ctx.add(mesh);
  return {
    mesh,
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      (mesh.material as Material).dispose();
      surface.dispose();
    },
  };
}
