/** Builder/site ownership and lifecycle. Every faction uses these same rules. */

import { canAfford, pay } from "./economy.js";
import type { Game } from "./game.js";
import { HALF, onBridge, waterBlocked } from "./terrain.js";
import {
  type BuildingType,
  type EntityType,
  type ICommandTarget,
  IDLE_ORDER,
  type IEntity,
  type IGameEvent,
  type IOrderResult,
  type IPoint,
  type Order,
  TYPES,
  dist,
} from "./types.js";

/** The nearest idle Surveyor, or the one named by the order. A builder owns one site at a time. */
export function availableBuilder(
  game: Game,
  x: number,
  z: number,
  team: number,
  builderId: number | null = null,
): IEntity | null {
  const eligible = (w: IEntity | undefined): w is IEntity =>
    !!w &&
    w.team === team &&
    w.type === "worker" &&
    w.hp > 0 &&
    !w.garrisonId &&
    w.order.kind !== "construct";
  if (builderId !== null && builderId !== undefined) {
    const worker = game.get(builderId);
    return eligible(worker) ? worker : null;
  }
  return (
    game
      .own(team)
      .filter(eligible)
      .sort(
        (a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z) || a.id - b.id,
      )[0] ?? null
  );
}

/**
 * A perimeter candidate, reused so the ring below costs no objects. Nothing holds it: the loop
 * tests each candidate and copies the accepted one's two numbers into the worker's own point.
 */
const _workCandidate: IPoint = { x: 0, z: 0 };

/**
 * The events this file emits, filled one field at a time. `Game.emit` copies a payload into the
 * queue slot before it returns, so these are never retained and one of each is enough — a weld
 * fires on a construction tick for every site in the game, which is ordinary play, not an event.
 */
const weldEvent: Partial<IGameEvent> = {};
const lostEvent: Partial<IGameEvent> = {};
const buildEvent: Partial<IGameEvent> = {};
const doneEvent: Partial<IGameEvent> = {};

/** A one-element id list and one order target for the resumes this file issues. */
const _one: number[] = [0];
const _target: ICommandTarget = { id: 0 };
/** Nobody here reads the answer to a resume, so it is written into a record nobody keeps. */
const _result: IOrderResult = { ok: false, count: 0 };

export function constructionWorkPoint(
  game: Game,
  worker: IEntity,
  x: number,
  z: number,
  radius: number,
): IPoint | null {
  const angle = Math.atan2(worker.z - z, worker.x - x);
  // The same ring `approachInteraction` walks, in place: `Array.from(...).filter()` was 24 point
  // objects and two arrays per builder per build start to test a ring this loop walks anyway.
  for (let i = 0; i < 24; i++) {
    const a = angle + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 12);
    _workCandidate.x = x + Math.cos(a) * (radius + worker.r + 0.9);
    _workCandidate.z = z + Math.sin(a) * (radius + worker.r + 0.9);
    if (game.blocked(_workCandidate.x, _workCandidate.z, worker.r)) continue;
    if (game.lineClear(worker, _workCandidate, worker.r)) return _workCandidate;
    const route = game.pathfind(worker, _workCandidate, worker.r);
    const end = route[route.length - 1];
    if (end && dist(end, _workCandidate) < 0.35) return _workCandidate;
  }
  return null;
}

export function beginConstruction(
  game: Game,
  type: BuildingType,
  x: number,
  z: number,
  team = 0,
  builderId: number | null = null,
): IOrderResult {
  if (game.result || game.paused) return { ok: false, message: "The operation is not running." };
  let siteX = x;
  let siteZ = z;
  if (type === "refinery" && Number.isFinite(x) && Number.isFinite(z)) {
    const vent = game.nodes
      .filter((n) => n.kind === "gas" && n.amount > 0)
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    if (vent && Math.hypot(vent.x - x, vent.z - z) < 5) {
      siteX = vent.x;
      siteZ = vent.z;
    }
  }
  const check = buildCheck(game, type, siteX, siteZ, team);
  if (!check.ok) return check;
  const worker = availableBuilder(game, siteX, siteZ, team, builderId);
  if (!worker) {
    return {
      ok: false,
      message: "An available friendly Surveyor is required. Builders cannot work on two sites.",
    };
  }
  if (!canAfford(game, type, team)) return { ok: false, message: "Insufficient minerals or gas." };
  const point = constructionWorkPoint(game, worker, siteX, siteZ, TYPES[type].r);
  if (!point) {
    return {
      ok: false,
      message: "The Surveyor cannot reach this site. Clear a route or choose another location.",
    };
  }
  const resume: Order = worker.order.kind === "gather" ? { ...worker.order } : IDLE_ORDER;
  pay(game, type, team);
  const site = game.spawn(type, team, siteX, siteZ, false);
  Object.assign(site, {
    builderId: worker.id,
    // The site's own `workPoint`, not the ring's shared candidate: a site holds this until it is
    // built or abandoned, and two sites started in the same step would otherwise share one point.
    workPoint: { x: point.x, z: point.z },
    constructionStarted: false,
    resumeOrder: resume,
    createdAt: game.time,
    weldClock: 0,
  });
  worker.order = { kind: "construct", id: site.id };
  worker.orders.length = 0;
  worker.path.length = 0;
  worker.pathGoal = null;
  worker.pathClock = 0;
  worker.targetId = null;
  buildEvent.id = site.id;
  buildEvent.builderId = worker.id;
  buildEvent.x = siteX;
  buildEvent.z = siteZ;
  buildEvent.team = team;
  game.emit("build", buildEvent);
  return { ok: true, id: site.id, builderId: worker.id };
}

