/** Per-producer queues, the supply cap they respect, and the exit a trained unit walks out of. */

import { canAfford, pay, supply } from "./economy.js";
import type { Game } from "./game.js";
import {
  type EntityType,
  type IEntity,
  type IOrderResult,
  type ISupply,
  TYPES,
  dist,
} from "./types.js";

/** `train` reads its answer before anything else can ask, so one record serves every producer. */
const _supply: ISupply = { used: 0, cap: 0 };

export function train(game: Game, id: number, type: EntityType, team = 0): IOrderResult {
  const e = game.get(id);
  const d = TYPES[type];
  if (game.result || game.paused) return { ok: false, message: "The operation is not running." };
  if (!e || e.team !== team || !e.built || !TYPES[e.type].trains?.includes(type)) {
    return { ok: false, message: "Select the correct production building." };
  }
  if (e.queue.length >= 6) return { ok: false, message: "Production queue is full." };
  if (!canAfford(game, type, team)) return { ok: false, message: "Insufficient minerals or gas." };
  const bank = supply(game, team, _supply);
  if (bank.used + (d.supply || 0) > bank.cap) {
    return { ok: false, message: "Supply blocked. Build a Supply Relay." };
  }
  pay(game, type, team);
  e.queue.push({ id: game.nextQueueId++, type, progress: 0 });
  return { ok: true };
}

export function cancelTrain(game: Game, id: number, index: number, team = 0): IOrderResult {
  const e = game.get(id);
  if (
    game.result ||
    game.paused ||
    !e ||
    e.team !== team ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= e.queue.length
  ) {
    return { ok: false };
  }
  const q = e.queue.splice(index, 1)[0];
  if (!q) return { ok: false };
  const d = TYPES[q.type];
  const p = game.players[team];
  if (!p) return { ok: false };
  p.resources.ore += d.ore;
  p.resources.gas += d.gas;
  p.spent.ore -= d.ore;
  p.spent.gas -= d.gas;
  return { ok: true };
}

/**
 * Advances the front of the queue and delivers the unit once the producer has a clear exit.
 * A building that spawns or loses a neighbour changes the navigation, so a blocked exit is
 * retried half a second later rather than dropping the unit inside a wall.
 */
export function updateProduction(game: Game, e: IEntity, dt: number): void {
  if (!e.queue.length) return;
  const q = e.queue[0];
  if (!q) return;
  q.progress = Math.min(1, q.progress + dt / TYPES[q.type].time);
  if (q.progress < 1 || (e.exitRevision === game.navRevision && game.time < e.nextExitAttempt))
    return;
  e.exitRevision = game.navRevision;
  e.nextExitAttempt = game.time + 0.5;
  const p = game.spawnPoint(e, q.type);
  if (!p) return;
  e.queue.shift();
  const u = game.spawn(q.type, e.team, p.x, p.z);
  if (u.type === "worker") {
    const n = game.nodes
      .filter((n) => n.kind === "ore" && n.amount > 0)
      .sort((a, b) => dist(a, e) - dist(b, e))[0];
    if (n) game.command([u.id], "gather", { id: n.id }, u.team);
  } else if (e.rally) {
    game.command([u.id], "attackMove", e.rally, u.team);
  }
  game.emit("trained", { id: u.id, name: TYPES[u.type].name, team: e.team });
}
