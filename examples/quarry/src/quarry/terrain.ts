// The quarry floor's height field, and nothing else. It is imported by the bake (which turns it
// into the control surface's triangles) and by the game (which grounds the camera against it),
// so the walked floor and the drawn floor are the same function by construction rather than by
// two authors agreeing.
import { ValueNoise3D } from "./seed.js";

export const FLOOR_SEED = 20260830;
/** The floor spans [-EXTENT, EXTENT] on both horizontal axes, in metres. */
export const FLOOR_EXTENT = 90;
/** Quads per side of the control surface. Never changes between arms. */
export const FLOOR_SEGMENTS = 512;
/** Radius of the flat pit bottom, in metres. */
const PIT_RADIUS = 26;
/** How far the rim sits above the pit bottom, in metres. */
const RIM_HEIGHT = 22;

const noise = new ValueNoise3D(FLOOR_SEED);

/**
 * A bowl: flat inside the pit, rising to the rim, with a metre of rubble on top of it.
 *
 * One metre is one metre — the return value is metres above the pit floor, which is `y = 0`.
 */
export function floorHeight(x: number, z: number): number {
  const radius = Math.hypot(x, z);
  const bowl =
    radius <= PIT_RADIUS
      ? 0
      : RIM_HEIGHT * smoothstep((radius - PIT_RADIUS) / (FLOOR_EXTENT - PIT_RADIUS));
  const rubble = noise.fractal(x * 0.06, 0.5, z * 0.06, 4) * 0.9;
  // Rubble at the scale a boot notices, which the 17-metre swells above are not. It is also what
  // makes the control surface worth photographing: a floor whose only relief is metres wide
  // renders as one flat luminance, and a frame of one luminance is indistinguishable from a
  // failed capture — the harness says so, and it is right to.
  const grit = noise.fractal(x * 0.75, 2.5, z * 0.75, 4) * 0.22;
  const bench = Math.sin(radius * 0.19) * 0.55 * smoothstep((radius - PIT_RADIUS) / 18);
  return bowl + rubble + grit + bench;
}

function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}
