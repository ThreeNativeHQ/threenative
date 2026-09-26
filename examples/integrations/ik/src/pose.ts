export type Point3 = readonly [number, number, number];
export type Rotation4 = readonly [number, number, number, number];
export interface IPoseTarget {
  readonly position: Point3;
  readonly quaternion?: Rotation4;
}
function finite(values: ArrayLike<number>, count: number, label: string): void {
  if (values.length !== count || Array.from(values).some((value) => !Number.isFinite(value)))
    throw new Error(`IK ${label} requires ${count} finite values.`);
}
/** The donor supports rigid frames. Uniform scaling is folded into link translations. */
export function uniformScaleOf(m: ArrayLike<number>): number {
  finite(m, 16, "matrix");
  if (Math.abs(m[3]) + Math.abs(m[7]) + Math.abs(m[11]) + Math.abs(m[15] - 1) > 1e-6)
    throw new Error("IK requires an affine transform.");
  const x = Math.hypot(m[0], m[1], m[2]);
  const y = Math.hypot(m[4], m[5], m[6]);
  const z = Math.hypot(m[8], m[9], m[10]);
  if (x < 1e-8 || Math.abs(x - y) > 1e-5 * x || Math.abs(x - z) > 1e-5 * x)
    throw new Error("IK requires nonsingular positive uniform scale.");
  const dot = (a: number, b: number) => m[a] * m[b] + m[a + 1] * m[b + 1] + m[a + 2] * m[b + 2];
  if (Math.abs(dot(0, 4)) + Math.abs(dot(0, 8)) + Math.abs(dot(4, 8)) > 1e-5 * x * x)
    throw new Error("IK does not support shear.");
  const determinant =
    m[0] * (m[5] * m[10] - m[6] * m[9]) -
    m[4] * (m[1] * m[10] - m[2] * m[9]) +
    m[8] * (m[1] * m[6] - m[2] * m[5]);
  if (determinant <= 0) throw new Error("IK does not support reflected transforms.");
  return x;
}
export function angularError(a: ArrayLike<number>, b: ArrayLike<number>): number {
  finite(a, 4, "quaternion");
  finite(b, 4, "quaternion");
  const an = Math.hypot(a[0], a[1], a[2], a[3]);
  const bn = Math.hypot(b[0], b[1], b[2], b[3]);
  if (an < 1e-10 || bn < 1e-10) throw new Error("IK quaternion cannot be zero.");
  const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) / (an * bn);
  return 2 * Math.acos(Math.min(1, Math.abs(dot)));
}
export function contactError(a: ArrayLike<number>, b: ArrayLike<number>): number {
  finite(a, 3, "position");
  finite(b, 3, "position");
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
export function validateTargets(
  targets: readonly IPoseTarget[],
  count: number,
): readonly IPoseTarget[] {
  if (count < 1 || targets.length !== count)
    throw new Error(`IK requires exactly ${count} nonempty goals.`);
  return targets.map((target) => {
    finite(target.position, 3, "target position");
    const position: Point3 = [...target.position];
    if (target.quaternion === undefined) return { position };
    angularError(target.quaternion, [0, 0, 0, 1]);
    const length = Math.hypot(...target.quaternion);
    const quaternion: Rotation4 = [
      target.quaternion[0] / length,
      target.quaternion[1] / length,
      target.quaternion[2] / length,
      target.quaternion[3] / length,
    ];
    return { position, quaternion };
  });
}
