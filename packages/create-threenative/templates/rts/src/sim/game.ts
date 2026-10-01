/** Deterministic RTS rules, shared by every faction. No browser dependencies. */

import { CommanderAI } from "./ai.js";
import {
  applyDamage,
  canAttackTarget,
  engage,
  garrisonCheck,
  unloadGarrison,
  updateGarrisonArrival,
  updateRepair,
  updateSupport,
} from "./combat.js";
import {
  abandonConstruction,
  beginConstruction,
  buildCheck,
  cancelConstruction,
  findBuildSpot,
  updateBuilder,
  updateConstruction,
} from "./construction.js";
import { canAfford, harvest, pay, supply } from "./economy.js";
import {
  clearMovement,
  newPathPool,
  separateEntities,
  spawnExit,
  travelEntity,
} from "./movement.js";
import { findRoute } from "./nav.js";
import { cancelTrain, train, updateProduction } from "./production.js";
import {
  HALF,
  MAP_CELL,
  POOLS,
  RESOURCE_SITES,
  ROCK_FIELDS,
  STARTS,
  WORLD,
  waterBlocked,
} from "./terrain.js";
import {
  type BuildingType,
  COMMAND_KINDS,
  EVENT_FIELDS,
  type EntityType,
  type IBank,
  type ICommandTarget,
  IDLE_ORDER,
  type IEntity,
  type IGameEvent,
  type IObstacle,
  type IOrderResult,
  type IPlayer,
  type IPoint,
  type IQueueItem,
  type IResourceNode,
  type IResult,
  type ISupply,
  type Order,
  SIM_STEP,
  TYPES,
  clamp,
  dist,
  formation,
  planeDistance,
  seeded,
} from "./types.js";
import { updateVision, visibleAt } from "./vision.js";

/** One allocation-free answer to "is a standing core near this unit?", asked once per unit per step. */
function coreNear(game: Game, unit: IEntity): boolean {
  const entities = game.entities;
  for (let i = 0; i < entities.length; i++) {
    const b = entities[i];
    if (
      b !== undefined &&
      b.type === "core" &&
      b.built &&
      b.hp > 0 &&
      b.team === unit.team &&
      dist(b, unit) < 15
    )
      return true;
  }
  return false;
}

/** Does this faction still have a core standing? Asked three times a step, so no closure per call. */
function coreAlive(game: Game, team: number): boolean {
  const entities = game.entities;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e !== undefined && e.team === team && e.type === "core" && e.hp > 0) return true;
  }
  return false;
}

function anyEnemyCoreAlive(game: Game): boolean {
  const entities = game.entities;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e !== undefined && e.team > 0 && e.type === "core" && e.hp > 0) return true;
  }
  return false;
}

export interface IGameOptions {
  ai?: boolean;
  seed?: number;
  /** Injected worldgen stream. Defaults to the seeded mulberry32 the original world used. */
  random?: () => number;
}

/**
 * The scratch one `command` call works in: the deduplicated selection, its mobile half, and the
 * formation grid. Retained on the game and reused, because a group order runs for every unit in the
 * selection and `[...new Set(ids)].map().filter()` plus a fresh `formation()` was five arrays and one
 * object per unit per order.
 *
 * `command` re-enters itself — reassigning a builder abandons its site, which resumes the worker —
 * so the scratch is taken by depth rather than shared outright: the nested call builds its own, and
 * only a call with no nested call behind it hands the retained one back.
 */
interface IOrderScratch {
  depth: number;
  units: IEntity[];
  mobile: IEntity[];
  points: IPoint[];
  seen: Set<number>;
}

/** How many events a batch holds before the oldest is dropped, and so the size of one bank. */
const EVENT_CAPACITY = 250;

const eliminatedEvent: Partial<IGameEvent> = {};
const endEvent: Partial<IGameEvent> = {};

/** What an event field reads when the event that owns it did not set it. */
const EMPTY = undefined as unknown as never;

/**
 * How many order records a unit owns. A unit's current order plus a full 20-order queue is 21 live
 * records, and the record for a replacement order is written before the queue it replaces is
 * dropped, so 22 is the smallest number that cannot hand the same record to two live orders.
 */
const ORDER_POOL = 22;

/**
 * The orders `command` writes, filled one field at a time and copied into a pool record. They are
 * never retained: `writeOrder` copies before returning, so one of each kind is enough however many
 * units a group order touches. `kind` is set per branch, so only the fields that kind reads matter.
 */
