/** Rapier packs membership in the high 16 bits and the filter in the low 16. */
export function interactionGroups(layer: number, mask: number): number {
  if (!Number.isInteger(layer) || layer < 0 || layer > 0xffff)
    throw new Error("interactionGroups: layer must be an integer in 0..0xffff.");
  if (!Number.isInteger(mask) || mask < 0 || mask > 0xffff)
    throw new Error("interactionGroups: mask must be an integer in 0..0xffff.");
  return ((layer << 16) | mask) >>> 0;
}
