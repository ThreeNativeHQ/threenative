/** Binary-heap A*, sized from the map rather than hard-coded to the original map. */

import type { Game } from "./game.js";
import type { IPoint } from "./types.js";

interface IHeapNode {
  id: number;
  f: number;
}

const ORTHOGONAL: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function findRoute(
  game: Game,
  startPoint: IPoint,
  endPoint: IPoint,
  radius = 0.8,
): IPoint[] {
  const size = game.gridSize;
  const cell = game.cell;
  const half = game.worldSize / 2;
  const to = (v: number): number => Math.max(0, Math.min(size - 1, Math.floor((v + half) / cell)));
  const point = (i: number): IPoint => ({
    x: (i % size) * cell - half + cell / 2,
    z: Math.floor(i / size) * cell - half + cell / 2,
  });
  const category = radius > 0.9 ? 1.25 : 0.8;
  const key = `${game.navRevision}:${category}`;
  const masks = game.navMasks;
  if (!masks.has(key)) {
    const mask = new Uint8Array(size * size);
    for (let i = 0; i < mask.length; i++) {
      const p = point(i);
      mask[i] = game.blocked(p.x, p.z, category) ? 1 : 0;
    }
    if (masks.size > 4) masks.clear();
    masks.set(key, mask);
  }
  const mask = masks.get(key);
  if (!mask) return [];

  // World-space positions on a building edge can be valid even when their
  // coarse grid cell is blocked. Connect to a visible free cell at BOTH ends.
  const hasExit = (id: number): boolean => {
    const x = id % size;
    const z = Math.floor(id / size);
    for (const [dx, dz] of ORTHOGONAL) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx > 0 && nz > 0 && nx < size - 1 && nz < size - 1 && !mask[nz * size + nx]) return true;
    }
    return false;
  };

  const connector = (position: IPoint, requireClear: boolean): number => {
    const raw = to(position.z) * size + to(position.x);
    const center = point(raw);
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
        const p = point(id);
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
  if (start < 0 || goal < 0) return [];

  const costs = new Float32Array(size * size).fill(Number.POSITIVE_INFINITY);
  const parent = new Int32Array(size * size).fill(-1);
  const closed = new Uint8Array(size * size);
  const heap: IHeapNode[] = [];
  const h = (i: number): number => {
    const dx = Math.abs((i % size) - (goal % size));
    const dz = Math.abs(Math.floor(i / size) - Math.floor(goal / size));
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  const push = (id: number, f: number): void => {
    let i = heap.length;
    heap.push({ id, f });
    while (i) {
      const p = (i - 1) >> 1;
      const up = heap[p];
      if (!up || up.f <= f) break;
      heap[i] = up;
      i = p;
    }
    heap[i] = { id, f };
  };
  const pop = (): number => {
    const root = heap[0];
    const last = heap.pop();
    if (!root) return -1;
    if (last && heap.length > 0) {
      let i = 0;
      while (true) {
        let c = i * 2 + 1;
        if (c >= heap.length) break;
        const left = heap[c];
        const right = heap[c + 1];
        if (left && right && right.f < left.f) c++;
        const child = heap[c];
        if (!child || child.f >= last.f) break;
        heap[i] = child;
        i = c;
      }
      heap[i] = last;
    }
    return root.id;
  };

  costs[start] = 0;
  push(start, h(start));
  let found = false;
  for (let loops = 0; heap.length > 0 && loops < size * size * 2; loops++) {
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
  if (!found) return [];
  const path: IPoint[] = [];
  for (let cursor = goal; cursor !== start && cursor >= 0; cursor = parent[cursor] ?? -1) {
    path.push(point(cursor));
  }
  path.reverse();
  const startCenter = point(start);
  if (Math.hypot(startCenter.x - startPoint.x, startCenter.z - startPoint.z) > 0.1) {
    path.unshift(startCenter);
  }
  if (canReachExactEnd) path.push({ ...endPoint });
  return path;
}
