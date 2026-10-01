/** Ground navigation, separate flight layer and safe production exits. */

import type { Game } from "./game.js";
import { HALF, waterBlocked } from "./terrain.js";
import {
  type EntityType,
  type IEntity,
  type IObstacle,
  type IPoint,
  type IResourceNode,
  TYPES,
  clamp,
  dist,
} from "./types.js";

export function clearMovement(entity: IEntity): void {
  entity.path = [];
  entity.pathClock = 0;
  entity.pathGoal = null;
  entity.pathEnd = null;
  entity.pathAdjusted = false;
}

/** Steps toward `(x, z)` on the ground layer. Returns true once the stop radius is reached. */
export function travelEntity(
  game: Game,
  entity: IEntity,
  x: number,
  z: number,
  dt: number,
  stop = 0.5,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(dt) || dt <= 0) return false;
  const toX = x - entity.x;
  const toZ = z - entity.z;
  const distance = Math.sqrt(toX * toX + toZ * toZ);
  if (distance <= stop + 0.2) {
    entity.moving = false;
    return true;
  }
  const speed = TYPES[entity.type].speed ?? 0;
  if (entity.air) {
    const dx = toX;
    const dz = toZ;
    const step = Math.min(speed * dt, Math.max(0, distance - stop));
    entity.x = clamp(entity.x + (dx / distance) * step, -HALF + entity.r + 1, HALF - entity.r - 1);
    entity.z = clamp(entity.z + (dz / distance) * step, -HALF + entity.r + 1, HALF - entity.r - 1);
    entity.angle = Math.atan2(dx, dz);
    entity.moving = step > 0;
    const left = x - entity.x;
    const near = z - entity.z;
    return Math.sqrt(left * left + near * near) <= stop + 0.2;
  }
  let dest: IPoint = { x, z };
  if (stop > 1) {
    dest = {
      x: x + ((entity.x - x) / distance) * stop * 0.98,
      z: z + ((entity.z - z) / distance) * stop * 0.98,
    };
  }
  const changed = !entity.pathGoal || dist(dest, entity.pathGoal) > 2.5;
  const revisionChanged = entity.pathRevision !== game.navRevision;
  if (
    entity.pathAdjusted &&
    entity.pathEnd &&
    !changed &&
    !revisionChanged &&
    dist(entity, entity.pathEnd) < 0.75
  ) {
    entity.moving = false;
    return true;
  }
  if (revisionChanged || changed || (!entity.path.length && entity.pathClock <= 0)) {
    entity.pathGoal = dest;
    entity.pathRevision = game.navRevision;
    entity.path = game.lineClear(entity, dest, entity.r)
      ? [dest]
      : game.pathfind(entity, dest, entity.r);
    const last = entity.path[entity.path.length - 1];
    entity.pathEnd = last ? { ...last } : null;
    entity.pathAdjusted = !!entity.pathEnd && dist(dest, entity.pathEnd) > 0.4;
    entity.pathClock = entity.path.length ? 0.4 : 1.25;
  }
  if (!entity.path.length) {
    entity.moving = false;
    return false;
  }
  while (entity.path.length > 1) {
    const head = entity.path[0];
    if (!head || dist(entity, head) >= 0.3) break;
    entity.path.shift();
  }
  const p = entity.path[0];
  if (!p) return false;
  const dx = p.x - entity.x;
  const dz = p.z - entity.z;
  const dd = Math.sqrt(dx * dx + dz * dz);
  if (dd < 0.3) {
    entity.path.shift();
    return entity.pathAdjusted || distance <= stop + 0.4;
  }
  const move = Math.min(speed * dt, dd);
  const nx = entity.x + (dx / dd) * move;
  const nz = entity.z + (dz / dd) * move;
  if (game.blocked(nx, nz, entity.r) && !game.blocked(entity.x, entity.z, entity.r)) {
    entity.path = [];
    entity.pathClock = 0.35;
    entity.moving = false;
    return false;
  }
  entity.x = nx;
  entity.z = nz;
  entity.angle = Math.atan2(dx, dz);
  entity.moving = true;
  return false;
}

/** The first free spot around a producer that a freshly trained unit can stand on. */
export function spawnExit(
  game: Game,
  building: IEntity,
  type: EntityType = "worker",
): IPoint | null {
  const d = TYPES[type];
  for (let ring = 0; ring < 5; ring++) {
    for (let i = 0; i < 32; i++) {
      const angle = Math.PI * 0.5 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 16);
      const radius = building.r + d.r + 1.25 + ring * 2;
      const p = {
        x: building.x + Math.cos(angle) * radius,
        z: building.z + Math.sin(angle) * radius,
      };
      if (Math.abs(p.x) > HALF - d.r - 1 || Math.abs(p.z) > HALF - d.r - 1) continue;
      if (!d.air && game.blocked(p.x, p.z, d.r)) continue;
      if (
        game.entities.some(
          (u) =>
            !u.building &&
            !u.garrisonId &&
            u.hp > 0 &&
            !!u.air === !!d.air &&
            dist(u, p) < u.r + d.r + 0.12,
        )
      )
        continue;
      return p;
    }
  }
  return null;
}

/** The perimeter candidate `approachInteraction` is testing, reused so the ring costs no objects. */
const _candidate: IPoint = { x: 0, z: 0 };

