/** Garrisoned infantry, air/ground target masks, bunker fire and non-damaging support actions. */

import { abandonConstruction, releaseBuilder } from "./construction.js";
import type { Game } from "./game.js";
import { clearMovement } from "./movement.js";
import {
  IDLE_ORDER,
  type IEntity,
  type IOrderResult,
  type IUnitDef,
  TYPES,
  dist,
  planeDistance,
} from "./types.js";

export function garrisonCheck(game: Game, unit: IEntity, bunker: IEntity | undefined): boolean {
  if (
    !bunker ||
    bunker.type !== "bunker" ||
    !bunker.built ||
    bunker.hp <= 0 ||
    unit.type !== "ranger" ||
    unit.team !== bunker.team ||
    unit.garrisonId
  ) {
    return false;
  }
  const entities = game.entities;
  let assigned = 0;
  for (let i = 0; i < entities.length; i++) {
    const u = entities[i];
    if (u === undefined || u.hp <= 0 || u.id === unit.id) continue;
    if (u.garrisonId === bunker.id || (u.order.kind === "garrison" && u.order.id === bunker.id))
      assigned += 1;
  }
  return assigned < (TYPES.bunker.capacity ?? 0);
}

export function updateGarrisonArrival(game: Game, unit: IEntity, dt: number): void {
  if (unit.order.kind !== "garrison") return;
  const bunker = game.get(unit.order.id);
  if (!bunker || !bunker.built || bunker.team !== unit.team || bunker.type !== "bunker") {
    unit.order = IDLE_ORDER;
    clearMovement(unit);
    return;
  }
  if (bunker.garrison.length >= (TYPES.bunker.capacity ?? 0)) {
    unit.order = IDLE_ORDER;
    return;
  }
  if (!game.travel(unit, bunker.x, bunker.z, dt, bunker.r + unit.r + 1.0)) return;
  // Collision/nav fallback must not allow entry from across an impassable wall.
  if (dist(unit, bunker) > bunker.r + unit.r + 1.6) return;
  if (!bunker.garrison.includes(unit.id)) bunker.garrison.push(unit.id);
  unit.garrisonId = bunker.id;
  unit.x = bunker.x;
  unit.z = bunker.z;
  unit.moving = false;
  unit.order = { kind: "garrisoned", id: bunker.id };
  unit.orders = [];
  unit.targetId = null;
  clearMovement(unit);
  game.emit("garrison", { id: bunker.id, unitId: unit.id, team: unit.team });
}

export function unloadGarrison(
  game: Game,
  id: number,
  team = 0,
  destruction = false,
  attacker?: number,
): IOrderResult {
  const bunker = destruction ? game.entities.find((e) => e.id === id) : game.get(id);
  if (
    !bunker ||
    bunker.type !== "bunker" ||
    bunker.team !== team ||
    !bunker.built ||
    (!destruction && (game.paused || game.result))
  ) {
    return { ok: false, message: "Select your completed bunker." };
  }
  let count = 0;
  for (const unitId of [...bunker.garrison]) {
    const unit = game.get(unitId);
    if (!unit) {
      bunker.garrison = bunker.garrison.filter((n) => n !== unitId);
      continue;
    }
    const point = game.spawnPoint(bunker, unit.type);
    if (!point && !destruction) continue;
    bunker.garrison = bunker.garrison.filter((n) => n !== unitId);
    unit.garrisonId = null;
    unit.order = { kind: "hold" };
    unit.orders = [];
    clearMovement(unit);
    if (point) {
      unit.x = point.x;
      unit.z = point.z;
    }
    if (destruction) game.damage(unit, point ? unit.maxHp * 0.35 : unit.hp, attacker);
    count++;
  }
  if (count) {
    game.emit("unload", { id: bunker.id, count, team: bunker.team, destruction });
  }
  return { ok: count > 0, count, message: count ? "" : "No clear exit or no infantry inside." };
}

export function removeGarrisonOccupant(game: Game, unit: IEntity): void {
  if (!unit.garrisonId) return;
  const bunker = game.get(unit.garrisonId);
  if (bunker) bunker.garrison = bunker.garrison.filter((id) => id !== unit.id);
  unit.garrisonId = null;
}

/** A bunker's gun is only as strong as the infantry inside it. */
export function weaponProfile(game: Game, unit: IEntity): IUnitDef {
  const d = TYPES[unit.type];
  if (unit.type !== "bunker") return d;
  // Counted in place over the bunker's own roster: `map().filter()` was two arrays per bunker per
  // frame to learn a length, and the roster is the shorter of the two lists anyway.
  let occupants = 0;
  for (let i = 0; i < unit.garrison.length; i++) {
    const occupant = game.get(unit.garrison[i] ?? -1);
    if (occupant && occupant.garrisonId === unit.id) occupants += 1;
  }
  // The profile belongs to the bunker, not to the call: `engage` holds one while `canAttackTarget`
  // asks again for the same unit, so a fresh spread per query would be a shared object racing
  // itself. Copied once per bunker, then the damage is written in place.
  if (!unit.profile) unit.profile = { ...d };
  const profile = unit.profile;
  profile.damage = occupants * (TYPES.ranger.damage ?? 0);
  return profile;
}

