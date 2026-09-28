/** Ground navigation, separate flight layer and safe production exits. */

import type { Game } from "./game.js";
import { HALF, waterBlocked } from "./terrain.js";
import {
  type EntityType,
  type IEntity,
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
  const distance = Math.hypot(x - entity.x, z - entity.z);
  if (distance <= stop + 0.2) {
    entity.moving = false;
    return true;
  }
  const speed = TYPES[entity.type].speed ?? 0;
  if (entity.air) {
    const dx = x - entity.x;
    const dz = z - entity.z;
    const step = Math.min(speed * dt, Math.max(0, distance - stop));
    entity.x = clamp(entity.x + (dx / distance) * step, -HALF + entity.r + 1, HALF - entity.r - 1);
    entity.z = clamp(entity.z + (dz / distance) * step, -HALF + entity.r + 1, HALF - entity.r - 1);
    entity.angle = Math.atan2(dx, dz);
    entity.moving = step > 0;
    return Math.hypot(x - entity.x, z - entity.z) <= stop + 0.2;
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
  const dd = Math.hypot(dx, dz);
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

export function separateEntities(game: Game, dt: number): void {
  const units = game.entities.filter((e) => !e.building && !e.garrisonId && e.hp > 0);
  const solids = [...game.obstacles, ...game.entities.filter((e) => e.building && e.hp > 0)];
  for (let i = 0; i < units.length; i++) {
    const a = units[i];
    if (!a) continue;
    const old = { x: a.x, z: a.z };
    for (let j = i + 1; j < units.length; j++) {
      const b = units[j];
      if (!b) continue;
      if (!!a.air !== !!b.air) continue;
      let dx = a.x - b.x;
      let dz = a.z - b.z;
      let d = Math.hypot(dx, dz);
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
      for (const o of solids) {
        let dx = a.x - o.x;
        let dz = a.z - o.z;
        let d = Math.hypot(dx, dz);
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
        !waterBlocked(old.x, old.z, game.pools, a.r * 0.7)
      ) {
        a.x = old.x;
        a.z = old.z;
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
  const key = `${target.id}:${range}:${game.navRevision}`;
  let cached = unit.interactionGoal;
  if (!cached || cached.key !== key || (!cached.point && game.time >= cached.retryAt)) {
    const angle = Math.atan2(unit.z - target.z, unit.x - target.x);
    const radius = range - 0.35;
    const points = Array.from({ length: 24 }, (_, i) => {
      const a = angle + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 12);
      return { x: target.x + Math.cos(a) * radius, z: target.z + Math.sin(a) * radius };
    }).filter((p) => !game.blocked(p.x, p.z, unit.r));
    let point: IPoint | null = null;
    for (const p of points) {
      if (game.lineClear(unit, p, unit.r)) {
        point = p;
        break;
      }
      const route = game.pathfind(unit, p, unit.r);
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
      if (end && dist(end, p) < 0.35 && walked) {
        point = p;
        break;
      }
    }
    cached = { key, point, retryAt: game.time + 1.5 };
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