const moveOrder = { kind: "move" as "move" | "attackMove", x: 0, z: 0 };
const gatherOrder = { kind: "gather" as const, id: 0, phase: "out" as "out" | "return" };
const targetOrder = {
  kind: "attack" as "attack" | "garrison" | "repair" | "heal" | "follow",
  id: 0,
};
const HOLD_ORDER: Order = { kind: "hold" };

/**
 * A record of this unit's own that nothing is reading: not its current order and not any of the up
 * to 20 it has queued. A cursor cannot do this, because a cancelled order frees a slot in the middle
 * and a wrap then writes over the order the unit is walking. The search is over the unit's own 22
 * records and allocates nothing; a unit with a full queue has none, and the caller refuses instead.
 */
function takeOrder(unit: IEntity): Order | undefined {
  const pool = unit.orderPool;
  for (let i = 0; i < pool.length; i++) {
    const record = pool[i];
    if (record === undefined || record === unit.order) continue;
    if (unit.orders.includes(record)) continue;
    return record;
  }
  return undefined;
}

/**
 * Copies `next` over a record of the unit's own that nothing is reading, and hands that record back.
 * The unit's current order is not one of those: it is replaced by the returned record, so writing
 * over it would leave the old order and the new one as the same object — which is what a cursor over
 * the ring did after eleven appends wrapped it onto the order the unit was walking.
 */
function writeOrder(unit: IEntity, next: Order): Order | undefined {
  const record = takeOrder(unit);
  if (record === undefined) return undefined;
  copyOrder(record, next);
  return record;
}

/**
 * Field by field, so an order that had a target does not keep it after being overwritten by one that
 * only moves. `id` is where a stale value shows: a move order read as an attack on whatever the
 * last target was.
 */
function copyOrder(record: Order, next: Order): void {
  const to = record as unknown as {
    kind: Order["kind"];
    x: number;
    z: number;
    id: number;
    phase: "out" | "return";
  };
  const from = next as unknown as typeof to;
  to.kind = from.kind;
  to.x = from.x;
  to.z = from.z;
  to.id = from.id;
  to.phase = from.phase;
}

/** A building's own training-queue records: one per position, plus the one a push is written into. */
function makeQueuePool(): IQueueItem[] {
  const pool: IQueueItem[] = [];
  for (let i = 0; i < 7; i++) pool.push({ id: 0, type: "worker", progress: 0 });
  return pool;
}

/** Fills a caller-owned result. `message` is left off: an order that reports one is rare and cold. */
function writeResult(into: IOrderResult, ok: boolean, count: number): IOrderResult {
  into.ok = ok;
  into.count = count;
  return into;
}

/** A unit's own order records, built when the unit is born. */
function makeOrderPool(): Order[] {
  const pool: Order[] = [];
  for (let i = 0; i < ORDER_POOL; i++) {
    pool.push({
      kind: "idle",
      x: 0,
      z: 0,
      id: 0,
      phase: "out",
    } as unknown as Order);
  }
  return pool;
}

/** One bank: 250 records that all have every declared field, so a reused slot keeps its shape. */
function makeEventBank(): IGameEvent[] {
  const bank: IGameEvent[] = [];
  for (let i = 0; i < EVENT_CAPACITY; i++) {
    bank.push({
      type: "",
      time: 0,
      id: 0,
      unitId: 0,
      workerId: 0,
      builderId: 0,
      targetId: 0,
      team: 0,
      name: "",
      count: 0,
      targetTeam: 0,
      x: 0,
      z: 0,
      y: 0,
      tx: 0,
      tz: 0,
      ty: 0,
      height: 0,
      altitude: 0,
      building: false,
      repair: false,
      destruction: false,
      unit: "",
      typeName: "",
      style: "",
      result: "",
      reason: "",
      refund: 0,
    });
  }
  return bank;
}

export class Game {
  readonly rng: () => number;
  readonly seed: number;
  ai: boolean;
  entities: IEntity[] = [];
  nodes: IResourceNode[] = [];
  obstacles: IObstacle[] = [];
  pools = POOLS.map((p) => ({ ...p }));
  nextId = 1;
  nextQueueId = 1;
  worldSize = WORLD;
  cell = MAP_CELL;
  gridSize = WORLD / MAP_CELL;
  players: IPlayer[];
  resources: IBank;
  visible: Uint8Array;
  explored: Uint8Array;
  time = 0;
  kills = 0;
  losses = 0;
  gathered = 0;
  paused = false;
  result: IResult = null;
  events: IGameEvent[] = [];
  /** The live bank of event records, the one being written to right now. */
  #slots: IGameEvent[] = [];
  /** The bank handed out by the last drain: still readable until the next one. */
  #spareSlots: IGameEvent[] = [];
  /** The bank neither of the other two is using, kept so a drain never allocates. */
  #pool: IGameEvent[] = [];
  /** The array the last drain handed out, reused as the next batch's array. */
  #spareEvents: IGameEvent[] = [];
  #cursor = 0;
  #used = 0;

