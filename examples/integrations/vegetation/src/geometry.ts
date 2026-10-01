export interface IWind {
  /** Peak sway of the canopy, in world metres. */
  readonly amplitude: number;
  readonly frequency: number;
  readonly phase: number;
  /** The tree's height in world metres, the denominator that turns weight into height. */
  readonly height: number;
  /** World-space XZ heading; a yawed clone sways along the same world direction. */
  readonly direction: readonly [number, number];
}
/** Use the donor's raw number[] indices, never its already-truncated Uint16Array. */
export function safeIndices(
  indices: ArrayLike<number>,
  vertices: number,
): Uint16Array | Uint32Array {
  if (!Number.isSafeInteger(vertices) || vertices < 0 || vertices > 0xffffffff)
    throw new Error("Tree vertex count is invalid.");
  if (indices.length % 3 !== 0) throw new Error("Tree indices must contain complete triangles.");
  let maximum = 0;
  for (let i = 0; i < indices.length; i++) {
    const index = indices[i] ?? Number.NaN;
    if (!Number.isInteger(index) || index < 0 || index >= vertices)
      throw new Error(`Tree index ${i} is outside its vertex buffer.`);
    maximum = Math.max(maximum, index);
  }
  return maximum > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
}
export function validateWind(options: IWind): IWind {
  if (
    ![
      options.amplitude,
      options.frequency,
      options.phase,
      options.height,
      ...options.direction,
    ].every(Number.isFinite) ||
    options.amplitude < 0 ||
    options.frequency < 0 ||
    options.height <= 0 ||
    options.direction.length !== 2
  )
    throw new Error(
      "Wind requires finite values, nonnegative amplitude/frequency, and a positive tree height.",
    );
  const length = Math.hypot(...options.direction);
  if (length < 1e-8) throw new Error("Wind direction cannot be zero.");
  return { ...options, direction: [options.direction[0] / length, options.direction[1] / length] };
}
/**
 * CPU reference for the same displacement and Jacobian the TSL material applies.
 * `weight` is the baked `_wind` share of tree height in [0,1], not a length: it was measured
 * before the asset cook moved a dequantization scale onto each mesh, so it still means the same
 * thing after cooking, when local units are not metres and local y=0 is not the ground.
 * `offset` is world metres; `slope` is d(offset)/d(world height) for the shading normal.
 */
export function windSample(
  weight: number,
  time: number,
  options: IWind,
): { offset: number; slope: number } {
  const wind = validateWind(options);
  if (!Number.isFinite(time)) throw new Error("Wind sample requires finite simulation time.");
  if (!Number.isFinite(weight) || weight < 0 || weight > 1)
    throw new Error("Wind sample needs the baked _wind weight in [0, 1].");
  const oscillation = wind.amplitude * Math.sin(time * wind.frequency + wind.phase);
  return {
    offset: oscillation * weight * weight * (3 - 2 * weight),
    slope: (oscillation * 6 * weight * (1 - weight)) / wind.height,
  };
}
