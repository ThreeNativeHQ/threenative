/**
 * Moving a mesh's UVs onto its atlas page, and deciding which meshes may not go.
 *
 * The rewrite itself is two multiplies and two adds per vertex. The decision in front of it is the
 * part that matters: a surface that samples outside `[0, 1]` tiles, and a tiling surface on a
 * shared page reads its neighbours. That is a visible bug that looks like corruption, so the
 * policy here is to detect it from the geometry's own UVs and from the sampler's wrap mode, refuse
 * to pack the source, and report it — never to clamp, and never to guess from the image.
 */

import type { IAtlasTransform } from "./packer.js";

/** glTF sampler wrap modes; `10497` is REPEAT and `33648` is MIRRORED_REPEAT. */
export const WRAP_REPEAT = 10_497;
export const WRAP_MIRRORED_REPEAT = 33_648;
export const WRAP_CLAMP_TO_EDGE = 33_071;

/**
 * Slack allowed before a UV counts as leaving the unit square.
 *
 * Exporters land a nominally-zero coordinate a few ULPs either side of the boundary, and treating
 * that as tiling would exclude most of a scene for nothing. A texel of a 4096 page is 2.4e-4, so
 * this is two orders of magnitude below anything that could sample a neighbour.
 */
const UV_EPSILON = 1e-4;

/** Whether this UV set samples outside the unit square, and therefore tiles. */
export function uvsTile(uv: ArrayLike<number>): boolean {
  for (let index = 0; index < uv.length; index += 1) {
    const value = uv[index] ?? 0;
    if (value < -UV_EPSILON || value > 1 + UV_EPSILON) return true;
  }
  return false;
}

/** Whether the sampler asks to repeat. A wrap mode the packer does not know is treated as tiling. */
export function wrapTiles(wrapS: number | undefined, wrapT: number | undefined): boolean {
  for (const wrap of [wrapS, wrapT]) {
    if (wrap === undefined || wrap === WRAP_CLAMP_TO_EDGE) continue;
    return true;
  }
  return false;
}

/**
 * Rewrites a UV buffer in place onto its atlas page.
 *
 * In place because the caller owns a freshly-decoded accessor and a second buffer per mesh is a
 * copy of the whole scene's UVs for nothing. Throws on an odd-length buffer rather than rewriting
 * half a coordinate.
 */
export function rewriteUvs(uv: Float32Array, transform: IAtlasTransform): Float32Array {
  if (uv.length % 2 !== 0)
    throw new Error(`A UV buffer must hold pairs, received ${String(uv.length)} values.`);
  for (let index = 0; index < uv.length; index += 2) {
    uv[index] = (uv[index] ?? 0) * transform.scaleX + transform.offsetX;
    uv[index + 1] = (uv[index + 1] ?? 0) * transform.scaleY + transform.offsetY;
  }
  return uv;
}

/**
 * The texel a rewritten UV resolves to, in the source image's own pixel space.
 *
 * This is the inverse of `rewriteUvs` composed with the page geometry, and it exists so a test can
 * assert the round trip rather than assert the arithmetic against itself: sample a texel, rewrite,
 * resolve, and land within a texel of where you started.
 */
export function resolveSourceTexel(
  atlasUv: readonly [number, number],
  transform: IAtlasTransform,
  source: { readonly width: number; readonly height: number },
): { x: number; y: number } {
  const u = (atlasUv[0] - transform.offsetX) / transform.scaleX;
  const v = (atlasUv[1] - transform.offsetY) / transform.scaleY;
  return { x: u * source.width, y: v * source.height };
}
