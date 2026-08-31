// Every triangle in the quarry, generated from a seed. Nothing here is committed as bytes: the
// bake writes these arrays into `.glb` files under an ignored `assets/`, and `positionHash`
// is what two machines compare before they compare frame times.
//
// Sizes are the instrument, so they are named constants rather than call-site literals: a rung
// that changes silently between two runs is two experiments reported as one.
import { ValueNoise3D, createLcg, positionHash } from "./seed.js";
import { FLOOR_EXTENT, FLOOR_SEGMENTS, floorHeight } from "./terrain.js";

export interface IGeneratedBody {
  readonly indices: Uint32Array;
  readonly name: string;
  readonly normals: Float32Array;
  readonly positions: Float32Array;
}

export interface IBoulderPlacement {
  readonly rotationY: number;
  readonly scale: number;
  readonly source: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const CLIFF_SEED = 90271;
export const BOULDER_SEED = 41503;
export const GANTRY_SEED = 55107;
export const PLACEMENT_SEED = 1337;

/** Quads across and down the hero face. 1400 x 714 quads is 1,999,200 triangles. */
export const CLIFF_COLUMNS = 1400;
export const CLIFF_ROWS = 714;
/** The face spans this many metres across, and stands this many metres tall. */
export const CLIFF_WIDTH = 62;
export const CLIFF_HEIGHT = 26;
/** Where the face stands. The route ends nose-on to it, so this is load-bearing for the walk. */
export const CLIFF_Z = -26;

/**
 * Sub-triangles per icosahedron edge, one per boulder source. Twenty times the square of each is
 * the triangle count: 151,380 through 397,620, which is PRD-280's stated 150k–400k band.
 */
export const BOULDER_SUBDIVISIONS = [87, 96, 106, 116, 126, 141] as const;
export const BOULDER_INSTANCES = 396;

const cliffNoise = new ValueNoise3D(CLIFF_SEED);

/**
 * How far the face stands out from the plane at `CLIFF_Z`, in metres.
 *
 * Exported because the route ends nose-on to this surface at 0.4 m, and a route that guessed where
 * the rock was would be measuring a different approach on any machine that regenerated it.
 */
export function cliffDisplacement(x: number, y: number): number {
  const coarse = cliffNoise.fractal(x * 0.035, y * 0.035, 0, 5) * 4.2;
  const strata = Math.sin(y * 1.35 + cliffNoise.sample(x * 0.09, y * 0.05, 3.5) * 2.2) * 0.42;
  const chisel = cliffNoise.fractal(x * 0.42, y * 0.42, 7, 3) * 0.55;
  // Detail down to roughly the triangle: the grid's quads are 4.4 cm across, and a body whose
  // finest feature is metres wide is smooth at the triangle scale — two million triangles that
  // decimate to five percent with nothing visibly lost. That would rig every later comparison in
  // this batch in the decimated arm's favour, so the density has something to carry.
  const grain = cliffNoise.fractal(x * 3.1, y * 3.1, 11, 5) * 0.13;
  // The face leans back as it rises, the way a cut bench does, so the walk approaches an overhang
  // rather than a wall that is the same at every height.
  const lean = (y / CLIFF_HEIGHT) * -2.4;
  return coarse + strata + chisel + grain + lean;
}

/** World-space z of the face at eye level, for the route's final metres. */
export function cliffSurfaceZ(x: number, y: number): number {
  return CLIFF_Z + cliffDisplacement(x, y);
}

/** Kept for the report and the spec: the instrument's density, stated rather than counted later. */
export function cliffTriangleCount(): number {
  return CLIFF_COLUMNS * CLIFF_ROWS * 2;
}

export function boulderTriangleCount(source: number): number {
  const subdivisions = BOULDER_SUBDIVISIONS[source];
  if (subdivisions === undefined) throw new Error(`No boulder source ${source}.`);
  return 20 * subdivisions * subdivisions;
}

/**
 * The hero face: a displaced grid standing across the north wall of the pit.
 *
 * Normals come from central differences of the same displacement function rather than from
 * accumulated face normals, because a two-million-triangle accumulation is where a floating-point
 * summation order quietly makes two machines disagree.
 */
export function buildCliff(): IGeneratedBody {
  const columns = CLIFF_COLUMNS;
  const rows = CLIFF_ROWS;
  const vertexCount = (columns + 1) * (rows + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(columns * rows * 6);

  const displace = cliffDisplacement;

  for (let row = 0; row <= rows; row += 1) {
    const y = (row / rows) * CLIFF_HEIGHT;
    for (let column = 0; column <= columns; column += 1) {
      const x = (column / columns - 0.5) * CLIFF_WIDTH;
      const offset = (row * (columns + 1) + column) * 3;
      positions[offset] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = CLIFF_Z + displace(x, y);
      const epsilon = 0.01;
      const dx = (displace(x + epsilon, y) - displace(x - epsilon, y)) / (2 * epsilon);
      const dy = (displace(x, y + epsilon) - displace(x, y - epsilon)) / (2 * epsilon);
      // The surface is z = f(x, y), so its normal is (-df/dx, -df/dy, 1), normalised.
      const length = Math.hypot(dx, dy, 1);
      normals[offset] = -dx / length;
      normals[offset + 1] = -dy / length;
      normals[offset + 2] = 1 / length;
    }
  }

  let cursor = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      // Wound so the face's normal is +z, out of the pit and toward the walk. The mirror image of
      // this loop is correct for the floor, whose rows run along z rather than y — which is how a
      // two-million-triangle hero body spent a whole measurement back-face culled and invisible.
      indices[cursor] = a;
      indices[cursor + 1] = b;
      indices[cursor + 2] = c;
      indices[cursor + 3] = b;
      indices[cursor + 4] = d;
      indices[cursor + 5] = c;
      cursor += 6;
    }
  }