  /** The scratch for one level of nesting, reused: a group order nests a few deep, repeatedly. */
  #nestedScratch(depth: number): IOrderScratch {
    const found = this.scratchPool[depth - 1];
    if (found !== undefined) {
      found.depth = 0;
      found.seen.clear();
      return found;
    }
    if (this.scratchPool.length >= 3)
      return { depth: 0, units: [], mobile: [], points: [], seen: new Set() };
    const made: IOrderScratch = { depth: 0, units: [], mobile: [], points: [], seen: new Set() };
    this.scratchPool.push(made);
    return made;
  }
  navRevision = 0;
  visionClock = 0;
  navMasks = new Map<string, Uint8Array>();
  commanders: CommanderAI[] = [];

  constructor({ ai = true, seed = 17, random }: IGameOptions = {}) {
    this.rng = random ?? seeded(seed);
    // Cold, and once: two banks of distinct records, because a drained batch stays readable until
    // the next drain, and the array that carries it is reused rather than reallocated.
    this.#pool = makeEventBank();
    this.#slots = this.#pool;
    this.#spareSlots = makeEventBank();
    this.#spareEvents = [];
    this.seed = seed;
    this.ai = ai;
    this.players = STARTS.map((s) => ({
      team: s.team,
      name: s.name,
      resources: { ore: s.team ? 550 : 700, gas: s.team ? 100 : 150 },
      gathered: { ore: 0, gas: 0 },
      spent: { ore: 0, gas: 0 },
      eliminated: false,
      visible: new Uint8Array(this.gridSize ** 2),
      explored: new Uint8Array(this.gridSize ** 2),
    }));
    const home = this.players[0];
    if (!home) throw new Error("The seeded world has no team 0");
    this.resources = home.resources;
    this.visible = home.visible;
    this.explored = home.explored;
    this.initialize();
    this.commanders = [new CommanderAI(1, seed + 31), new CommanderAI(2, seed + 79)];
  }

  initialize(): void {
    for (const [x, z, r] of ROCK_FIELDS) {
      this.obstacles.push({ x, z, r, kind: "rock" });
      for (let i = 0; i < 2; i++) {
        const a = this.rng() * Math.PI * 2;
        this.obstacles.push({
          x: x + Math.cos(a) * r * 0.7,
          z: z + Math.sin(a) * r * 0.7,
          r: 1.1 + this.rng() * 1.5,
          kind: "rock",
        });
      }
    }
    RESOURCE_SITES.forEach((site, index) => {
      for (let i = 0; i < 7; i++) {
        const a = 0.15 + (i / 7) * Math.PI * 1.8;
        this.nodes.push({
          id: this.nextId++,
          kind: "ore",
          x: site.x + Math.cos(a) * 4.4,
          z: site.z + Math.sin(a) * 4.4,
          r: 1.6,
          amount: 2100,
          site: index,
        });
      }
      this.nodes.push({
        id: this.nextId++,
        kind: "gas",
        x: site.gx,
        z: site.gz,
        r: 2.6,
        amount: 3000,
        site: index,
      });
    });
    for (const start of STARTS) {
      const { team, x, z } = start;
      const site = RESOURCE_SITES[team];
      if (!site) continue;
      this.spawn("core", team, x, z);
      this.spawn("barracks", team, x + 14, z - 2);
      this.spawn("relay", team, x - 7, z - 16);
      this.spawn("refinery", team, site.gx, site.gz);
      if (team) this.spawn("turret", team, x + 1, z + 15);
      const ores = this.nodes.filter((n) => n.site === team && n.kind === "ore");
      const gas = this.nodes.find((n) => n.site === team && n.kind === "gas");
      if (!gas) continue;
      const count = team ? 8 : 10;
      for (let i = 0; i < count; i++) {
        const u = this.spawn(
          "worker",
          team,
          x - 9 - (i % 3) * 1.7,
          z - 4 + Math.floor(i / 3) * 1.9,
        );
        const node = i >= count - 2 ? gas : ores[i % ores.length];
        if (!node) continue;
        this.command([u.id], "gather", { id: node.id }, team);
      }
      for (const v of formation(team ? 5 : 8, x + 15, z - 16, 2.2)) {
        this.spawn("ranger", team, v.x, v.z);
      }
      this.spawn(team === 2 ? "hover" : "tank", team, x + 3, z - 18);
      if (!team) this.spawn("hover", team, x + 10, z - 23);
    }
    this.updateVision();
  }

  own(team = 0): IEntity[] {
    return this.entities.filter((e) => e.team === team && e.hp > 0);
  }

  army(team = 0): IEntity[] {
    return this.own(team).filter((e) => !e.building && e.type !== "worker" && !e.garrisonId);
  }

  canAttack(a: IEntity | undefined, b: IEntity | undefined): boolean {
    return canAttackTarget(this, a, b);
  }

  unload(id: number, team = 0): IOrderResult {
    return unloadGarrison(this, id, team);
  }

  get(id: number): IEntity | undefined {
    // A loop, not `find`: this is asked for every ordered unit, every step, and `find` builds a
    // closure and an iterator to answer it.
    const entities = this.entities;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e !== undefined && e.id === id && e.hp > 0) return e;
    }
    return undefined;
  }

  node(id: number): IResourceNode | undefined {
    const nodes = this.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n !== undefined && n.id === id) return n;
    }
    return undefined;
  }

  spawn(type: EntityType, team: number, x: number, z: number, built = true): IEntity {
    const d = TYPES[type];
    if (!d) throw new Error(`Unknown entity ${type}`);
    const e: IEntity = {
      id: this.nextId++,
      type,
      team,
      x,
      z,
      air: !!d.air,
      altitude: d.altitude || 0,
      garrisonId: null,
      garrison: [],
      builderId: null,
      workPoint: { x, z },
      constructionStarted: false,
      createdAt: 0,
      resumeOrder: IDLE_ORDER,
      weldClock: 0,
      working: false,
      hp: built ? d.hp : d.hp * 0.2,
      maxHp: d.hp,
      building: !!d.building,
      r: d.r,
      built,
      progress: built ? 1 : 0,
      angle: team === 0 ? Math.PI : 0,
      order: IDLE_ORDER,
      orders: [],
      orderPool: makeOrderPool(),
      queue: [],
      queuePool: makeQueuePool(),
      rally: null,
      cooldown: 0,
      carry: 0,
      carryKind: null,
      harvestTimer: 0,
      path: [],
      pathClock: 0,
      pathGoal: null,
      pathEnd: null,
      pathAdjusted: false,
      goalPoint: { x, z },
      pathGoalPoint: { x, z },
      pathEndPoint: { x, z },
      pathPool: newPathPool(),
      interactionPoint: { x, z },
      interactionGoal: { point: null, range: 0, retryAt: 0, revision: -1, targetId: -1 },
      pathRevision: 0,
      moving: false,
      targetId: null,
      healTargetId: null,
      healFxClock: 0,
      repairClock: 0,
      flash: 0,
      hitFlash: 0,
      lastDamaged: -20,
      exitRevision: 0,
      nextExitAttempt: 0,
    };
    this.entities.push(e);
    if (e.building) this.navRevision++;
    return e;
  }

  /** The scene's own supply record: it reads the answer straight into the state patch it publishes. */
  readonly publishedSupply: ISupply = { used: 0, cap: 0 };

  supply(team = 0) {
    return supply(this, team, this.publishedSupply);
  }

  canAfford(type: EntityType, team = 0): boolean {
    return canAfford(this, type, team);
  }

  pay(type: EntityType, team = 0): void {
    pay(this, type, team);
  }

  /** `into` is passed through for the commander; see `train`. Anyone else gets a fresh result. */
  train(id: number, type: EntityType, team = 0, into?: IOrderResult): IOrderResult {
    return train(this, id, type, team, into);
  }

  cancelTrain(id: number, index: number, team = 0): IOrderResult {
    return cancelTrain(this, id, index, team);
  }

  buildCheck(type: EntityType, x: number, z: number, team = 0): IOrderResult {
    return buildCheck(this, type, x, z, team);
  }

  findBuildSpot(type: BuildingType, x: number, z: number, team = 0): IPoint | null {
    return findBuildSpot(this, type, x, z, team);
  }

  build(
    type: BuildingType,
    x: number,
    z: number,
    team = 0,
    builderId: number | null = null,
  ): IOrderResult {
    return beginConstruction(this, type, x, z, team, builderId);
  }

  cancelBuild(id: number, team = 0): IOrderResult {
    return cancelConstruction(this, id, team);
  }

  /** The one entry point for a player order. Anything it does not accept returns `{ok: false}`. */
  readonly orderScratch: IOrderScratch = {
    depth: 0,
    units: [],
    mobile: [],
    points: [],
    seen: new Set(),
  };
  /**
   * The scratch one nesting level deeper uses, and the next, and so on. A nested command (a
   * reassigned builder abandoning its site resumes the worker, which orders it) needs a selection
   * and a formation grid of its own, and minting one per nesting meant a fresh array to grow the
   * grid into every time a worker was reassigned mid-construction. Three levels is well past any
   * chain this ruleset produces, and the fourth falls back to a fresh scratch rather than growing.
   */
  readonly scratchPool: IOrderScratch[] = [];

  /**
   * Orders a selection. `into` is for the hot internal callers: the result is read immediately and
   * thrown away, so the AI passes a record it owns rather than making one per order. A caller that
   * does not pass one gets a fresh result it may keep, which is the public contract and does not
   * change.
   */
  command(
    ids: number[],
    kind: string,
    target: ICommandTarget = {},
    team = 0,
    append = false,
    into?: IOrderResult,
  ): IOrderResult {
    const scratch = this.orderScratch;
    // A nested call (a reassigned builder abandoning its site resumes the worker) gets its own
    // scratch, so the outer call's selection and formation grid are still intact underneath it.
    const mine: IOrderScratch = scratch.depth > 0 ? this.#nestedScratch(scratch.depth) : scratch;
    scratch.depth += 1;
    try {
      return this.#command(ids, kind, target, team, append, mine, into);
    } finally {
      scratch.depth -= 1;
    }
  }

  #command(
    ids: number[],
    kind: string,
    target: ICommandTarget,
    team: number,
    append: boolean,
    scratch: IOrderScratch,
    into: IOrderResult | undefined,
  ): IOrderResult {
    if (this.result || this.paused || !Array.isArray(ids) || !this.players[team])
      return into === undefined ? { ok: false } : writeResult(into, false, 0);
    if (!COMMAND_KINDS.includes(kind))
      return into === undefined ? { ok: false } : writeResult(into, false, 0);
    if (
      (kind === "move" || kind === "attackMove") &&
      (!Number.isFinite(target.x) || !Number.isFinite(target.z))
    ) {
      return into === undefined ? { ok: false } : writeResult(into, false, 0);
    }
    // The selection, deduplicated in first-seen order — the order `[...new Set(ids)]` gave, and the
    // order every formation slot and every `units` index below depends on.
    const seen = scratch.seen;
    const units = scratch.units;
    const mobile = scratch.mobile;
    seen.clear();
    units.length = 0;
    mobile.length = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (id === undefined || seen.has(id)) continue;
      seen.add(id);
      const e = this.get(id);
      if (!e || e.team !== team || e.garrisonId) continue;
      units.push(e);
      if (!e.building) mobile.push(e);
    }
    const points = formation(
      mobile.length,
      clamp(target.x ?? 0, -HALF + 4, HALF - 4),
      clamp(target.z ?? 0, -HALF + 4, HALF - 4),
      mobile.some((e) => e.type === "tank") ? 2.7 : 2.05,
      scratch.points,
    );
    let i = 0;
    let accepted = 0;
    for (const unit of units) {
      if (unit.building) {
        if (
          (kind === "move" || kind === "attackMove") &&
          unit.built &&
          TYPES[unit.type].trains?.length
        ) {
          unit.rally = {
            x: clamp(target.x ?? 0, -HALF + 4, HALF - 4),
            z: clamp(target.z ?? 0, -HALF + 4, HALF - 4),
          };
          accepted++;
        }
        continue;
      }
      const point = points[i++];
      if (!point) continue;
      let order: Order;
      if (kind === "gather") {
        if (unit.type !== "worker") continue;
        let n = target.id === undefined ? undefined : this.node(target.id);
        const b = target.id === undefined ? undefined : this.get(target.id);
        if (b?.type === "refinery" && b.team === team) {
          n = this.nodes.find((node) => node.kind === "gas" && dist(node, b) < 3);
        }
        if (!n || n.amount <= 0) continue;
        if (
          n.kind === "gas" &&
          !this.entities.some(
            (x) =>
              x.team === team && x.type === "refinery" && x.built && x.hp > 0 && dist(x, n) < 3,
          )
        )
          continue;
        gatherOrder.id = n.id;
        gatherOrder.phase = unit.carry ? "return" : "out";
        order = gatherOrder;
      } else if (kind === "garrison") {
        const bunker = target.id === undefined ? undefined : this.get(target.id);
        if (!bunker || !garrisonCheck(this, unit, bunker)) continue;
        targetOrder.kind = "garrison";
        targetOrder.id = bunker.id;
        order = targetOrder;
      } else if (kind === "repair") {
        const structure = target.id === undefined ? undefined : this.get(target.id);
        if (
          unit.type !== "worker" ||
          !structure ||
          !structure.building ||
          !structure.built ||
          structure.team !== team
        )
          continue;
        targetOrder.kind = "repair";
        targetOrder.id = structure.id;
        order = targetOrder;
      } else if (kind === "heal" || kind === "follow") {
        const ally = target.id === undefined ? undefined : this.get(target.id);
        if (
          unit.type !== "medic" ||
          !ally ||
          ally.building ||
          ally.garrisonId ||
          ally.team !== team ||
          ally.id === unit.id ||
          ally.air
        )
          continue;
        targetOrder.kind = kind as "heal" | "follow";
        targetOrder.id = ally.id;
        order = targetOrder;
      } else if (kind === "attack") {
        const enemy = target.id === undefined ? undefined : this.get(target.id);
        if (!enemy || !this.canAttack(unit, enemy) || !this.visibleAt(enemy.x, enemy.z, team))
          continue;
        targetOrder.kind = "attack";
        targetOrder.id = enemy.id;
        order = targetOrder;
      } else if (kind === "stop") {
        order = IDLE_ORDER;
      } else if (kind === "hold") {
        order = HOLD_ORDER;
      } else {
        moveOrder.kind = kind === "attackMove" ? "attackMove" : "move";
        moveOrder.x = clamp(point.x, -HALF + 3, HALF - 3);
        moveOrder.z = clamp(point.z, -HALF + 3, HALF - 3);
        order = moveOrder;
      }
      if (append && kind !== "stop" && kind !== "hold" && unit.order.kind !== "idle") {
        if (unit.orders.length < 20) {
          // A queued order is a record of its own: the current order and up to 20 queued ones are
          // all readable at once, so they cannot come from one shared record. The record is taken
          // before anything live is written, so a full queue leaves the current order as it was.
          const queued = takeOrder(unit);
          if (queued === undefined) continue;
          copyOrder(queued, order);
          unit.orders.push(queued);
          accepted++;
        }
      } else {
        // The record a new order goes into is written before `abandonConstruction` reads the old
        // order, because writing it touches a free record and never the one the unit is following.
        // `stop` keeps the one idle order every idle unit shares rather than a copy of it.
        const record = order === IDLE_ORDER ? IDLE_ORDER : writeOrder(unit, order);
        if (record === undefined) continue;
        if (unit.order.kind === "construct") {
          abandonConstruction(this, this.get(unit.order.id), "Surveyor reassigned");
        }
        unit.order = record;
        unit.orders.length = 0;
        clearMovement(unit);
        unit.targetId = null;
        unit.harvestTimer = 0;
        accepted++;
      }
    }
    if (into === undefined) return { ok: accepted > 0, count: accepted };
    return writeResult(into, accepted > 0, accepted);
  }

  /**
   * Records one game event.
   *
   * The record is a slot, not an object minted per event. There are two banks of 250 distinct
   * records and two arrays holding them, all built once when the game is born, and `drainEvents`
   * swaps which bank is live. That is what lets the array a caller is holding stay readable: the
   * next events land in the other bank, so the batch just returned is not overwritten under the
   * consumer that is still reading it. Two banks, not one, because the batch outlives the call
   * that produced it until the next drain.
   *
   * `payload` is copied into the slot field by field rather than kept, so a call site may hand over
   * a scratch object it reuses: the copy happens before this returns, and the queue never aliases
   * the caller's object. A field the payload does not carry is cleared, so a reused slot never
   * reports a value left by the event that held it before.
   */
  emit(type: string, payload: Partial<IGameEvent> = {}): void {
    const slots = this.#slots;
    // The overflow rule is the one this always had: the 251st event drops the oldest, and the bank is
    // a ring, so "oldest" is the slot the cursor is about to reuse.
    const slot = slots[this.#cursor];
    if (slot === undefined) return;
    for (let f = 0; f < EVENT_FIELDS.length; f++) {
      const key = EVENT_FIELDS[f] as keyof IGameEvent;
      slot[key] = (payload[key] ?? EMPTY) as never;
    }
    slot.type = type;
    slot.time = this.time;
    this.#cursor += 1;
    if (this.#cursor === EVENT_CAPACITY) this.#cursor = 0;
    if (this.#used < EVENT_CAPACITY) this.#used += 1;
    // The array is the ordered view of the ring, oldest first, which is the order the queue had.
    // Below the cap the batch is already in that order, so the new record is appended and nothing is
    // rewritten. A full bank rotates instead: the record the cursor just left is the oldest one, so
    // the whole array is rewritten rather than shifted, which is the 250 writes that drops one.
    const events = this.events;
    if (this.#used < EVENT_CAPACITY) {
      events.push(slot);
    } else {
      events.length = EVENT_CAPACITY;
      for (let i = 0; i < EVENT_CAPACITY; i++) {
        const record = slots[(this.#cursor + i) % EVENT_CAPACITY];
        if (record !== undefined) events[i] = record;
      }
    }
  }

  /**
   * Hands the caller this frame's events and starts a fresh batch.
   *
   * The returned array and the records in it stay valid until the NEXT `drainEvents`: the live bank
   * is swapped for the other one first, so events emitted after this call cannot land in the batch
   * being read. `Play.#drain` reads its batch synchronously and keeps only the notice strings, so
   * nothing in this template outlives the call.
   */
  drainEvents(): IGameEvent[] {
    const handed = this.events;
    // The array just handed out becomes the next batch's array, and the one that was waiting takes
    // over as this batch's. Two arrays, swapped: a drain on an ordinary frame allocates nothing,
    // which is the frame `Play` drains on.
    this.events = this.#spareEvents;
    this.#spareEvents = handed;
    this.#slots = this.#spareSlots;
    this.#spareSlots = this.#pool;
    this.#pool = this.#slots;
    this.#cursor = 0;
    this.#used = 0;
    this.events.length = 0;
    return handed;
  }

  /** The simulation's fixed step. The engine's fixed loop calls this; a test calls it in a loop. */
  step(dt: number = SIM_STEP): void {
    this.update(dt);
  }

  update(dt: number): void {
    if (this.paused || this.result || !Number.isFinite(dt) || dt <= 0) return;
    const step = Math.min(dt, 0.1);
    this.time += step;
    this.visionClock += step;
    // Indexed over the length captured up front, not a copy of the array: a unit trained mid-step
    // is picked up on the next step, exactly as the copied array did, and the step no longer
    // copies sixty records to iterate them.
    const entities = this.entities;
    const visited = entities.length;
    for (let index = 0; index < visited; index++) {
      const e = entities[index];
      if (e === undefined || e.hp <= 0 || e.garrisonId) continue;
      if (e.hp <= 0 || e.garrisonId) continue;
      e.moving = false;
      e.healTargetId = null;
      e.cooldown = Math.max(0, e.cooldown - step);
      e.flash = Math.max(0, e.flash - step);
      e.hitFlash = Math.max(0, e.hitFlash - step);
      e.pathClock = Math.max(0, e.pathClock - step);
      const d = TYPES[e.type];
      const queued = e.order.kind === "idle" ? e.orders.shift() : undefined;
      if (queued) e.order = queued;
      if (!e.built) {
        updateConstruction(this, e, step);
        continue;
      }
      if (e.order.kind === "construct") {
        updateBuilder(this, e, step);
        continue;
      }
      if (e.order.kind === "garrison") {
        updateGarrisonArrival(this, e, step);
        continue;
      }
      if (e.order.kind === "repair") {
        updateRepair(this, e, step);
        continue;
      }
      updateProduction(this, e, step);
      if (e.building) {
        if (d.damage || d.capacity) this.fight(e, step, true);
        continue;
      }
      if (
        e.hp < e.maxHp &&
        this.time - e.lastDamaged > 8 &&
        e.order.kind !== "attack" &&
        coreNear(this, e)
      ) {
        e.hp = Math.min(e.maxHp, e.hp + step * 4);
      }
      if (e.order.kind === "gather") {
        harvest(this, e, step);
        continue;
      }
      if (e.order.kind === "move") {
        if (this.travel(e, e.order.x, e.order.z, step, 0.45)) e.order = IDLE_ORDER;
        continue;
      }
      const fought = d.heal
        ? updateSupport(this, e, step, e.order.kind === "hold")
        : this.fight(e, step, e.order.kind === "hold");
      if (!fought && e.order.kind === "attackMove") {
        if (this.travel(e, e.order.x, e.order.z, step, 0.6)) e.order = IDLE_ORDER;
      }
    }
    this.separate(step);
    this.pruneDead();
    if (this.visionClock > 0.3) {
      this.updateVision();
      this.visionClock = 0;
    }
    if (this.ai) for (const commander of this.commanders) commander.update(this, step);
    let anyEliminated = false;
    for (const player of this.players) {
      if (player.eliminated || coreAlive(this, player.team)) continue;
      player.eliminated = true;
      eliminatedEvent.team = player.team;
      eliminatedEvent.name = player.name;
      this.emit("eliminated", eliminatedEvent);
      for (const e of this.own(player.team)) {
        this.damage(e, e.hp, player.team === 0 ? 1 : 0);
      }
    }
    for (const player of this.players) {
      if (player.eliminated) {
        anyEliminated = true;
        break;
      }
    }
    this.pruneDead();
    if (anyEliminated) this.updateVision();
    if (!coreAlive(this, 0)) {
      this.result = "defeat";
      endEvent.result = "defeat";
      this.emit("end", endEvent);
    } else if (!anyEnemyCoreAlive(this)) {
      this.result = "victory";
      endEvent.result = "victory";
      this.emit("end", endEvent);
    }
  }

  /** Drops the dead in place, order kept: the same survivors the filtered copy left, without it. */
  pruneDead(): void {
    const entities = this.entities;
    let kept = 0;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e === undefined || e.hp <= 0) continue;
      entities[kept] = e;
      kept += 1;
    }
    entities.length = kept;
  }

  spawnPoint(building: IEntity, type: EntityType = "worker"): IPoint | null {
    return spawnExit(this, building, type);
  }

  harvest(entity: IEntity, dt: number): void {
    harvest(this, entity, dt);
  }

  fight(entity: IEntity, dt: number, hold = false): boolean {
    return engage(this, entity, dt, hold);
  }

  damage(entity: IEntity, amount: number, attacker?: number): void {
    applyDamage(this, entity, amount, attacker);
  }

  blocked(x: number, z: number, r = 0.7): boolean {
    if (Math.abs(x) > HALF - r - 1 || Math.abs(z) > HALF - r - 1) return true;
    if (waterBlocked(x, z, this.pools, r)) return true;
    for (const o of this.obstacles) if (planeDistance(x, z, o.x, o.z) < o.r + r) return true;
    for (const b of this.entities) {
      if (b.building && b.hp > 0 && planeDistance(x, z, b.x, b.z) < b.r + r) return true;
    }
    return false;
  }

  lineClear(a: IPoint, b: IPoint, r = 0.7): boolean {
    const d = dist(a, b);
    const n = Math.ceil(d / 1.1);
    for (let i = 1; i <= n; i++) {
      if (this.blocked(a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n, r)) return false;
    }
    return true;
  }

  pathfind(a: IPoint, b: IPoint, radius = 0.8): IPoint[] {
    return findRoute(this, a, b, radius);
  }

  travel(entity: IEntity, x: number, z: number, dt: number, stop = 0.5): boolean {
    return travelEntity(this, entity, x, z, dt, stop);
  }

  separate(dt: number): void {
    separateEntities(this, dt);
  }

  updateVision(): void {
    updateVision(this);
  }

  visibleAt(x: number, z: number, team = 0): boolean {
    return visibleAt(this, x, z, team);
  }

  /** Everything a replay has to match: banks, fog, every node and every entity. */
  serialize(): string {
    return JSON.stringify({
      time: this.time,
      kills: this.kills,
      losses: this.losses,
      gathered: this.gathered,
      result: this.result,
      navRevision: this.navRevision,
      nextId: this.nextId,
      nextQueueId: this.nextQueueId,
      players: this.players.map((p) => ({
        team: p.team,
        name: p.name,
        resources: p.resources,
        gathered: p.gathered,
        spent: p.spent,
        eliminated: p.eliminated,
        visible: Array.from(p.visible),
        explored: Array.from(p.explored),
      })),
      nodes: this.nodes.map((n) => ({ id: n.id, kind: n.kind, amount: n.amount })),
      entities: this.entities.map((e) => ({
        id: e.id,
        type: e.type,
        team: e.team,
        x: e.x,
        z: e.z,
        hp: e.hp,
        built: e.built,
        progress: e.progress,
        angle: e.angle,
        order: e.order,
        orders: e.orders,
        queue: e.queue,
        carry: e.carry,
        carryKind: e.carryKind,
        garrison: e.garrison,
        garrisonId: e.garrisonId,
        builderId: e.builderId,
        cooldown: e.cooldown,
        targetId: e.targetId,
        working: e.working,
        path: e.path,
      })),
    });
  }
}
