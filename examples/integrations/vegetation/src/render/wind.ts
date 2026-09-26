import type { BufferGeometry, Object3D } from "three";
import {
  Fn,
  attribute,
  float,
  modelWorldMatrixInverse,
  normalGeometry,
  normalLocal,
  positionGeometry,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import type { MeshStandardNodeMaterial } from "three/webgpu";
import { type IWind, validateWind } from "../geometry.js";

/**
 * Editable appearance, intentionally not an engine preset. This lane is for ordinary meshes.
 * `amplitude` and `height` are world metres and `direction` is world space, so the sway reads the
 * same at any scale: the displacement is built in world space and pushed through the inverse world
 * matrix unnormalized, which is what keeps it world metres once the asset cook has put a
 * dequantization scale on a node. The envelope is the baked `_wind` weight, a share of tree height
 * measured before that cook, so bark and leaves of one tree move as one.
 * The normal adjustment assumes a yaw plus a uniform node scale, which is what a placement and the
 * cook produce; a non-uniform scale tilts it by the same factor the mesh itself is tilted.
 */
export function createTreeWind(base: MeshStandardNodeMaterial, options: IWind) {
  const wind = validateWind(options);
  if (base.positionNode || base.normalNode || base.displacementMap)
    throw new Error(
      "Tree wind needs an unmodified vertex path; compose custom appearance in this source file.",
    );
  const material = base.clone();
  const simulationTime = uniform(0);
  let disposed = false;
  const worldDirection = vec3(wind.direction[0], 0, wind.direction[1]);
  material.positionNode = Fn(
    (
      _: unknown,
      builder: { readonly object: Object3D | null; readonly geometry: BufferGeometry | null },
    ) => {
      const object = builder.object;
      if (
        !object ||
        "isInstancedMesh" in object ||
        "isSkinnedMesh" in object ||
        (builder.geometry && "isInstancedBufferGeometry" in builder.geometry)
      )
        throw new Error(
          "Tree wind currently supports ordinary meshes only; use static generated variants for instanced forests.",
        );
      if (!builder.geometry?.getAttribute("_wind"))
        throw new Error(
          "Tree wind needs a per-vertex _wind attribute: generateTree bakes it into every mesh, and the exporter carries it as the _WIND glTF semantic.",
        );
      const t = attribute<"float">("_wind", "float");
      const oscillation = simulationTime
        .mul(wind.frequency)
        .add(wind.phase)
        .sin()
        .mul(wind.amplitude);
      const envelope = t.mul(t).mul(float(3).sub(t.mul(2)));
      // Unnormalized: the inverse world matrix's own scale is the conversion the cook needs.
      const localOffset = modelWorldMatrixInverse.mul(
        vec4(worldDirection.mul(oscillation.mul(envelope)), 0),
      ).xyz;
      const heading = modelWorldMatrixInverse.mul(vec4(worldDirection, 0)).xyz.normalize();
      const k = oscillation
        .mul(t)
        .mul(float(1).sub(t))
        .mul(6 / wind.height);
      normalLocal.assign(
        normalGeometry.sub(vec3(0, k.mul(heading.dot(normalGeometry)), 0)).normalize(),
      );
      return positionGeometry.add(localOffset);
    },
  )();
  return {
    material,
    updateTime(seconds: number): void {
      if (disposed) throw new Error("Tree wind is disposed.");
      if (!Number.isFinite(seconds))
        throw new Error("Tree wind time must be finite simulation time.");
      simulationTime.value = seconds;
    },
    /**
     * Re-pad the geometry's own box and sphere for the sway, in place: the engine's LOD levels
     * share these objects, so they are recomputed rather than replaced. `minWorldScale` is the
     * smallest world scale the mesh is drawn at, since world metres are local metres divided by
     * that scale.
     */
    expandBounds(geometry: BufferGeometry, minWorldScale = 1): void {
      if (disposed) throw new Error("Tree wind is disposed.");
      if (!Number.isFinite(minWorldScale) || minWorldScale <= 0)
        throw new Error("Tree wind bounds need a finite positive smallest world scale.");
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const pad = wind.amplitude / minWorldScale;
      // Any yaw maps the world direction onto a local horizontal axis, so pad both.
      if (geometry.boundingBox) {
        geometry.boundingBox.min.x -= pad;
        geometry.boundingBox.max.x += pad;
        geometry.boundingBox.min.z -= pad;
        geometry.boundingBox.max.z += pad;
      }
      if (geometry.boundingSphere) geometry.boundingSphere.radius += pad;
    },
    dispose(): void {
      if (!disposed) {
        disposed = true;
        material.dispose();
      }
    },
  };
}
