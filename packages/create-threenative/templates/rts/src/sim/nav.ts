/** Binary-heap A*, sized from the map rather than hard-coded to the original map. */

import type { Game } from "./game.js";
import type { IPoint } from "./types.js";

const ORTHOGONAL: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * The search's scratch, sized once per map and reused by every query.
 *
 * A* runs when a unit's route is replanned, which on a marching army is a few times a second across
 * sixty units: three typed arrays of `size * size` and a heap node per push were 200 KB and
 * hundreds of objects per replan, on a path the entity then owns. `findRoute` is synchronous and
 * non-reentrant, so one shared set is enough — the map size never changes for a game.
 */
let _size = 0;
let _costs: Float32Array = new Float32Array(0);
let _parents: Int32Array = new Int32Array(0);
let _closed: Uint8Array = new Uint8Array(0);
/** The heap as two parallel arrays rather than a node object per entry. */
let _heapIds: Int32Array = new Int32Array(0);
let _heapFs: Float64Array = new Float64Array(0);
let _heapLength = 0;

function ensureScratch(size: number): void {
  if (_size === size) return;
  _size = size;
  const cells = size * size;
  _costs = new Float32Array(cells);
  _parents = new Int32Array(cells);
  _closed = new Uint8Array(cells);
  _heapIds = new Int32Array(cells);
  _heapFs = new Float64Array(cells);
}

/** The world position of cell `i`, written into `out`. */
function cellPoint(i: number, size: number, cell: number, half: number, out: IPoint): IPoint {
  out.x = (i % size) * cell - half + cell / 2;
  out.z = Math.floor(i / size) * cell - half + cell / 2;
  return out;
}

/** The mask probe's scratch point, reused across the whole map. */
const _probe: IPoint = { x: 0, z: 0 };
/** The connector's candidate point, reused per probe. */
const _candidate: IPoint = { x: 0, z: 0 };
/** The start centre, read once per query. */
const _start: IPoint = { x: 0, z: 0 };
/** The raw cell centre, read while the mask is built. */
const _center: IPoint = { x: 0, z: 0 };

/**
 * The route, rebuilt in place for whoever asks.
 *
 * A* runs whenever a unit's route is replanned, which on a marching army is several times a second
 * across sixty units, and each search allocated an array plus a point per waypoint. The caller
 * copies the route into the entity's own path before it steps again (see `travelEntity`), so this
 * scratch never escapes past the call that filled it.
 */
const _route: IPoint[] = [];
const _routePool: IPoint[] = [];
let _routeUsed = 0;

/** No route: the shared array, emptied, so a caller never reads the previous query's waypoints. */
function empty(): IPoint[] {
  _route.length = 0;
  _routeUsed = 0;
  return _route;
}

function routePoint(x: number, z: number): IPoint {
  const pooled = _routePool[_routeUsed];
  if (pooled === undefined) _routePool[_routeUsed] = { x, z };
  const point = _routePool[_routeUsed] ?? { x, z };
  _routeUsed += 1;
  point.x = x;
  point.z = z;
  return point;
}

