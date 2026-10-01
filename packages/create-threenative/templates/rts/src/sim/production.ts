/** Per-producer queues, the supply cap they respect, and the exit a trained unit walks out of. */

import { canAfford, pay, supply } from "./economy.js";
import type { Game } from "./game.js";
import {
  type EntityType,
  type ICommandTarget,
  type IEntity,
  type IGameEvent,
  type IOrderResult,
  type IQueueItem,
  type IResourceNode,
  type ISupply,
  TYPES,
  dist,
} from "./types.js";

/** How many training records a building owns: the six-item cap plus the one a push writes into. */
const QUEUE_POOL = 7;

/** `train` reads its answer before anything else can ask, so one record serves every producer. */
const _supply: ISupply = { used: 0, cap: 0 };

/**
 * The single-unit order a freshly trained unit is given, and the event that says it happened. Both
 * are read by `command` and `emit` before they return, so one of each serves every training.
 */
const _one: number[] = [0];
const _target: ICommandTarget = { id: 0 };
const trainedEvent: Partial<IGameEvent> = {};
/** Nobody here reads the answer, so the order result goes into a record nobody keeps. */
const _result: IOrderResult = { ok: false, count: 0 };

/**
 * Queues a unit. `into` is for the commander, which reads `.ok` immediately and keeps nothing: it
 * hands over a result it already has rather than making one per training order. A caller that does
 * not pass one still gets a fresh result, which is what the HUD and the tests use.
 */
export function train(
  game: Game,
  id: number,
  type: EntityType,
  team = 0,
  into?: IOrderResult,
): IOrderResult {
  const e = game.get(id);
  const d = TYPES[type];
  // A refusal reports into the caller's record when there is one and into a fresh object when there
  // is not. The messages belong to the refusal the player reads, so they stay.
  if (game.result || game.paused) return refuse(into, "The operation is not running.");
  if (!e || e.team !== team || !e.built || !TYPES[e.type].trains?.includes(type)) {
    return refuse(into, "Select the correct production building.");
  }
  if (e.queue.length >= 6) return refuse(into, "Production queue is full.");
  if (!canAfford(game, type, team)) return refuse(into, "Insufficient minerals or gas.");
  const bank = supply(game, team, _supply);
  if (bank.used + (d.supply || 0) > bank.cap) {
    return refuse(into, "Supply blocked. Build a Supply Relay.");
  }
  pay(game, type, team);
  // The record is the queue's own vacated slot. A removal leaves the records it passed over in
  // `queuePool` and moves the survivors along, so the next push takes a record nothing is reading:
  // two queued items are never the same object, which is what sharing one did the moment the queue
  // had been shortened.
  if (e.queue.length >= QUEUE_POOL) return { ok: false, message: "Production queue is full." };
  const record = e.queuePool[e.queueFree];
  if (record === undefined) return { ok: false, message: "Production queue is full." };
  e.queueFree = e.queueFree + 1 === QUEUE_POOL ? 0 : e.queueFree + 1;
  record.id = game.nextQueueId++;
  record.type = type;
  record.progress = 0;
  e.queue.push(record);
  if (into !== undefined) {
    into.ok = true;
    into.count = 1;
    return into;
  }
  return { ok: true };
}

/** A refusal: the caller's own record when it passed one, a fresh result when it did not. */
function refuse(into: IOrderResult | undefined, message: string): IOrderResult {
  if (into === undefined) return { ok: false, message };
  into.ok = false;
  into.count = 0;
  into.message = message;
  return into;
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
  const q = e.queue[index];
  if (!q) return { ok: false };
  // The window closes over the hole: every entry after it moves up one, so each keeps its own
  // record and `queue[i]` is still the i-th item for the HUD, `serialize` and `updateProduction`.
  for (let i = index; i < e.queue.length - 1; i++) e.queue[i] = e.queue[i + 1] as IQueueItem;
  e.queue.length -= 1;
  // The record the queue no longer points at is the one a push may reuse next.
  e.queueFree = e.queuePool.indexOf(q);
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
  // The survivors move up one, each keeping its own record, so `queue[i]` is still the i-th item
  // for the HUD, `serialize` and this loop. The record that left is the one a push may reuse.
  for (let i = 0; i < e.queue.length - 1; i++) e.queue[i] = e.queue[i + 1] as IQueueItem;
  e.queue.length -= 1;
  e.queueFree = e.queuePool.indexOf(q);
  const u = game.spawn(q.type, e.team, p.x, p.z);
  _one[0] = u.id;
  if (u.type === "worker") {
    // The nearest live ore node, chosen in place: `filter().sort()[0]` copied every node on the map
    // for each worker that finished training.
    let nearest: IResourceNode | undefined;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < game.nodes.length; i++) {
      const n = game.nodes[i];
      if (n === undefined || n.kind !== "ore" || n.amount <= 0) continue;
      const score = dist(n, e);
      if (score < best) {
        best = score;
        nearest = n;
      }
    }
    if (nearest) {
      _target.id = nearest.id;
      game.command(_one, "gather", _target, u.team, false, _result);
    }
  } else if (e.rally) {
    game.command(_one, "attackMove", e.rally, u.team, false, _result);
  }
  trainedEvent.id = u.id;
  trainedEvent.name = TYPES[u.type].name;
  trainedEvent.team = e.team;
  game.emit("trained", trainedEvent);
}
