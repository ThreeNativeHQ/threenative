// Finite current estimator: piecewise constant radiance on the periodic raw4 Voronoi cells.
// Opaque PBR is still pixel-frequency radiance broadcast to covered sites: an explicit spatial
// approximation. These areas do not claim the exact continuous material integral.
export const CURRENT_SAMPLE_POSITIONS = [
  [3 / 8, 1 / 8],
  [7 / 8, 3 / 8],
  [1 / 8, 5 / 8],
  [5 / 8, 7 / 8],
] as const;
type Point = readonly [number, number];

/** Four periodic nearest candidates, preserving the exhaustive row/cell/sample tie order. */
export function nearestCurrentSample(point: Point) {
  let best = { x: 0, y: 0, sample: 0, distance: Number.POSITIVE_INFINITY };
  for (let sample = 0; sample < 4; sample++) {
    const site = CURRENT_SAMPLE_POSITIONS[sample] as Point;
    const x = Math.ceil(point[0] - site[0] - 0.5) + 0;
    const y = Math.ceil(point[1] - site[1] - 0.5) + 0;
    const distance = (point[0] - x - site[0]) ** 2 + (point[1] - y - site[1]) ** 2;
    if (
      distance < best.distance ||
      (distance === best.distance &&
        (y < best.y || (y === best.y && (x < best.x || (x === best.x && sample < best.sample)))))
    )
      best = { x, y, sample, distance };
  }
  return best;
}
export const CURRENT_SAMPLE_CELLS: readonly (readonly Point[])[] = [
  [
    [1 / 6, 1 / 3],
    [0, 0],
    [1 / 3, -1 / 6],
    [2 / 3, 1 / 6],
    [1 / 2, 1 / 2],
  ],
  [
    [5 / 6, 2 / 3],
    [1 / 2, 1 / 2],
    [2 / 3, 1 / 6],
    [1, 0],
    [7 / 6, 1 / 3],
  ],
  [
    [0, 1],
    [-1 / 6, 2 / 3],
    [1 / 6, 1 / 3],
    [1 / 2, 1 / 2],
    [1 / 3, 5 / 6],
  ],
  [
    [1 / 3, 5 / 6],
    [1 / 2, 1 / 2],
    [5 / 6, 2 / 3],
    [1, 1],
    [2 / 3, 7 / 6],
  ],
];

/** Clip one convex sample cell to the destination's finite rectangular footprint. */
export function currentSampleOverlap(sample: number, minimum: Point, maximum: Point): number {
  let polygon: readonly Point[] = CURRENT_SAMPLE_CELLS[sample] ?? [];
  for (const [axis, bound, sign] of [
    [0, minimum[0], -1],
    [0, maximum[0], 1],
    [1, minimum[1], -1],
    [1, maximum[1], 1],
  ] as const) {
    const next: Point[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i] as Point;
      const b = polygon[(i + 1) % polygon.length] as Point;
      const da = sign * (a[axis] - bound);
      const db = sign * (b[axis] - bound);
      if (da <= 0) next.push(a);
      if (da > 0 !== db > 0) {
        const t = da / (da - db);
        next.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    polygon = next;
  }
  let twiceArea = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Point;
    const b = polygon[(i + 1) % polygon.length] as Point;
    twiceArea += a[0] * b[1] - a[1] * b[0];
  }
  return Math.abs(twiceArea) / 2;
}

export interface ICurrentFootprintTap {
  readonly x: number;
  readonly y: number;
  readonly sample: number;
  readonly weight: number;
}
/** CPU form of the same finite contract. A 3×3 cell block covers a destination footprint <=1 per
 * axis because each periodic cell lies in [-1/6,7/6]. Edges use the existing baseline rather than
 * clamping multiple outside cells onto one physical site. */
export function raw4FootprintWeights(
  input: Point,
  display: Point,
  uv: Point,
  jitter: Point,
): readonly ICurrentFootprintTap[] | undefined {
  if (
    ![...input, ...display, ...uv, ...jitter].every(Number.isFinite) ||
    input.some((v) => v < 1) ||
    input[0] > display[0] ||
    input[1] > display[1] ||
    (input[0] === display[0] && input[1] === display[1])
  )
    return undefined;
  const p: Point = [uv[0] * input[0] - jitter[0], uv[1] * input[1] - jitter[1]];
  const centre: Point = [Math.floor(p[0]), Math.floor(p[1])];
  if (centre[0] < 1 || centre[1] < 1 || centre[0] >= input[0] - 1 || centre[1] >= input[1] - 1)
    return undefined;
  const half: Point = [input[0] / display[0] / 2, input[1] / display[1] / 2];
  const area = 4 * half[0] * half[1];
  const taps: ICurrentFootprintTap[] = [];
  for (let y = -1; y <= 1; y++)
    for (let x = -1; x <= 1; x++)
      for (let sample = 0; sample < 4; sample++) {
        const cx = centre[0] + x;
        const cy = centre[1] + y;
        const overlap = currentSampleOverlap(
          sample,
          [p[0] - half[0] - cx, p[1] - half[1] - cy],
          [p[0] + half[0] - cx, p[1] + half[1] - cy],
        );
        if (overlap > 1e-14) taps.push({ x: cx, y: cy, sample, weight: overlap / area });
      }
  return taps;
}
