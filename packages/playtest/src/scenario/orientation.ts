// Pure aim/orientation math for the scenario setup vocabulary. No three.js import:
// the runner composes quaternion arrays as data, and the bridge-side Object3D applies
// them with `quaternion.fromArray`. Convention (Three.js forward): an object at yaw 0
// faces -Z; yaw increases counter-clockwise around +Y; pitch is positive upward.
// A quaternion is Euler(pitch, yaw, 0, "YXZ"), i.e. qY(yaw) * qX(pitch).

export interface IPlaytestAimAngles {
  pitch: number;
  yaw: number;
}

/**
 * Yaw/pitch that turns a subject at `from` toward `to`, derived from the direction
 * vector. A target coincident with the subject has no direction; that is a named
 * failure, never a NaN quaternion (the sentinel-hack lesson: a zero-length delta
 * silently passed a lengthSq() > 0 emptiness check and parked an entity at y=-1000).
 */
export function aimAngles(from: readonly [number, number, number], to: readonly [number, number, number]): IPlaytestAimAngles {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const lengthSq = dx * dx + dy * dy + dz * dz;
  if (!Number.isFinite(lengthSq) || lengthSq <= 0) {
    throw new Error(
      `aim target (${to.join(", ")}) coincides with the subject position (${from.join(", ")}); no aim direction exists.`,
    );
  }
  return {
    pitch: Math.asin(Math.min(1, Math.max(-1, dy / Math.sqrt(lengthSq)))),
    yaw: Math.atan2(-dx, -dz),
  };
}

export function yawPitchToQuaternion(yaw: number, pitch: number): [number, number, number, number] {
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2);
  const sp = Math.sin(pitch / 2);
  // qY(yaw) * qX(pitch): (w, v) = (cy·cp, (cy·sp, cp·sy, −sy·sp)); −0 is normalized
  // so identity stays [0, 0, 0, 1] under strict equality.
  const qx = cy * sp;
  const qy = cp * sy;
  const qz = -sy * sp;
  const qw = cy * cp;
  const unSign = (value: number): number => (value === 0 ? 0 : value);
  return [unSign(qx), unSign(qy), unSign(qz), unSign(qw)];
}