export function releaseBuilder(game: Game, site: IEntity, resume = true): void {
  const worker = site.builderId === null ? undefined : game.get(site.builderId);
  site.builderId = null;
  if (!worker || worker.order.kind !== "construct" || worker.order.id !== site.id) return;
  worker.working = false;
  worker.order = IDLE_ORDER;
  worker.path.length = 0;
  worker.pathClock = 0;
  if (resume && !worker.orders.length && site.resumeOrder.kind === "gather") {
    // The id and the target are the commander's own to hand over: `command` reads both before it
    // returns and keeps neither, and this runs on ordinary construction steps.
    _one[0] = worker.id;
    _target.id = site.resumeOrder.id;
    game.command(_one, "gather", _target, worker.team, false, _result);
  }
}

export function abandonConstruction(
  game: Game,
  site: IEntity | undefined,
  reason = "Surveyor left the site",
  refund = 0,
  resume = false,
): boolean {
  if (!site || site.built || site.hp <= 0) return false;
  site.hp = 0;
  game.navRevision++;
  if (refund > 0) {
    const bank = game.players[site.team];
    if (bank) {
      const d = TYPES[site.type];
      for (const resource of ["ore", "gas"] as const) {
        const amount = d[resource] * refund;
        bank.resources[resource] += amount;
        bank.spent[resource] -= amount;
      }
    }
  }
  releaseBuilder(game, site, resume);
  lostEvent.id = site.id;
  lostEvent.x = site.x;
  lostEvent.z = site.z;
  lostEvent.team = site.team;
  lostEvent.name = TYPES[site.type].name;
  lostEvent.reason = reason;
  lostEvent.refund = refund;
  game.emit("constructionLost", lostEvent);
  return true;
}

export function cancelConstruction(game: Game, id: number, team = 0): IOrderResult {
  const site = game.get(id);
  if (game.paused || game.result || !site || site.team !== team || !site.building || site.built) {
    return { ok: false, message: "Select your unfinished structure." };
  }
  abandonConstruction(game, site, "Construction cancelled", 0.75, true);
  return { ok: true };
}

export function updateBuilder(game: Game, worker: IEntity, dt: number): void {
  if (worker.order.kind !== "construct") return;
  const site = game.get(worker.order.id);
  if (!site || site.built || site.builderId !== worker.id || site.team !== worker.team) {
    worker.order = IDLE_ORDER;
    worker.working = false;
    return;
  }
  if (site.constructionStarted && dist(worker, site) > site.r + 3.1) {
    abandonConstruction(game, site, "Surveyor moved out of range");
    return;
  }
  worker.working = dist(worker, site.workPoint) < 0.8;
  if (!worker.working) {
    game.travel(worker, site.workPoint.x, site.workPoint.z, dt, 0.45);
    worker.working = dist(worker, site.workPoint) < 0.8;
  }
  if (worker.working) {
    worker.angle = Math.atan2(site.x - worker.x, site.z - worker.z);
    worker.moving = false;
  }
}