/** Hoisted: `canAttackTarget` runs once per unit per candidate, and a literal mask is an array. */
const GROUND_ONLY: readonly string[] = ["ground"];

export function canAttackTarget(
  game: Game,
  attacker: IEntity | undefined,
  target: IEntity | undefined,
): boolean {
  if (
    !attacker ||
    !target ||
    attacker.hp <= 0 ||
    target.hp <= 0 ||
    attacker.garrisonId ||
    target.garrisonId ||
    attacker.team === target.team ||
    !attacker.built
  ) {
    return false;
  }
  const d = weaponProfile(game, attacker);
  return !!d.damage && (d.targets ?? GROUND_ONLY).includes(target.air ? "air" : "ground");
}

/** Picks a target, shoots it, and closes on anything in range it cannot reach. */
export function engage(game: Game, unit: IEntity, dt: number, hold = false): boolean {
  const d = weaponProfile(game, unit);
  if (!d.damage || unit.garrisonId) {
    unit.targetId = null;
    return false;
  }
  const range = d.range ?? 0;
  const ordered = unit.order.kind === "attack" ? game.get(unit.order.id) : undefined;
  let target: IEntity | null =
    ordered &&
    canAttackTarget(game, unit, ordered) &&
    game.visibleAt(ordered.x, ordered.z, unit.team)
      ? ordered
      : null;
  if (!target) {
    let best = Number.POSITIVE_INFINITY;
    for (const other of game.entities) {
      if (!canAttackTarget(game, unit, other)) continue;
      const dd = dist(unit, other) - other.r;
      if (dd > (hold ? range : d.sight) || !game.visibleAt(other.x, other.z, unit.team)) continue;
      // An actionable target must beat an out-of-range 'preferred' target.
      const score =
        dd -
        (dd <= range ? 100 : 0) +
        (other.building ? 4 : 0) +
        (other.type === "worker" ? 1 : 0) +
        (other.hp / other.maxHp) * 1.5 -
        (other.air && d.airDamage ? 3 : 0);
      if (score < best) {
        best = score;
        target = other;
      }
    }
  }
  if (!target) {
    unit.targetId = null;
    if (unit.order.kind === "attack") unit.order = IDLE_ORDER;
    return false;
  }
  unit.targetId = target.id;
  const distance = dist(unit, target);
  if (distance <= range + target.r) {
    unit.angle = Math.atan2(target.x - unit.x, target.z - unit.z);
    unit.path.length = 0;
    unit.moving = false;
    if (unit.cooldown <= 0) {
      unit.cooldown = d.rate ?? 0;
      unit.flash = 0.14;
      const y = unit.air
        ? unit.altitude + 0.4
        : unit.building
          ? 2.5
          : unit.type === "tank"
            ? 1.8
            : 1.4;
      const ty = target.air ? target.altitude + 0.4 : target.building ? 2 : 1.1;
      game.emit("shot", {
        id: unit.id,
        x: unit.x,
        z: unit.z,
        y,
        tx: target.x,
        tz: target.z,
        ty,
        team: unit.team,
        unit: unit.type,
        targetId: target.id,
        style: d.shot || "tracer",
      });
      const impactX = target.x;
      const impactZ = target.z;
      const impactAir = !!target.air;
      game.damage(target, target.air && d.airDamage ? d.airDamage : d.damage, unit.team);
      if (d.splash) {
        // Over the length captured now: a splash kill only marks an entity dead, and the dead are
        // pruned after the step, so the list is the same one the copied array used to be.
        const entities = game.entities;
        const visited = entities.length;
        for (let i = 0; i < visited; i++) {
          const other = entities[i];
          if (
            other === undefined ||
            other.id === target.id ||
            !canAttackTarget(game, unit, other) ||
            !!other.air !== impactAir
          ) {
            continue;
          }
          if (planeDistance(other.x, other.z, impactX, impactZ) < d.splash)
            game.damage(other, d.damage * 0.45, unit.team);
        }
      }
    }
    return true;
  }
  if (!hold && !unit.building && unit.type !== "worker") {
    game.travel(unit, target.x, target.z, dt, range * 0.85 + target.r);
    return true;
  }
  return false;
}

