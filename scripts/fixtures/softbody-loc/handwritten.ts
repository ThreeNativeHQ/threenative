// This relative import stands for the exact production source copied into the game arm. Its source
// is counted once by countSoftBodyFeatureLoc; importing it avoids maintaining a dishonest clone.
import { SoftBody3D as HandwrittenCloth } from "../../../packages/core/src/softbody.js";

type ClothMesh = ConstructorParameters<typeof HandwrittenCloth>[0];

type ClothRole = "flag" | "cape" | "curtain";

interface IClothMeshes {
  readonly flag: ClothMesh;
  readonly cape: ClothMesh;
  readonly curtain: ClothMesh;
}

interface IPinnedVertices {
  readonly flag: readonly number[];
  readonly cape: readonly number[];
  readonly curtain: readonly number[];
}

const response = {
  flag: { damping: 1.8, stiffness: 35, wind: [1.5, 0, 0.4] },
  cape: { damping: 2.4, stiffness: 48, wind: [0.4, 0, 0.8] },
  curtain: { damping: 3.1, stiffness: 60, wind: [0.2, 0, 0.3] },
} as const satisfies Record<ClothRole, object>;

export function createClothSet(
  meshes: IClothMeshes,
  pinned: IPinnedVertices,
): Record<ClothRole, HandwrittenCloth> {
  return {
    flag: new HandwrittenCloth(meshes.flag, {
      ...response.flag,
      gravity: [0, -9.81, 0],
      pinned: pinned.flag,
    }),
    cape: new HandwrittenCloth(meshes.cape, {
      ...response.cape,
      gravity: [0, -9.81, 0],
      pinned: pinned.cape,
    }),
    curtain: new HandwrittenCloth(meshes.curtain, {
      ...response.curtain,
      gravity: [0, -9.81, 0],
      pinned: pinned.curtain,
    }),
  };
}
