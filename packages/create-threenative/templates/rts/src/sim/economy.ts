/** Ore and gas: what a bank can pay for, what supply costs, and the harvest cycle. */

import type { Game } from "./game.js";
import { approachInteraction } from "./movement.js";
import { type EntityType, type IEntity, type ISupply, TYPES, dist } from "./types.js";

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

/** Supply already spent, including everything queued, against the cap the built structures grant. */
export function supply(game: Game, team = 0): ISupply {
  let used = 0;
  let cap = 0;
  for (const e of game.own(team)) {
    const d = TYPES[e.type];
    used += d.supply || 0;
    if (e.built) cap += d.cap || 0;
    for (const q of e.queue) used += TYPES[q.type].supply || 0;
  }
  return { used, cap: Math.min(120, cap) };
}

/** Walks the node, fills up over 1.8 s, then carries the load back to a drop-off. */
export function harvest(game: Game, entity: IEntity, dt: number): void {
  if (entity.order.kind !== "gather") return;
  const order = entity.order;
  const node = game.node(order.id);
  if (!node || (node.amount <= 0 && order.phase !== "return")) {
    const next = game.nodes
      .filter((n) => n.kind === "ore" && n.amount > 0)
      .sort((a, b) => dist(a, entity) - dist(b, entity))[0];
    if (next) {
      order.id = next.id;
      order.phase = "out";
    } else {
      entity.order = { kind: "idle" };
    }
    return;
  }
  if (
    node.kind === "gas" &&
    order.phase !== "return" &&
    !game.entities.some(
      (b) =>
        b.type === "refinery" && b.team === entity.team && b.built && b.hp > 0 && dist(b, node) < 3,
    )
  ) {
    entity.order = { kind: "idle" };
    return;
  }
  if (order.phase === "return") {
    const base = game.entities
      .filter((b) => b.type === "core" && b.team === entity.team && b.hp > 0 && b.built)
      .sort((a, b) => dist(a, entity) - dist(b, entity))[0];
    if (!base) {
      entity.order = { kind: "idle" };
      return;
    }
    if (approachInteraction(game, entity, base, base.r + 1.7, dt)) {
      const player = game.players[entity.team];
      if (!player) {
        entity.order = { kind: "idle" };
        return;
      }
      const kind = entity.carryKind ?? "ore";
      player.resources[kind] += entity.carry;
      player.gathered[kind] += entity.carry;
      if (entity.team === 0) game.gathered += entity.carry;
      entity.carry = 0;
      order.phase = "out";
      entity.path = [];
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
      entity.path = [];
    }
  }
}
