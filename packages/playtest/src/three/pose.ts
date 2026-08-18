import { Box3, Quaternion, type Object3D, Vector3 } from "three";

export type ThreePoseVector = readonly [number, number, number];
export type ThreePoseQuaternion = readonly [number, number, number, number];

export interface IThreePoseBounds {
  readonly min: ThreePoseVector;
  readonly max: ThreePoseVector;
  readonly size: ThreePoseVector;
}

/** JSON-safe world-space measurements for one Three.js object and its visual bounds. */
export interface IThreePoseMeasurement {
  readonly name: string;
  readonly type: string;
  readonly position: ThreePoseVector;
  readonly quaternion: ThreePoseQuaternion;
  readonly scale: ThreePoseVector;
  readonly axes: {
    readonly x: ThreePoseVector;
    readonly y: ThreePoseVector;
    readonly z: ThreePoseVector;
  };
  readonly bounds: IThreePoseBounds | null;
}

export interface IMeasureThreePoseOptions {
  /** Objects whose geometry forms the reported bounds. Defaults to `object`. */
  readonly bounds?: readonly Object3D[] | false;
}

function vector(value: Vector3): ThreePoseVector {
  return [value.x, value.y, value.z];
}

/**
 * Measure an Object3D in world space for attachment and animation diagnostics.
 *
 * Passing explicit `bounds` lets a probe measure a body without an attached weapon or
 * invisible hitbox. The result is JSON-safe so it can cross the browser playtest bridge.
 */
export function measureThreePose(
  object: Object3D,
  options: IMeasureThreePoseOptions = {},
): IThreePoseMeasurement {
  if (options.bounds !== undefined && options.bounds !== false && options.bounds.length === 0) {
    throw new Error("measureThreePose bounds must contain at least one Object3D.");
  }

  // A socket/bone probe needs its ancestors current, not every descendant bone. Avoiding that
  // subtree walk matters when a registered entity reports several joints each debug sample.
  object.updateWorldMatrix(true, options.bounds !== false);
  const worldPosition = object.getWorldPosition(new Vector3());
  const worldQuaternion = object.getWorldQuaternion(new Quaternion());
  const worldScale = object.getWorldScale(new Vector3());
  const x = new Vector3(1, 0, 0).applyQuaternion(worldQuaternion).normalize();
  const y = new Vector3(0, 1, 0).applyQuaternion(worldQuaternion).normalize();
  const z = new Vector3(0, 0, 1).applyQuaternion(worldQuaternion).normalize();

  let measuredBounds: IThreePoseBounds | null = null;
  if (options.bounds !== false) {
    const bounds = new Box3();
    for (const bounded of options.bounds ?? [object]) bounds.expandByObject(bounded, true);
    if (bounds.isEmpty()) {
      throw new Error(
        `measureThreePose could not measure bounds for '${object.name || object.type}'. ` +
          "Pass { bounds: false } for a geometry-free attachment point.",
      );
    }
    const size = bounds.getSize(new Vector3());
    measuredBounds = { min: vector(bounds.min), max: vector(bounds.max), size: vector(size) };
  }

  return {
    name: object.name,
    type: object.type,
    position: vector(worldPosition),
    quaternion: [worldQuaternion.x, worldQuaternion.y, worldQuaternion.z, worldQuaternion.w],
    scale: vector(worldScale),
    axes: { x: vector(x), y: vector(y), z: vector(z) },
    bounds: measuredBounds,
  };
}
