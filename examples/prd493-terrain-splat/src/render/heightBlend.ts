/**
 * The curve that decides how a terrain layer's mask weight meets its own height map. The package
 * mixes colour, normal and ORM by whatever this returns, and owns no constant of it.
 *
 * Unreal's height blend: the painted weight w becomes `saturate((2w - 1) + h * k)`. At w = 0.5 the
 * layer shows only where its height h is above zero, at w = 1 it covers fully, at w = 0 it never
 * shows. The maps are 8-bit, so zero height sits at 0.5 and `k = 2` lets h reach both ends.
 */
import type { ILoadTerrainSplatOptions } from "@threenative/core/world";
import { saturate } from "three/tsl";

/** How far a layer's own relief pushes its edge: 2 makes the full map range worth one whole weight. */
export const HEIGHT_BLEND_STRENGTH = 2;

export const heightBlend: NonNullable<ILoadTerrainSplatOptions["layerWeight"]> = (
  weight,
  { height },
) =>
  height === undefined
    ? weight
    : saturate(weight.mul(2).sub(1).add(height.sub(0.5).mul(HEIGHT_BLEND_STRENGTH)));