/** Reused by `separateEntities`, which runs every step: the buffers are the whole reason it is free. */
const _units: IEntity[] = [];
const _solids: (IEntity | IObstacle)[] = [];

export function separateEntities(game: Game, dt: number): void {
  _units.length = 0;
  _solids.length = 0;
  const entities = game.entities;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    if (entity === undefined || entity.hp <= 0) continue;
    if (entity.building) _solids.push(entity);
    else if (!entity.garrisonId) _units.push(entity);
  }
  for (let i = 0; i < game.obstacles.length; i++) {
    const o = game.obstacles[i];
    if (o !== undefined) _solids.push(o);
  }
  const units = _units;
  const solids = _solids;
  for (let i = 0; i < units.length; i++) {
    const a = units[i];
    if (!a) continue;
    // The pre-push position, as two numbers: the water rollback below is the only reader, and a
    // point object per unit per step is sixty objects a frame for a value read once.
    const oldX = a.x;
    const oldZ = a.z;
    for (let j = i + 1; j < units.length; j++) {
      const b = units[j];
      if (!b) continue;
      if (!!a.air !== !!b.air) continue;
      let dx = a.x - b.x;
      let dz = a.z - b.z;
      let d = Math.sqrt(dx * dx + dz * dz);
      const min = (a.r + b.r) * 0.83;
      if (d >= min) continue;
      if (d < 0.0001) {
        const angle = (a.id * 2.399963 + b.id * 0.741) % 6.283185;
        dx = Math.cos(angle) * 0.001;
        dz = Math.sin(angle) * 0.001;
        d = 0.001;
      }
      const push = (min - d) * Math.min(0.5, dt * 5);
      a.x += (dx / d) * push;
      a.z += (dz / d) * push;
      b.x -= (dx / d) * push;
      b.z -= (dz / d) * push;
    }
    if (!a.air) {
      for (let s = 0; s < solids.length; s++) {
        const o = solids[s];
        if (o === undefined) continue;
        let dx = a.x - o.x;
        let dz = a.z - o.z;
        let d = Math.sqrt(dx * dx + dz * dz);
        const min = o.r + a.r + 0.035;
        if (d >= min) continue;
        if (d < 0.0001) {
          const angle = a.id * 2.399963;
          dx = Math.cos(angle) * 0.001;
          dz = Math.sin(angle) * 0.001;
          d = 0.001;
        }
        a.x = o.x + (dx / d) * min;
        a.z = o.z + (dz / d) * min;
      }
      if (
        waterBlocked(a.x, a.z, game.pools, a.r * 0.7) &&
        !waterBlocked(oldX, oldZ, game.pools, a.r * 0.7)
      ) {
        a.x = oldX;
        a.z = oldZ;
      }
    }
    a.x = clamp(a.x, -HALF + a.r + 1, HALF - a.r - 1);
    a.z = clamp(a.z, -HALF + a.r + 1, HALF - a.r - 1);
  }
}

/** Reach a usable side of a resource or drop-off, rather than a blocked radial goal.
 * Cache the chosen perimeter while travelling; impossible sites retry slowly.
 */
export function approachInteraction(
  game: Game,
  unit: IEntity,
  target: IEntity | IResourceNode,
  range: number,
  dt: number,
): boolean {
  if (dist(unit, target) <= range) {
    unit.moving = false;
    return true;
  }
  // The cache key is three numbers compared in place, not a template string: this runs for every
  // harvesting worker, every step, and a key is a fresh string each time.
  let cached = unit.interactionGoal;
  if (
    !cached ||
    cached.targetId !== target.id ||
    cached.range !== range ||
    cached.revision !== game.navRevision ||
    (!cached.point && game.time >= cached.retryAt)
  ) {
    const angle = Math.atan2(unit.z - target.z, unit.x - target.x);
    const radius = range - 0.35;
    // The candidate ring, in place: `Array.from(...).filter()` was 25 objects and an array per
    // worker per step to walk a ring this loop walks anyway. An unreachable site still caches as
    // no point, exactly as the filtered ring did.
    let point: IPoint | null = null;
    for (let i = 0; i < 24 && point === null; i++) {
      const a = angle + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 12);
      _candidate.x = target.x + Math.cos(a) * radius;
      _candidate.z = target.z + Math.sin(a) * radius;
      if (game.blocked(_candidate.x, _candidate.z, unit.r)) continue;
      if (game.lineClear(unit, _candidate, unit.r)) {
        point = { x: _candidate.x, z: _candidate.z };
        break;
      }
      const route = game.pathfind(unit, _candidate, unit.r);
      const end = route[route.length - 1];
      let walked = true;
      let previous: IPoint = unit;
      for (const step of route) {
        if (!game.lineClear(previous, step, unit.r)) {
          walked = false;
          break;
        }
        previous = step;
      }
      if (end && dist(end, _candidate) < 0.35 && walked) {
        point = { x: _candidate.x, z: _candidate.z };
        break;
      }
    }
    cached = {
      point,
      range,
      retryAt: game.time + 1.5,
      revision: game.navRevision,
      targetId: target.id,
    };
    unit.interactionGoal = cached;
    clearMovement(unit);
  }
  if (!cached.point) {
    unit.moving = false;
    return false;
  }
  game.travel(unit, cached.point.x, cached.point.z, dt, 0.18);
  return dist(unit, target) <= range;
}
