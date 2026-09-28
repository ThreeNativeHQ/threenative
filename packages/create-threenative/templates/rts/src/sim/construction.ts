/** Builder/site ownership and lifecycle. Every faction uses these same rules. */

import { canAfford, pay } from "./economy.js";
import type { Game } from "./game.js";
import { HALF, onBridge, waterBlocked } from "./terrain.js";
import {
  type BuildingType,
  type EntityType,
  type IEntity,
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

export function constructionWorkPoint(
  game: Game,
  worker: IEntity,
  x: number,
  z: number,
  radius: number,
): IPoint | null {
  const angle = Math.atan2(worker.z - z, worker.x - x);
  const points = Array.from({ length: 24 }, (_, i) => {
    const a = angle + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 12);
    return {
      x: x + Math.cos(a) * (radius + worker.r + 0.9),
      z: z + Math.sin(a) * (radius + worker.r + 0.9),
    };
  }).filter((p) => !game.blocked(p.x, p.z, worker.r));
  // Check connectivity before charging. A path ending on another nearby cell is
  // not proof that this perimeter position is reachable.
  for (const point of points) {
    if (game.lineClear(worker, point, worker.r)) return point;
    const route = game.pathfind(worker, point, worker.r);
    const end = route[route.length - 1];
    if (end && dist(end, point) < 0.35) return point;
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
  const resume: Order = worker.order.kind === "gather" ? { ...worker.order } : { kind: "idle" };
  pay(game, type, team);
  const site = game.spawn(type, team, siteX, siteZ, false);
  Object.assign(site, {
    builderId: worker.id,
    workPoint: point,
    constructionStarted: false,
    resumeOrder: resume,
    createdAt: game.time,
    weldClock: 0,
  });
  worker.order = { kind: "construct", id: site.id };
  worker.orders = [];
  worker.path = [];
  worker.pathGoal = null;
  worker.pathClock = 0;
  worker.targetId = null;
  game.emit("build", { id: site.id, builderId: worker.id, x: siteX, z: siteZ, team });
  return { ok: true, id: site.id, builderId: worker.id };
}

export function releaseBuilder(game: Game, site: IEntity, resume = true): void {
  const worker = site.builderId === null ? undefined : game.get(site.builderId);
  site.builderId = null;
  if (!worker || worker.order.kind !== "construct" || worker.order.id !== site.id) return;
  worker.working = false;
  worker.order = { kind: "idle" };
  worker.path = [];
  worker.pathClock = 0;
  if (resume && !worker.orders.length && site.resumeOrder.kind === "gather") {
    game.command([worker.id], "gather", { id: site.resumeOrder.id }, worker.team);
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
  game.emit("constructionLost", {
    id: site.id,
    x: site.x,
    z: site.z,
    team: site.team,
    name: TYPES[site.type].name,
    reason,
    refund,
  });
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
    worker.order = { kind: "idle" };
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
    game.emit("weld", {
      id: site.id,
      workerId: worker.id,
      x: worker.x,
      z: worker.z,
      tx: site.x + (worker.x - site.x) * 0.74,
      tz: site.z + (worker.z - site.z) * 0.74,
      height: 0.4 + site.progress * 2,
      team: site.team,
    });
  }
  if (site.progress >= 1 - 1e-9) {
    site.progress = 1;
    site.built = true;
    releaseBuilder(game, site, true);
    game.emit("complete", { id: site.id, name: d.name, team: site.team });
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
