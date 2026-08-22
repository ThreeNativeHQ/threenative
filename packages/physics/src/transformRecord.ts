/**
 * Checked reads from the bulk step buffers.
 *
 * The plugin moves kinematic input and visible transforms through shared Float32Arrays so the
 * fixed-step crossing stays bulk-shaped and never per-object per-frame. Reading a record used to
 * mean an `Array.from` plus a closure per body per step; these helpers index the buffer directly
 * and throw exactly where the old helper threw — on the first malformed slot, in slot order.
 */

export function bulkTransformValue(values: Readonly<Float32Array>, index: number): number {
  const value = values[index];
  if (value === undefined || !Number.isFinite(value))
    throw new Error("IPhysicsSimulation returned a malformed transform.");
  return value;
}