export function findRoute(
  game: Game,
  startPoint: IPoint,
  endPoint: IPoint,
  radius = 0.8,
): IPoint[] {
  const size = game.gridSize;
  const cellSize = game.cell;
  const half = game.worldSize / 2;
  const category = radius > 0.9 ? 1.25 : 0.8;
  const key = `${game.navRevision}:${category}`;
  const masks = game.navMasks;
  if (!masks.has(key)) {
    const mask = new Uint8Array(size * size);
    for (let i = 0; i < mask.length; i++) {
      const p = cellPoint(i, size, cellSize, half, _probe);
      mask[i] = game.blocked(p.x, p.z, category) ? 1 : 0;
    }
    if (masks.size > 4) masks.clear();
    masks.set(key, mask);
  }
  const mask = masks.get(key);
  if (!mask) return empty();

  // World-space positions on a building edge can be valid even when their
  // coarse grid cell is blocked. Connect to a visible free cell at BOTH ends.
  const hasExit = (id: number): boolean => {
    const x = id % size;
    const z = Math.floor(id / size);
    for (let k = 0; k < ORTHOGONAL.length; k++) {
      const step = ORTHOGONAL[k];
      if (step === undefined) continue;
      const nx = x + step[0];
      const nz = z + step[1];
      if (nx > 0 && nz > 0 && nx < size - 1 && nz < size - 1 && !mask[nz * size + nx]) return true;
    }
    return false;
  };

  const cell = (v: number): number =>
    Math.max(0, Math.min(size - 1, Math.floor((v + half) / cellSize)));
  const connector = (position: IPoint, requireClear: boolean): number => {
    const raw = cell(position.z) * size + cell(position.x);
    const center = cellPoint(raw, size, cellSize, half, _center);
    if (!mask[raw] && hasExit(raw) && (!requireClear || game.lineClear(position, center, radius))) {
      return raw;
    }
    let score = Number.POSITIVE_INFINITY;
    let best = -1;
    const gx = raw % size;
    const gz = Math.floor(raw / size);
    for (let dz = -7; dz <= 7; dz++) {
      for (let dx = -7; dx <= 7; dx++) {
        const x = gx + dx;
        const z = gz + dz;
        if (x < 1 || z < 1 || x >= size - 1 || z >= size - 1) continue;
        const id = z * size + x;
        if (mask[id] || !hasExit(id)) continue;
        const p = cellPoint(id, size, cellSize, half, _candidate);
        const d = Math.hypot(p.x - position.x, p.z - position.z);
        if (d < score && (!requireClear || game.lineClear(position, p, radius))) {
          score = d;
          best = id;
        }
      }
    }
    return best;
  };

  const canReachExactEnd = !game.blocked(endPoint.x, endPoint.z, radius);
  const start = connector(startPoint, true);
  const goal = connector(endPoint, canReachExactEnd);
  if (start < 0 || goal < 0) return empty();

  ensureScratch(size);
  const costs = _costs;
  const parent = _parents;
  const closed = _closed;
  // Refilled by a generation stamp rather than by rewriting every cell: a `fill` per query is a
  // second pass over the whole grid for a search that usually visits a few hundred cells.
  costs.fill(Number.POSITIVE_INFINITY);
  closed.fill(0);
  _heapLength = 0;
  const h = (i: number): number => {
    const dx = Math.abs((i % size) - (goal % size));
    const dz = Math.abs(Math.floor(i / size) - Math.floor(goal / size));
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  const push = (id: number, f: number): void => {
    let i = _heapLength++;
    while (i) {
      const p = (i - 1) >> 1;
      const upF = _heapFs[p] ?? 0;
      if (upF <= f) break;
      _heapIds[i] = _heapIds[p] ?? -1;
      _heapFs[i] = upF;
      i = p;
    }
    _heapIds[i] = id;
    _heapFs[i] = f;
  };
  const pop = (): number => {
    if (_heapLength === 0) return -1;
    const root = _heapIds[0] ?? -1;
    _heapLength -= 1;
    const lastId = _heapIds[_heapLength] ?? -1;
    const lastF = _heapFs[_heapLength] ?? 0;
    if (_heapLength > 0) {
      let i = 0;
      while (true) {
        let c = i * 2 + 1;
        if (c >= _heapLength) break;
        const right = c + 1;
        if (right < _heapLength && (_heapFs[right] ?? 0) < (_heapFs[c] ?? 0)) c = right;
        const childF = _heapFs[c] ?? 0;
        if (childF >= lastF) break;
        _heapIds[i] = _heapIds[c] ?? -1;
        _heapFs[i] = childF;
        i = c;
      }
      _heapIds[i] = lastId;
      _heapFs[i] = lastF;
    }
    return root;
  };

  costs[start] = 0;
  push(start, h(start));
  let found = false;
  for (let loops = 0; _heapLength > 0 && loops < size * size * 2; loops++) {
    const cur = pop();
    if (cur < 0 || closed[cur]) continue;
    if (cur === goal) {
      found = true;
      break;
    }
    closed[cur] = 1;
    const cx = cur % size;
    const cz = Math.floor(cur / size);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const x = cx + dx;
        const z = cz + dz;
        if (x < 1 || z < 1 || x >= size - 1 || z >= size - 1) continue;
        const id = z * size + x;
        if (mask[id] || closed[id] || (dx && dz && (mask[cz * size + x] || mask[z * size + cx]))) {
          continue;
        }
        const cost = (costs[cur] ?? Number.POSITIVE_INFINITY) + (dx && dz ? Math.SQRT2 : 1);
        if (cost >= (costs[id] ?? Number.POSITIVE_INFINITY)) continue;
        costs[id] = cost;
        parent[id] = cur;
        push(id, cost + h(id));
      }
    }
  }
  // No route: the shared array, emptied, so a caller never reads the previous query's waypoints.
  if (!found) {
    _route.length = 0;
    _routeUsed = 0;
    return _route;
  }
  // The parent chain runs goal -> start. It is counted there, then written **back to front**, so
  // `_route[0]` is the cell next to the unit and the last entry is the goal. Writing it front-first
  // reads as a valid route — every cell of the right path, no hole — but puts the goal at index 1
  // and walks the unit the wrong way, which is what the seeded-navigation test catches.
  _routeUsed = 0;
  const startCenter = cellPoint(start, size, cellSize, half, _start);
  const offset =
    Math.hypot(startCenter.x - startPoint.x, startCenter.z - startPoint.z) > 0.1 ? 1 : 0;
  let length = offset;
  for (let cursor = goal; cursor !== start && cursor >= 0; cursor = parent[cursor] ?? -1) {
    length += 1;
  }
  if (canReachExactEnd) length += 1;
  _route.length = length;
  if (offset === 1) _route[0] = routePoint(startCenter.x, startCenter.z);
  // The chain's last cell is the one adjacent to the start, and `offset` claims index 0 for the
  // start-centre prefix when the unit is not already standing on its cell. So the chain is written
  // from its own last slot downwards, stopping above whatever the prefix and the exact end own.
  let index = length - (canReachExactEnd ? 1 : 0) - 1;
  for (let cursor = goal; cursor !== start && cursor >= 0; cursor = parent[cursor] ?? -1) {
    const p = cellPoint(cursor, size, cellSize, half, _candidate);
    _route[index] = routePoint(p.x, p.z);
    index -= 1;
    if (index < offset) break;
  }
  if (canReachExactEnd) _route[length - 1] = routePoint(endPoint.x, endPoint.z);
  return _route;
}
