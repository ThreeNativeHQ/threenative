/** Ore and gas: what a bank can pay for, what supply costs, and the harvest cycle. */

import type { Game } from "./game.js";
import { approachInteraction } from "./movement.js";
import {
  type EntityType,
  IDLE_ORDER,
  type IEntity,
  type IResourceNode,
  type ISupply,
  TYPES,
  dist,
} from "./types.js";

export function canAfford(game: Game, type: EntityType, team = 0): boolean {
  const d = TYPES[type];
  const bank = game.players[team]?.resources;
  return !!bank && bank.ore >= d.ore && bank.gas >= d.gas;
}

export function pay(game: Game, type: EntityType, team = 0): void {
  const d = TYPES[type];
  const player = game.players[team];
  if (!player) throw new Error(`Unknown faction ${team}`);
  player.resources.ore -= d.ore;
  player.resources.gas -= d.gas;
  player.spent.ore += d.ore;
  player.spent.gas += d.gas;
}

/** Supply already spent, including everything queued, against the cap the built structures grant.
 *
 * `out` is the caller's record rather than a fresh one: every producing structure asks this while it
 * trains and the HUD asks it every frame, and two numbers did not need an object each time. Each
 * caller owns its own — a commander holds its answer across the calls that would overwrite a shared
 * one.
 */
export function supply(game: Game, team: number, out: ISupply): ISupply {
  let used = 0;
  let cap = 0;
  // Over the live list, not `own()`: this is asked every step by every producing structure, and
  // `own()` hands back a fresh array to answer it.
  const entities = game.entities;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e === undefined || e.team !== team || e.hp <= 0) continue;
    const d = TYPES[e.type];
    used += d.supply || 0;
    if (e.built) cap += d.cap || 0;
    for (const q of e.queue) used += TYPES[q.type].supply || 0;
  }
  out.used = used;
  out.cap = Math.min(120, cap);
  return out;
}

/** The nearest live node of a kind, found in place: `filter().sort()[0]` was two arrays a call. */
function nearestNode(
  game: Game,
  entity: IEntity,
  kind: "ore" | "gas",
  requireAmount: boolean,
): IResourceNode | null {
  let best: IResourceNode | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const n of game.nodes) {
    if (n.kind !== kind || (requireAmount && n.amount <= 0)) continue;
    const away = dist(n, entity);
    if (away < bestDistance) {
      bestDistance = away;
      best = n;
    }
  }
  return best;
}

/** The nearest standing drop-off, found in place, for the same reason. */
function nearestCore(game: Game, entity: IEntity): IEntity | null {
  const entities = game.entities;
  let best: IEntity | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e === undefined || e.type !== "core" || e.team !== entity.team || e.hp <= 0 || !e.built)
      continue;
    const away = dist(e, entity);
    if (away < bestDistance) {
      bestDistance = away;
      best = e;
    }
  }
  return best;
}

/** Is this team's refinery standing close enough to run the node? */
function refineryNear(game: Game, entity: IEntity, node: IResourceNode): boolean {
  const entities = game.entities;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (
      e !== undefined &&
      e.type === "refinery" &&
      e.team === entity.team &&
      e.built &&
      e.hp > 0 &&
      dist(e, node) < 3
    )
      return true;
  }
  return false;
}

/** Walks the node, fills up over 1.8 s, then carries the load back to a drop-off. */
export function harvest(game: Game, entity: IEntity, dt: number): void {
  if (entity.order.kind !== "gather") return;
  const order = entity.order;
  const node = game.node(order.id);
  if (!node || (node.amount <= 0 && order.phase !== "return")) {
    const next = nearestNode(game, entity, "ore", true);
    if (next) {
      order.id = next.id;
      order.phase = "out";
    } else {
      entity.order = IDLE_ORDER;
    }
    return;
  }
  if (node.kind === "gas" && order.phase !== "return" && !refineryNear(game, entity, node)) {
    entity.order = IDLE_ORDER;
    return;
  }
  if (order.phase === "return") {
    const base = nearestCore(game, entity);
    if (!base) {
      entity.order = IDLE_ORDER;
      return;
    }
    if (approachInteraction(game, entity, base, base.r + 1.7, dt)) {
      const player = game.players[entity.team];
      if (!player) {
        entity.order = IDLE_ORDER;
        return;
      }
      const kind = entity.carryKind ?? "ore";
      player.resources[kind] += entity.carry;
      player.gathered[kind] += entity.carry;
      if (entity.team === 0) game.gathered += entity.carry;
      entity.carry = 0;
      order.phase = "out";
      entity.path.length = 0;
    }
    return;
  }
  if (approachInteraction(game, entity, node, node.kind === "gas" ? 4.15 : 2.8, dt)) {
    entity.angle = Math.atan2(node.x - entity.x, node.z - entity.z);
    entity.harvestTimer += dt;
    if (entity.harvestTimer >= 1.8) {
      const amount = Math.min(node.amount, node.kind === "gas" ? 8 : 10);
      node.amount -= amount;
      entity.carry = amount;
      entity.carryKind = node.kind;
      entity.harvestTimer = 0;
      order.phase = "return";
      entity.path.length = 0;
    }
  }
}
