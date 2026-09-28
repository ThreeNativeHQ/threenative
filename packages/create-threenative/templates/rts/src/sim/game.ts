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
import { clearMovement, separateEntities, spawnExit, travelEntity } from "./movement.js";
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
  type EntityType,
  type IBank,
  type ICommandTarget,
  type IEntity,
  type IGameEvent,
  type IObstacle,
  type IOrderResult,
  type IPlayer,
  type IPoint,
  type IResourceNode,
  type IResult,
  type Order,
  SIM_STEP,
  TYPES,
  clamp,
  dist,
  formation,
  seeded,
} from "./types.js";
import { updateVision, visibleAt } from "./vision.js";

export interface IGameOptions {
  ai?: boolean;
  seed?: number;
  /** Injected worldgen stream. Defaults to the seeded mulberry32 the original world used. */
  random?: () => number;
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
  navRevision = 0;
  visionClock = 0;
  navMasks = new Map<string, Uint8Array>();
  commanders: CommanderAI[] = [];

  constructor({ ai = true, seed = 17, random }: IGameOptions = {}) {
    this.rng = random ?? seeded(seed);
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
    return this.entities.find((e) => e.id === id && e.hp > 0);
  }

  node(id: number): IResourceNode | undefined {
    return this.nodes.find((n) => n.id === id);
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
      resumeOrder: { kind: "idle" },
      weldClock: 0,
      working: false,
      hp: built ? d.hp : d.hp * 0.2,
      maxHp: d.hp,
      building: !!d.building,
      r: d.r,
      built,
      progress: built ? 1 : 0,
      angle: team === 0 ? Math.PI : 0,
      order: { kind: "idle" },
      orders: [],
      queue: [],
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

  supply(team = 0) {
    return supply(this, team);
  }

  canAfford(type: EntityType, team = 0): boolean {
    return canAfford(this, type, team);
  }

  pay(type: EntityType, team = 0): void {
    pay(this, type, team);
  }

  train(id: number, type: EntityType, team = 0): IOrderResult {
    return train(this, id, type, team);
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
  command(
    ids: number[],
    kind: string,
    target: ICommandTarget = {},
    team = 0,
    append = false,
  ): IOrderResult {
    if (this.result || this.paused || !Array.isArray(ids) || !this.players[team])
      return { ok: false };
    if (!COMMAND_KINDS.includes(kind)) return { ok: false };
    if (
      (kind === "move" || kind === "attackMove") &&
      (!Number.isFinite(target.x) || !Number.isFinite(target.z))
    ) {
      return { ok: false };
    }
    const units = [...new Set(ids)]
      .map((id) => this.get(id))
      .filter((e): e is IEntity => !!e && e.team === team && !e.garrisonId);
    const mobile = units.filter((e) => !e.building);
    const points = formation(
      mobile.length,
      clamp(target.x ?? 0, -HALF + 4, HALF - 4),
      clamp(target.z ?? 0, -HALF + 4, HALF - 4),
      mobile.some((e) => e.type === "tank") ? 2.7 : 2.05,
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
        order = { kind: "gather", id: n.id, phase: unit.carry ? "return" : "out" };
      } else if (kind === "garrison") {
        const bunker = target.id === undefined ? undefined : this.get(target.id);
        if (!bunker || !garrisonCheck(this, unit, bunker)) continue;
        order = { kind: "garrison", id: bunker.id };
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
        order = { kind: "repair", id: structure.id };
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
        order = { kind, id: ally.id };
      } else if (kind === "attack") {
        const enemy = target.id === undefined ? undefined : this.get(target.id);
        if (!enemy || !this.canAttack(unit, enemy) || !this.visibleAt(enemy.x, enemy.z, team))
          continue;
        order = { kind: "attack", id: enemy.id };
      } else if (kind === "stop") {
        order = { kind: "idle" };
      } else if (kind === "hold") {
        order = { kind: "hold" };
      } else {
        order = {
          kind: kind === "attackMove" ? "attackMove" : "move",
          x: clamp(point.x, -HALF + 3, HALF - 3),
          z: clamp(point.z, -HALF + 3, HALF - 3),
        };
      }
      if (append && kind !== "stop" && kind !== "hold" && unit.order.kind !== "idle") {
        if (unit.orders.length < 20) {
          unit.orders.push(order);
          accepted++;
        }
      } else {
        if (unit.order.kind === "construct") {
          abandonConstruction(this, this.get(unit.order.id), "Surveyor reassigned");
        }
        unit.order = order;
        unit.orders = [];
        clearMovement(unit);
        unit.targetId = null;
        unit.harvestTimer = 0;
        accepted++;
      }
    }
    return { ok: accepted > 0, count: accepted };
  }

  emit(type: string, data: Record<string, unknown> = {}): void {
    this.events.push({ type, time: this.time, ...data });
    if (this.events.length > 250) this.events.shift();
  }

  drainEvents(): IGameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
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
    for (const e of [...this.entities]) {
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
        this.entities.some(
          (b) => b.type === "core" && b.built && b.hp > 0 && b.team === e.team && dist(b, e) < 15,
        )
      ) {
        e.hp = Math.min(e.maxHp, e.hp + step * 4);
      }
      if (e.order.kind === "gather") {
        harvest(this, e, step);
        continue;
      }
      if (e.order.kind === "move") {
        if (this.travel(e, e.order.x, e.order.z, step, 0.45)) e.order = { kind: "idle" };
        continue;
      }
      const fought = d.heal
        ? updateSupport(this, e, step, e.order.kind === "hold")
        : this.fight(e, step, e.order.kind === "hold");
      if (!fought && e.order.kind === "attackMove") {
        if (this.travel(e, e.order.x, e.order.z, step, 0.6)) e.order = { kind: "idle" };
      }
    }
    this.separate(step);
    this.entities = this.entities.filter((e) => e.hp > 0);
    if (this.visionClock > 0.3) {
      this.updateVision();
      this.visionClock = 0;
    }
    if (this.ai) for (const commander of this.commanders) commander.update(this, step);
    for (const player of this.players) {
      if (player.eliminated) continue;
      if (!this.entities.some((e) => e.team === player.team && e.type === "core" && e.hp > 0)) {
        player.eliminated = true;
        this.emit("eliminated", { team: player.team, name: player.name });
        for (const e of this.own(player.team)) {
          this.damage(e, e.hp, player.team === 0 ? 1 : 0);
        }
      }
    }
    this.entities = this.entities.filter((e) => e.hp > 0);
    if (this.players.some((p) => p.eliminated)) this.updateVision();
    if (!this.entities.some((e) => e.team === 0 && e.type === "core")) {
      this.result = "defeat";
      this.emit("end", { result: "defeat" });
    } else if (!this.entities.some((e) => e.team > 0 && e.type === "core" && e.hp > 0)) {
      this.result = "victory";
      this.emit("end", { result: "victory" });
    }
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
    for (const o of this.obstacles) if (Math.hypot(x - o.x, z - o.z) < o.r + r) return true;
    for (const b of this.entities) {
      if (b.building && b.hp > 0 && Math.hypot(x - b.x, z - b.z) < b.r + r) return true;
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
