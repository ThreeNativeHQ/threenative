import { Matrix4, type Quaternion, type Vector3 } from "three";

import type { IMetaHumanBindings } from "./asset-contract.js";

/**
 * The source basis a specimen's rig values are written in, and the one conversion that takes
 * them into glTF space.
 *
 * glTF is right-handed, y up, metres. A prepared sidecar declares its own basis in three
 * fields — `coordinates.sourceUnits`, `coordinates.sourceUp` and `coordinates.handedness` — and
 * everything else follows from those, never from a guess about this one specimen:
 *
 * | declared | axis map `(x, y, z)` |
 * | --- | --- |
 * | `sourceUp: "y"`, `handedness: "right"` | identity |
 * | `sourceUp: "y"`, `handedness: "left"` | `(x, y, -z)` |
 * | `sourceUp: "z"`, `handedness: "right"` | `(x, z, y)` |
 * | `sourceUp: "z"`, `handedness: "left"` | `(x, z, -y)` |
 *
 * A `sourceUnits: "cm"` rig is in centimetres and scales by 0.01; `"m"` is already metres.
 *
 * A rotation is not a vector: it is conjugated by the same axis map,
 * `M · R(q) · Mᵀ`, so no quaternion component is ever added, dropped or re-signed by hand. That
 * map is a similarity, which is what makes the composition in `metahuman.ts` exact: converting
 * `neutral ∘ delta` gives the same rotation as converting each factor and multiplying those.
 *
 * `__tests__/neutral-match.spec.ts` checks the table against a real specimen's exported rest
 * pose, to 0.1 mm and 0.1°, so a wrong row here fails a test rather than a face.
 */
export interface IMetaHumanBasis {
  /** Linear unit: the factor that takes a source translation to metres. */
  readonly scale: number;
  /** One source translation, in glTF axes and metres. */
  vector(source: Vector3, target: Vector3): Vector3;
  /** One source rotation, in the target basis. */
  quaternion(source: Quaternion, target: Quaternion): Quaternion;
  /**
   * One source scale triple.
   *
   * Scale is a diagonal matrix, and conjugating that by the axis map swaps the two axes the
   * map moves: `(x, y, z) -> (x, z, y)` for a z-up source, with no sign, because a scale is a
   * magnitude and negating one would mirror the geometry.
   */
  scaleTriple(source: Vector3, target: Vector3): Vector3;
}

const AXIS_MAPS = {
  "y/right": [1, 0, 0, 0, 1, 0, 0, 0, 1],
  "y/left": [1, 0, 0, 0, 1, 0, 0, 0, -1],
  "z/right": [1, 0, 0, 0, 0, 1, 0, 1, 0],
  "z/left": [1, 0, 0, 0, 0, 1, 0, -1, 0],
} as const satisfies Record<string, readonly number[]>;

function axisMap(coordinates: IMetaHumanBindings["coordinates"]): Matrix4 {
  const key = `${coordinates.sourceUp}/${coordinates.handedness}`;
  const map = AXIS_MAPS[key as keyof typeof AXIS_MAPS];
  if (map === undefined)
    throw new Error(`TN_MH_COORDINATES: no axis map for ${key}, which the schema forbids`);
  // A 3x3 basis in a Matrix4: the translation column stays zero, so this maps directions only.
  return new Matrix4().set(
    map[0],
    map[1],
    map[2],
    0,
    map[3],
    map[4],
    map[5],
    0,
    map[6],
    map[7],
    map[8],
    0,
    0,
    0,
    0,
    1,
  );
}

/**
 * The conversion a prepared specimen's bindings declare, with every reusable object built once.
 *
 * `metahuman.ts` applies it once per joint per frame, so nothing here allocates.
 */
export function metaHumanBasis(coordinates: IMetaHumanBindings["coordinates"]): IMetaHumanBasis {
  const axis = axisMap(coordinates);
  const inverse = axis.clone().transpose();
  const scale = coordinates.sourceUnits === "cm" ? 0.01 : 1;
  const rotation = new Matrix4();
  const conjugated = new Matrix4();

  return {
    scale,
    vector(source, target) {
      return target.copy(source).applyMatrix4(axis).multiplyScalar(scale);
    },
    quaternion(source, target) {
      rotation.makeRotationFromQuaternion(source);
      conjugated.multiplyMatrices(axis, rotation).multiply(inverse);
      return target.setFromRotationMatrix(conjugated);
    },
    scaleTriple(source, target) {
      return coordinates.sourceUp === "z"
        ? target.set(source.x, source.z, source.y)
        : target.copy(source);
    },
  };
}
