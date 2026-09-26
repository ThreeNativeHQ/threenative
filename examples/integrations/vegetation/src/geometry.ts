export interface IWind {
  readonly amplitude: number;
  readonly frequency: number;
  readonly phase: number;
  readonly base: number;
  readonly extent: number;
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
    const index = indices[i];
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
      options.base,
      options.extent,
      ...options.direction,
    ].every(Number.isFinite) ||
    options.amplitude < 0 ||
    options.frequency < 0 ||
    options.extent <= 0 ||
    options.direction.length !== 2
  )
    throw new Error(
      "Wind requires finite values, nonnegative amplitude/frequency, and positive extent.",
    );
  const length = Math.hypot(...options.direction);
  if (length < 1e-8) throw new Error("Wind direction cannot be zero.");
  return { ...options, direction: [options.direction[0] / length, options.direction[1] / length] };
}
/** CPU reference for the same smoothstep displacement and Jacobian used by the TSL material. */
export function windSample(
  height: number,
  time: number,
  options: IWind,
): { offset: number; slope: number } {
  const wind = validateWind(options);
  if (!Number.isFinite(height) || !Number.isFinite(time))
    throw new Error("Wind sample requires finite height and simulation time.");
  const t = Math.max(0, Math.min(1, (height - wind.base) / wind.extent));
  const oscillation = wind.amplitude * Math.sin(time * wind.frequency + wind.phase);
  return {
    offset: oscillation * t * t * (3 - 2 * t),
    slope: (oscillation * 6 * t * (1 - t)) / wind.extent,
  };
}