  return { indices, name: "cliff", normals, positions };
}

/**
 * One boulder source: a subdivided icosahedron displaced radially.
 *
 * Closed and manifold on purpose. PRD-282's "no background pixel through a body that is closed in
 * the source" needs bodies that are actually closed in the source, and a lat-long sphere's seam
 * and poles would hand the cluster baker free boundary edges to lock and hide a real crack behind.
 */
export function buildBoulder(source: number): IGeneratedBody {
  const subdivisions = BOULDER_SUBDIVISIONS[source];
  if (subdivisions === undefined) throw new Error(`No boulder source ${source}.`);
  const noise = new ValueNoise3D(BOULDER_SEED + source * 7919);
  const sphere = subdividedIcosahedron(subdivisions);
  const vertexCount = sphere.positions.length / 3;
  const positions = new Float32Array(vertexCount * 3);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    const x = sphere.positions[offset] as number;
    const y = sphere.positions[offset + 1] as number;
    const z = sphere.positions[offset + 2] as number;
    const lumps = noise.fractal(x * 1.6, y * 1.6, z * 1.6, 4) * 0.28;
    // Same reason as the cliff's grain: a boulder of 200,000 triangles whose finest feature spans
    // a tenth of its radius is a boulder that decimates for free.
    const grain = noise.fractal(x * 9, y * 9, z * 9, 3) * 0.045;
    const pits = noise.fractal(x * 34, y * 34, z * 34, 3) * 0.012;
    // Flattened on one axis so a boulder reads as a broken slab rather than a potato, and so the
    // normal-cone rejection PRD-283 tests has something directional to reject.
    const radius = 1 + lumps + grain + pits;
    positions[offset] = x * radius * 1.18;
    positions[offset + 1] = y * radius * 0.72;
    positions[offset + 2] = z * radius;
  }
  return {
    indices: sphere.indices,
    name: `boulder-${source}`,
    normals: accumulatedNormals(positions, sphere.indices),
    positions,
  };
}

/** The control surface. Its pixels must not change between arms, so nothing ever simplifies it. */
export function buildFloor(): IGeneratedBody {
  const segments = FLOOR_SEGMENTS;
  const vertexCount = (segments + 1) * (segments + 1);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(segments * segments * 6);
  const step = (FLOOR_EXTENT * 2) / segments;

  for (let row = 0; row <= segments; row += 1) {
    const z = -FLOOR_EXTENT + row * step;
    for (let column = 0; column <= segments; column += 1) {
      const x = -FLOOR_EXTENT + column * step;
      const offset = (row * (segments + 1) + column) * 3;
      positions[offset] = x;
      positions[offset + 1] = floorHeight(x, z);
      positions[offset + 2] = z;
      const epsilon = 0.05;
      const dx = (floorHeight(x + epsilon, z) - floorHeight(x - epsilon, z)) / (2 * epsilon);
      const dz = (floorHeight(x, z + epsilon) - floorHeight(x, z - epsilon)) / (2 * epsilon);
      const length = Math.hypot(dx, 1, dz);
      normals[offset] = -dx / length;
      normals[offset + 1] = 1 / length;
      normals[offset + 2] = -dz / length;
    }
  }

  let cursor = 0;
  for (let row = 0; row < segments; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      const a = row * (segments + 1) + column;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices[cursor] = a;
      indices[cursor + 1] = c;
      indices[cursor + 2] = b;
      indices[cursor + 3] = b;
      indices[cursor + 4] = c;
      indices[cursor + 5] = d;
      cursor += 6;
    }
  }

  return { indices, name: "floor", normals, positions };
}

