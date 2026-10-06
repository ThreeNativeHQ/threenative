// Base-surface DQS follows pinned donor core/render/dqs.js (MIT), including its affine
// pre-pass and normal rotation. This is editable game source; no LBS substitution.
import type { IAnimalPose } from "@threenative/procedural-animals";
import {
  Fn,
  attribute,
  cross,
  dot,
  float,
  int,
  ivec2,
  length,
  max,
  select,
  textureLoad,
  transformNormalToView,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import { MeshStandardNodeMaterial } from "three/webgpu";
import type { Node } from "three/webgpu";

export function animalMaterial(pose: IAnimalPose): MeshStandardNodeMaterial {
  const texel = (bone: Node<"float">, slot: number) =>
    textureLoad(pose.texture, ivec2(int(bone).mul(5).add(slot), 0));
  const skin = (direction: boolean) =>
    Fn(() => {
      const indices = attribute("skinIndex", "vec4");
      const weights = attribute("skinWeight", "vec4");
      const position = attribute("position", "vec3");
      const reference = texel(indices.x, 0);
      const real = vec4(0).toVar();
      const dual = vec4(0).toVar();
      const scaled = vec3(0).toVar();
      const hp = vec4(position, 1);
      for (const component of ["x", "y", "z", "w"] as const) {
        const bone = indices[component];
        const weight = weights[component];
        scaled.addAssign(
          vec3(dot(texel(bone, 2), hp), dot(texel(bone, 3), hp), dot(texel(bone, 4), hp)).mul(
            weight,
          ),
        );
        const rotation = texel(bone, 0);
        const signed = select(dot(rotation, reference).lessThan(0), weight.negate(), weight);
        real.addAssign(rotation.mul(signed));
        dual.addAssign(texel(bone, 1).mul(signed));
      }
      scaled.divAssign(max(weights.x.add(weights.y).add(weights.z).add(weights.w), 1e-5));
      const magnitude = max(length(real), 1e-6);
      real.divAssign(magnitude);
      dual.divAssign(magnitude);
      const value = direction ? attribute("normal", "vec3") : scaled;
      const rotated = value.add(
        cross(real.xyz, cross(real.xyz, value).add(value.mul(real.w))).mul(2),
      );
      if (direction) return rotated;
      const translation = dual.xyz
        .mul(real.w)
        .sub(real.xyz.mul(dual.w))
        .add(cross(real.xyz, dual.xyz))
        .mul(2);
      return rotated.add(translation);
    })();
  const material = new MeshStandardNodeMaterial();
  const tint = attribute("aTint", "vec4");
  const pattern = attribute("aPat", "vec4");
  material.colorNode = tint.rgb.mix(pattern.rgb, pattern.a.mul(float(0.25)));
  material.roughness = 0.82;
  material.metalness = 0;
  material.positionNode = skin(false);
  material.castShadowPositionNode = material.positionNode;
  material.normalNode = transformNormalToView(varying(skin(true), "animalDQNormal")).normalize();
  return material;
}
