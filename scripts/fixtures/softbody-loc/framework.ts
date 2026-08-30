import { SoftBody3D } from "@threenative/core";

type ClothMesh = ConstructorParameters<typeof SoftBody3D>[0];

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
): Record<ClothRole, SoftBody3D> {
  return {
    flag: new SoftBody3D(meshes.flag, {
      ...response.flag,
      gravity: [0, -9.81, 0],
      pinned: pinned.flag,
    }),
    cape: new SoftBody3D(meshes.cape, {
      ...response.cape,
      gravity: [0, -9.81, 0],
      pinned: pinned.cape,
    }),
    curtain: new SoftBody3D(meshes.curtain, {
      ...response.curtain,
      gravity: [0, -9.81, 0],
      pinned: pinned.curtain,
    }),
  };
}