/**
 * The collapsed gantry: thin beams and one alpha-cut grating panel.
 *
 * It is here to be the thing most likely to look wrong. A batch that only ever measures closed,
 * opaque, chunky rock finds out about thin and masked geometry after it has shipped.
 */
export function buildGantry(): IGeneratedBody {
  const random = createLcg(GANTRY_SEED);
  const positions: number[] = [];
  const indices: number[] = [];

  const beam = (
    x: number,
    y: number,
    z: number,
    length: number,
    thickness: number,
    yaw: number,
    pitch: number,
  ): void => {
    const half = thickness / 2;
    const corners: [number, number, number][] = [];
    for (const along of [-length / 2, length / 2])
      for (const up of [-half, half])
        for (const side of [-half, half]) corners.push([along, up, side]);
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const base = positions.length / 3;
    for (const [along, up, side] of corners) {
      const py = along * sinPitch + up * cosPitch;
      const pa = along * cosPitch - up * sinPitch;
      positions.push(x + pa * cosYaw - side * sinYaw, y + py, z + pa * sinYaw + side * cosYaw);
    }
    // Corner order above is (along, up, side) with side fastest, so vertex i carries +along when
    // `i & 4`, +up when `i & 2` and +side when `i & 1`. (along, up, side) maps to (+X, +Y, +Z) at
    // zero yaw and pitch, which is right-handed, so each face below is wound to face outwards.
    const box = [
      0, 1, 3, 0, 3, 2, 4, 7, 5, 4, 6, 7, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1,
      5, 7, 1, 7, 3,
    ];
    for (const index of box) indices.push(base + index);
  };

  for (let member = 0; member < 26; member += 1) {
    const x = -14 + random() * 26;
    const z = -20 + random() * 16;
    const y = floorHeight(x, z) + 0.4 + random() * 3.2;
    beam(
      x,
      y,
      z,
      2.4 + random() * 6.5,
      0.11 + random() * 0.09,
      random() * Math.PI,
      (random() - 0.5) * 1.5,
    );
  }

  const packedPositions = new Float32Array(positions);
  const packedIndices = new Uint32Array(indices);
  return {
    indices: packedIndices,
    name: "gantry",
    normals: accumulatedNormals(packedPositions, packedIndices),
    positions: packedPositions,
  };
}

/**
 * The grating panel, its own body because it is its own hazard.
 *
 * Alpha-cut geometry and thin opaque geometry fail differently, and one mesh carrying both would
 * mask the whole panel's cut across the beams — which is what it looked like the first time.
 */
export function buildGrating(): IGeneratedBody {
  const y = floorHeight(-2, -14) + 1.6;
  const positions = new Float32Array([-6, y, -14, 2, y, -14, -6, y + 3.4, -14, 2, y + 3.4, -14]);
  const indices = new Uint32Array([0, 1, 2, 1, 3, 2]);
  return {
    indices,
    name: "grating",
    normals: accumulatedNormals(positions, indices),
    positions,
  };
}

export function boulderPlacements(): IBoulderPlacement[] {
  const random = createLcg(PLACEMENT_SEED);
  const placements: IBoulderPlacement[] = [];
  for (let index = 0; index < BOULDER_INSTANCES; index += 1) {
    const angle = random() * Math.PI * 2;
    // Biased toward the pit floor, where the walk spends most of its frames. The twelve-metre
    // keep-out around the pit centre is not decoration: AC5 photographs that patch of floor in
    // every arm and needs a frame with nothing in it but the control surface.
    const radius = 12 + random() ** 1.7 * (FLOOR_EXTENT - 18);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    placements.push({
      rotationY: random() * Math.PI * 2,
      scale: 0.7 + random() * 2.1,
      source: index % BOULDER_SUBDIVISIONS.length,
      x,
      y: floorHeight(x, z) - 0.25,
      z,
    });
  }
  return placements;
}

export function bodyPositionHash(body: IGeneratedBody): string {
  return positionHash(body.positions);
}

/** Area-weighted vertex normals, accumulated in index order so the sum is reproducible. */
function accumulatedNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const a = (indices[triangle] as number) * 3;
    const b = (indices[triangle + 1] as number) * 3;
    const c = (indices[triangle + 2] as number) * 3;
    const abx = (positions[b] as number) - (positions[a] as number);
    const aby = (positions[b + 1] as number) - (positions[a + 1] as number);
    const abz = (positions[b + 2] as number) - (positions[a + 2] as number);
    const acx = (positions[c] as number) - (positions[a] as number);
    const acy = (positions[c + 1] as number) - (positions[a + 1] as number);
    const acz = (positions[c + 2] as number) - (positions[a + 2] as number);
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const offset of [a, b, c]) {
      normals[offset] = (normals[offset] as number) + nx;
      normals[offset + 1] = (normals[offset + 1] as number) + ny;
      normals[offset + 2] = (normals[offset + 2] as number) + nz;
    }
  }
  for (let offset = 0; offset < normals.length; offset += 3) {
    const x = normals[offset] as number;
    const y = normals[offset + 1] as number;
    const z = normals[offset + 2] as number;
    const length = Math.hypot(x, y, z);
    if (length === 0) {
      normals[offset + 1] = 1;
      continue;
    }
    normals[offset] = x / length;
    normals[offset + 1] = y / length;
    normals[offset + 2] = z / length;
  }
  return normals;
}