export function updateConstruction(game: Game, site: IEntity, dt: number): void {
  const worker = site.builderId === null ? undefined : game.get(site.builderId);
  if (
    !worker ||
    worker.team !== site.team ||
    worker.order.kind !== "construct" ||
    worker.order.id !== site.id
  ) {
    abandonConstruction(game, site, "Surveyor lost or reassigned");
    return;
  }
  if (site.constructionStarted && dist(worker, site) > site.r + 3.1) {
    abandonConstruction(game, site, "Surveyor moved out of range");
    return;
  }
  if (!worker.working || dist(worker, site) > site.r + 3.1) {
    if (!site.constructionStarted && game.time - site.createdAt > 60) {
      abandonConstruction(game, site, "Surveyor could not reach the site");
    }
    return;
  }
  site.constructionStarted = true;
  const d = TYPES[site.type];
  const delta = Math.min(1 - site.progress, dt / d.time);
  site.progress = Math.min(1, site.progress + delta);
  site.hp = Math.min(site.maxHp, site.hp + site.maxHp * 0.8 * delta);
  site.weldClock -= dt;
  if (site.weldClock <= 0) {
    site.weldClock = 0.16;
    weldEvent.id = site.id;
    weldEvent.workerId = worker.id;
    weldEvent.x = worker.x;
    weldEvent.z = worker.z;
    weldEvent.tx = site.x + (worker.x - site.x) * 0.74;
    weldEvent.tz = site.z + (worker.z - site.z) * 0.74;
    weldEvent.height = 0.4 + site.progress * 2;
    weldEvent.team = site.team;
    weldEvent.repair = false;
    game.emit("weld", weldEvent);
  }
  if (site.progress >= 1 - 1e-9) {
    site.progress = 1;
    site.built = true;
    releaseBuilder(game, site, true);
    doneEvent.id = site.id;
    doneEvent.name = d.name;
    doneEvent.team = site.team;
    game.emit("complete", doneEvent);
  }
}

/** Every placement rule a structure must pass, in the order the player is told about them. */
export function buildCheck(
  game: Game,
  type: EntityType,
  x: number,
  z: number,
  team = 0,
): IOrderResult {
  const d = TYPES[type];
  if (!game.players[team]) return { ok: false, message: "Unknown faction." };
  if (!d?.building) return { ok: false, message: "Invalid structure." };
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(z) ||
    Math.abs(x) > HALF - d.r - 2 ||
    Math.abs(z) > HALF - d.r - 2
  ) {
    return { ok: false, message: "Outside the deployment zone." };
  }
  if (d.requires && !game.own(team).some((e) => e.type === d.requires && e.built)) {
    return { ok: false, message: `Requires a completed ${TYPES[d.requires].name}.` };
  }
  const own = game.own(team);
  const within =
    own.some((e) => e.building && e.built && Math.hypot(e.x - x, e.z - z) < 30) ||
    (type === "core" && own.some((e) => e.type === "worker" && Math.hypot(e.x - x, e.z - z) < 13));
  if (!within) {
    return {
      ok: false,
      message:
        type === "core"
          ? "Send a Surveyor to establish this expansion."
          : "Build within 30 meters of your base.",
    };
  }
  if (!game.visibleAt(x, z, team)) return { ok: false, message: "Scout this location first." };
  if (onBridge(x, z, -d.r) || waterBlocked(x, z, game.pools, d.r + 1)) {
    return { ok: false, message: "Cannot deploy in water or on a bridge." };
  }
  for (const e of game.entities) {
    if (e.building && e.hp > 0 && Math.hypot(e.x - x, e.z - z) < e.r + d.r + 1) {
      return { ok: false, message: "Structure footprint is obstructed." };
    }
  }
  for (const o of game.obstacles) {
    if (Math.hypot(o.x - x, o.z - z) < o.r + d.r + 0.8) {
      return { ok: false, message: "Terrain obstructs this location." };
    }
  }
  for (const n of game.nodes) {
    if (
      !(type === "refinery" && n.kind === "gas") &&
      Math.hypot(n.x - x, n.z - z) < n.r + d.r + 0.5
    ) {
      return { ok: false, message: "Keep resource fields clear." };
    }
  }
  if (
    type === "refinery" &&
    !game.nodes.some((n) => n.kind === "gas" && n.amount > 0 && Math.hypot(n.x - x, n.z - z) < 2.5)
  ) {
    return { ok: false, message: "Place an Extractor on a gas vent." };
  }
  return { ok: true };
}

/** The first legal site in widening rings around the requested point. */
export function findBuildSpot(
  game: Game,
  type: BuildingType,
  x: number,
  z: number,
  team = 0,
): IPoint | null {
  for (let r = 0; r < 27; r += 2.5) {
    for (let i = 0; i < 20; i++) {
      const a = i * (Math.PI / 10);
      const p = { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r };
      if (buildCheck(game, type, p.x, p.z, team).ok) return p;
    }
  }
  return null;
}