export function updateSupport(game: Game, unit: IEntity, dt: number, hold = false): boolean {
  const d = TYPES[unit.type];
  const heal = d.heal;
  if (!heal) return false;
  const healRange = d.healRange ?? 0;
  const eligible = (e: IEntity | null | undefined): e is IEntity =>
    !!e &&
    e.id !== unit.id &&
    e.team === unit.team &&
    e.hp > 0 &&
    !e.air &&
    !e.building &&
    !e.garrisonId &&
    e.hp < e.maxHp - 0.001;
  const ordered =
    unit.order.kind === "heal" || unit.order.kind === "follow" ? game.get(unit.order.id) : null;
  const follow =
    !!ordered && ordered.team === unit.team && !ordered.garrisonId && !ordered.building;
  let target = eligible(ordered) ? ordered : null;
  if (!target) {
    // The same pick the sort made — lowest health fraction, then nearest — found in one pass, so a
    // medic costs no arrays. `own()` deliberately is not used: it filters the dead out first.
    const reach = hold ? healRange : (d.sight ?? 0);
    const entities = game.entities;
    let best = Number.POSITIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e === undefined || !eligible(e)) continue;
      const away = dist(e, unit);
      if (away >= reach) continue;
      const hurt = e.hp / e.maxHp;
      if (hurt > best) continue;
      if (hurt < best) {
        best = hurt;
        bestDistance = away;
        target = e;
        continue;
      }
      if (away < bestDistance) {
        bestDistance = away;
        target = e;
      }
    }
  }
  unit.healTargetId = target?.id ?? null;
  unit.targetId = null;
  if (target) {
    if (dist(unit, target) <= healRange + target.r) {
      const amount = Math.min(target.maxHp - target.hp, heal * dt);
      target.hp = Math.min(target.maxHp, target.hp + amount);
      if (target.maxHp - target.hp < 0.001) target.hp = target.maxHp;
      unit.angle = Math.atan2(target.x - unit.x, target.z - unit.z);
      unit.healFxClock -= dt;
      if (unit.healFxClock <= 0) {
        unit.healFxClock = 0.2;
        game.emit("heal", { x: unit.x, z: unit.z, tx: target.x, tz: target.z, team: unit.team });
      }
      return true;
    }
    if (!hold) {
      game.travel(unit, target.x, target.z, dt, healRange * 0.75);
      return true;
    }
  }
  if (follow && ordered) {
    if (dist(unit, ordered) > 4) game.travel(unit, ordered.x, ordered.z, dt, 3.5);
    return true;
  }
  if (unit.order.kind === "heal" || unit.order.kind === "follow") unit.order = IDLE_ORDER;
  return false;
}

export function updateRepair(game: Game, worker: IEntity, dt: number): void {
  if (worker.order.kind !== "repair") return;
  const target = game.get(worker.order.id);
  if (
    !target ||
    !target.building ||
    !target.built ||
    target.team !== worker.team ||
    target.hp >= target.maxHp - 0.001
  ) {
    worker.order = IDLE_ORDER;
    return;
  }
  if (
    !game.travel(worker, target.x, target.z, dt, target.r + 1.6) ||
    dist(worker, target) > target.r + 2.3
  ) {
    return;
  }
  const player = game.players[worker.team];
  if (!player) return;
  const amount = Math.min(target.maxHp - target.hp, 20 * dt, player.resources.ore * 5);
  if (amount <= 0) return;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  if (target.maxHp - target.hp < 0.001) target.hp = target.maxHp;
  player.resources.ore -= amount / 5;
  player.spent.ore += amount / 5;
  worker.angle = Math.atan2(target.x - worker.x, target.z - worker.z);
  worker.repairClock -= dt;
  if (worker.repairClock <= 0) {
    worker.repairClock = 0.16;
    game.emit("weld", {
      x: worker.x,
      z: worker.z,
      tx: target.x + (worker.x - target.x) * 0.7,
      tz: target.z + (worker.z - target.z) * 0.7,
      height: 1.5,
      team: worker.team,
      repair: true,
    });
  }
}

export function applyDamage(
  game: Game,
  entity: IEntity,
  amount: number,
  attacker: number | undefined,
): void {
  if (!entity || entity.hp <= 0 || !Number.isFinite(amount) || amount <= 0) return;
  entity.hp = Math.max(0, entity.hp - amount);
  entity.hitFlash = 0.2;
  entity.lastDamaged = game.time;
  if (entity.hp > 0) return;
  if (entity.garrisonId) removeGarrisonOccupant(game, entity);
  if (entity.type === "bunker") unloadGarrison(game, entity.id, entity.team, true, attacker);
  if (entity.order.kind === "construct") {
    abandonConstruction(game, game.get(entity.order.id), "Surveyor destroyed");
  }
  if (entity.building && !entity.built) releaseBuilder(game, entity, true);
  if (entity.team > 0 && attacker === 0) game.kills++;
  if (entity.team === 0) game.losses++;
  if (entity.building) game.navRevision++;
  game.emit("death", {
    id: entity.id,
    x: entity.x,
    z: entity.z,
    building: entity.building,
    team: entity.team,
    typeName: entity.type,
    altitude: entity.altitude || 0,
  });
}