interface ISphereMesh {
  readonly indices: Uint32Array;
  readonly positions: Float32Array;
}

const ICOSAHEDRON_FACES: readonly (readonly [number, number, number])[] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

/**
 * An icosahedron with each face split into `subdivisions²` sub-triangles, projected to the unit
 * sphere, with edge vertices shared between the two faces that meet on them.
 *
 * Edge points are computed from the lower-indexed endpoint in both faces, so the two faces produce
 * bit-identical coordinates and the shared vertex is shared by construction — not recovered
 * afterwards by welding coordinates that nearly match, which is where a "closed" body stops
 * being closed.
 */
function subdividedIcosahedron(subdivisions: number): ISphereMesh {
  const phi = (1 + Math.sqrt(5)) / 2;
  const corners: [number, number, number][] = [
    [-1, phi, 0],
    [1, phi, 0],
    [-1, -phi, 0],
    [1, -phi, 0],
    [0, -1, phi],
    [0, 1, phi],
    [0, -1, -phi],
    [0, 1, -phi],
    [phi, 0, -1],
    [phi, 0, 1],
    [-phi, 0, -1],
    [-phi, 0, 1],
  ].map((corner) => normalize(corner as [number, number, number]));

  const positions: number[] = [];
  const byKey = new Map<string, number>();
  const push = (key: string, point: [number, number, number]): number => {
    const existing = byKey.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length / 3;
    positions.push(point[0], point[1], point[2]);
    byKey.set(key, index);
    return index;
  };

  const edgePoint = (from: number, to: number, step: number): number => {
    const [low, high, offset] = from < to ? [from, to, step] : [to, from, subdivisions - step];
    const key = `e${low}_${high}_${offset}`;
    const existing = byKey.get(key);
    if (existing !== undefined) return existing;
    const a = corners[low] as [number, number, number];
    const b = corners[high] as [number, number, number];
    const t = offset / subdivisions;
    return push(
      key,
      normalize([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]),
    );
  };

  const indices: number[] = [];
  for (let face = 0; face < ICOSAHEDRON_FACES.length; face += 1) {
    const [i0, i1, i2] = ICOSAHEDRON_FACES[face] as [number, number, number];
    const v0 = corners[i0] as [number, number, number];
    const v1 = corners[i1] as [number, number, number];
    const v2 = corners[i2] as [number, number, number];
    const grid: number[][] = [];
    for (let down = 0; down <= subdivisions; down += 1) {
      const row: number[] = [];
      for (let across = 0; across <= subdivisions - down; across += 1) {
        if (down === 0 && across === 0) row.push(push(`c${i0}`, v0));
        else if (down === 0 && across === subdivisions) row.push(push(`c${i1}`, v1));
        else if (down === subdivisions) row.push(push(`c${i2}`, v2));
        else if (down === 0) row.push(edgePoint(i0, i1, across));
        else if (across === 0) row.push(edgePoint(i0, i2, down));
        else if (across + down === subdivisions) row.push(edgePoint(i1, i2, down));
        else {
          const a = across / subdivisions;
          const b = down / subdivisions;
          row.push(
            push(
              `f${face}_${across}_${down}`,
              normalize([
                v0[0] + (v1[0] - v0[0]) * a + (v2[0] - v0[0]) * b,
                v0[1] + (v1[1] - v0[1]) * a + (v2[1] - v0[1]) * b,
                v0[2] + (v1[2] - v0[2]) * a + (v2[2] - v0[2]) * b,
              ]),
            ),
          );
        }
      }
      grid.push(row);
    }
    for (let down = 0; down < subdivisions; down += 1) {
      const row = grid[down] as number[];
      const next = grid[down + 1] as number[];
      for (let across = 0; across < subdivisions - down; across += 1) {
        indices.push(row[across] as number, row[across + 1] as number, next[across] as number);
        if (across < subdivisions - down - 1)
          indices.push(
            row[across + 1] as number,
            next[across + 1] as number,
            next[across] as number,
          );
      }
    }
  }

  return { indices: new Uint32Array(indices), positions: new Float32Array(positions) };
}

function normalize(point: [number, number, number]): [number, number, number] {
  const length = Math.hypot(point[0], point[1], point[2]);
  return [point[0] / length, point[1] / length, point[2] / length];
}
