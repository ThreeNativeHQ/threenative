/** Resource-constrained commanders. Only visible enemies enter tactical memory. */

import type { Game } from "./game.js";
import { RESOURCE_SITES, STARTS } from "./terrain.js";
import {
  type BuildingType,
  type EntityType,
  type IEntity,
  type IPoint,
  type IResourceNode,
  TYPES,
  dist,
  seeded,
} from "./types.js";

export type CommanderState = "ESTABLISHING" | "DEFENDING" | "ATTACKING" | "REGROUPING" | "BUILDUP";

export interface ICommanderStats {
  trained: number;
  built: number;
  scouted: number;
  assaults: number;
  retreats: number;
  defenses: number;
  expansions: number;
  aircraft: number;
  garrisons: number;
}

export interface ICommanderMemory {
  id: number;
  type: EntityType;
  team: number;
  x: number;
  z: number;
  time: number;
}

export interface IExpansion {
  x: number;
  z: number;
  workers: number[];
  started: number;
}

const PRODUCTION_RANK: Readonly<Record<string, number>> = { starport: 0, factory: 1, barracks: 2 };

export class CommanderAI {
  readonly team: number;
  private readonly rng: () => number;
  private clock: number;
  state: CommanderState = "ESTABLISHING";
  private nextAttack: number;
  private lastOrders: number;
  private lastThreat: number;
  private scoutId: number | null = null;
  private scoutLeg = 0;
  private nextScout: number;
  force: number[] = [];
  private initialForce = 0;
  target: (IPoint & { team: number }) | null = null;
  expansion: IExpansion | null = null;
  private memory = new Map<number, ICommanderMemory>();
  private airThreatUntil = 0;
  private airTechAt: number;
  private searchLeg = 0;
  readonly stats: ICommanderStats = {
    trained: 0,
    built: 0,
    scouted: 0,
    assaults: 0,
    retreats: 0,
    defenses: 0,
    expansions: 0,
    aircraft: 0,
    garrisons: 0,
  };

  constructor(team: number, seed = 1, random?: () => number) {
    this.team = team;
    this.rng = random ?? seeded(seed);
    this.clock = team * 0.27;
    this.nextAttack = team === 1 ? 90 : 115;
    this.lastOrders = -100;
    this.lastThreat = -100;
    this.nextScout = 12 + team * 5;
    this.airTechAt = team === 1 ? 100 : 78;
  }

  update(game: Game, dt: number): void {
    this.clock -= dt;
    if (this.clock > 0 || game.paused || game.result || game.players[this.team]?.eliminated) return;
    this.clock = 1.2;
    const own = game.own(this.team);
    const cores = own.filter((e) => e.type === "core");
    const base = cores.find((e) => e.built) ?? cores[0];
    if (!base) return;
    const workers = own.filter((e) => e.type === "worker");
    let army = game.army(this.team).filter((e) => e.order.kind !== "garrison");
    const enemies = game.entities.filter(
      (e) =>
        e.team !== this.team && e.hp > 0 && !e.garrisonId && game.visibleAt(e.x, e.z, this.team),
    );
    if (enemies.some((e) => e.air)) this.airThreatUntil = game.time + 90;
    for (const enemy of enemies) {
      if (enemy.building) {
        this.memory.set(enemy.id, {
          id: enemy.id,
          type: enemy.type,
          team: enemy.team,
          x: enemy.x,
          z: enemy.z,
          time: game.time,
        });
      }
    }
    for (const [id, known] of this.memory) {
      if (game.visibleAt(known.x, known.z, this.team) && !enemies.some((e) => e.id === id)) {
        this.memory.delete(id);
      }
    }
    const rally = this.rallyPoint(base);
    const threat = enemies.filter(
      (e) => TYPES[e.type].damage && e.type !== "worker" && cores.some((c) => dist(c, e) < 34),
    );
    this.economy(game, own, cores, base, workers, army, rally, threat.length > 0);
    // Economy can reserve infantry as defenders. Never overwrite those orders.
    army = game.army(this.team).filter((e) => e.order.kind !== "garrison");
    if (threat.length) {
      this.lastThreat = game.time;
      if (this.state !== "DEFENDING") {
        this.stats.defenses++;
        this.lastOrders = -100;
      }
      this.state = "DEFENDING";
      if (game.time - this.lastOrders > 3.5) {
        const closest = threat.sort((a, b) => dist(a, base) - dist(b, base))[0];
        if (closest)
          game.command(
            army.map((e) => e.id),
            "attackMove",
            closest,
            this.team,
          );
        this.lastOrders = game.time;
      }
      return;
    }
    if (this.state === "DEFENDING" && game.time - this.lastThreat > 9) {
      this.regroup(game, army, rally);
    }
    if (this.state === "ATTACKING") {
      this.attack(game, army, rally, enemies);
      return;
    }
    if (this.state === "REGROUPING" && game.time < this.nextAttack) return;
    this.state = "BUILDUP";
    this.scout(game, army, base, rally, enemies);
    if (game.time >= this.nextAttack && army.length >= 9) {
      const preferred = this.team === 1 ? 0 : 1;
      const targets = STARTS.filter(
        (s) => s.team !== this.team && !game.players[s.team]?.eliminated,
      );
      targets.sort(
        (a, b) =>
          dist(base, a) * (a.team === preferred ? 0.65 : 1) -
          dist(base, b) * (b.team === preferred ? 0.65 : 1),
      );
      const target = targets[0];
      if (!target) return;
      const force = army.filter((e) => e.id !== this.scoutId).slice(1);
      this.force = force.map((e) => e.id);
      this.initialForce = force.length;
      this.target = { x: target.x, z: target.z, team: target.team };
      game.command(this.force, "attackMove", this.target, this.team);
      this.state = "ATTACKING";
      this.lastOrders = game.time;
      this.nextAttack = game.time + 85;
      this.stats.assaults++;
      game.emit("assault", {
        team: this.team,
        name: game.players[this.team]?.name ?? "",
        count: force.length,
        targetTeam: target.team,
        x: base.x,
        z: base.z,
      });
      return;
    }
    const idle = army.filter((e) => e.id !== this.scoutId && e.order.kind === "idle");
    if (idle.length)
      game.command(
        idle.map((e) => e.id),
        "attackMove",
        rally,
        this.team,
      );
  }

  /** Push to the next known building, or sweep to an unexplored expansion site. */
  private attack(game: Game, army: IEntity[], rally: IPoint, enemies: IEntity[]): void {
    const target = this.target;
    if (!target) return;
    const surviving = this.force
      .map((id) => game.get(id))
      .filter((e): e is IEntity => !!e && !e.garrisonId && e.order.kind !== "garrison");
    const health =
      surviving.reduce((sum, e) => sum + e.hp / e.maxHp, 0) / Math.max(1, surviving.length);
    if (
      surviving.length < Math.max(3, this.initialForce * 0.45) ||
      health < 0.36 ||
      game.players[target.team]?.eliminated
    ) {
      this.regroup(game, army, rally);
      return;
    }
    if (game.time - this.lastOrders <= 16) return;
    const known = [...this.memory.values()]
      .filter((e) => e.team === target.team)
      .sort(
        (a, b) =>
          Number(b.type === "core") - Number(a.type === "core") ||
          dist(a, target) - dist(b, target),
      );
    let goal: IPoint = known[0] ?? target;
    if (
      !known.length &&
      surviving.some((e) => dist(e, goal) < 18) &&
      !enemies.some((e) => e.team === target.team && e.building)
    ) {
      const sites = RESOURCE_SITES.slice(3);
      const next = sites[this.searchLeg++ % sites.length];
      if (next) goal = { x: next.baseX, z: next.baseZ };
    }
    game.command(
      surviving.map((e) => e.id),
      "attackMove",
      goal,
      this.team,
    );
    this.lastOrders = game.time;
  }

  private rallyPoint(base: IEntity): IPoint {
    const d = Math.hypot(base.x, base.z) || 1;
    return { x: base.x - (base.x / d) * 18, z: base.z - (base.z / d) * 18 };
  }

  private regroup(game: Game, army: IEntity[], rally: IPoint): void {
    game.command(
      army.filter((e) => !e.garrisonId && e.order.kind !== "garrison").map((e) => e.id),
      "move",
      rally,
      this.team,
    );
    this.state = "REGROUPING";
    this.nextAttack = Math.max(game.time + 30, this.nextAttack);
    this.stats.retreats++;
    this.force = [];
    this.scoutId = null;
  }

  private tryBuild(
    game: Game,
    type: BuildingType,
    x: number,
    z: number,
    builderId: number | null = null,
  ): boolean {
    if (!game.canAfford(type, this.team)) return false;
    if (!game.own(this.team).some((e) => e.type === "worker" && e.order.kind !== "construct")) {
      return false;
    }
    const p = game.findBuildSpot(type, x, z, this.team);
    if (!p) return false;
    const result = game.build(type, p.x, p.z, this.team, builderId);
    if (result.ok) this.stats.built++;
    return result.ok;
  }

  private trainUnit(game: Game, building: IEntity | undefined, type: EntityType): boolean {
    if (!building || !game.train(building.id, type, this.team).ok) return false;
    this.stats.trained++;
    if (TYPES[type].air) this.stats.aircraft++;
    return true;
  }

  private aircraftChoice(
    own: IEntity[],
    queued: (type: EntityType) => number,
    airThreat: boolean,
  ): EntityType {
    const fighters = own.filter((u) => u.type === "fighter").length + queued("fighter");
    const bombers = own.filter((u) => u.type === "bomber").length + queued("bomber");
    const escorts = Math.max(
      this.team === 2 ? 2 : 1,
      airThreat ? 3 : 0,
      Math.ceil((bombers + 1) * (this.team === 2 ? 1.5 : 1)),
    );
    return fighters < escorts ? "fighter" : "bomber";
  }

  private economy(
    game: Game,
    own: IEntity[],
    cores: IEntity[],
    base: IEntity,
    workers: IEntity[],
    army: IEntity[],
    rally: IPoint,
    underAttack: boolean,
  ): void {
    const team = this.team;
    const bank = game.players[team]?.resources;
    if (!bank) return;
    const banks = game.supply(team);
    const structures = own.filter((e) => e.building);
    const count = (type: EntityType): number => structures.filter((e) => e.type === type).length;
    const queued = (type: EntityType): number =>
      structures.reduce((n, b) => n + b.queue.filter((q) => q.type === type).length, 0);
    const airThreat = this.airThreatUntil > game.time;
    if (
      banks.cap - banks.used < 6 &&
      banks.cap < 120 &&
      !structures.some((e) => e.type === "relay" && !e.built)
    ) {
      this.tryBuild(game, "relay", base.x - 11, base.z + 6);
    }
    if (!count("refinery")) {
      const gas = game.nodes
        .filter((n) => n.kind === "gas" && n.amount > 0)
        .sort((a, b) => dist(a, base) - dist(b, base))[0];
      if (gas) this.tryBuild(game, "refinery", gas.x, gas.z);
    }
    if (!count("barracks")) this.tryBuild(game, "barracks", base.x + 13, base.z - 3);
    if (!count("factory") && game.time > 18)
      this.tryBuild(game, "factory", base.x + 3, base.z + 12);
    // Respond only to air actually seen by this faction, not hidden entity data.
    if (airThreat && count("antiair") < 2 && bank.ore >= TYPES.antiair.ore) {
      this.tryBuild(game, "antiair", rally.x + 5, rally.z - 3);
    }
    const airTech =
      game.time > this.airTechAt &&
      !count("starport") &&
      structures.some((e) => e.type === "factory" && e.built);
    if (airTech) this.tryBuild(game, "starport", base.x - 2, base.z + 16);
    if (game.time > 75 && count("barracks") < (team === 1 ? 2 : 1) && bank.ore > 400 && !airTech) {
      this.tryBuild(game, "barracks", base.x + 19, base.z + 10);
    }
    if (game.time > 65 && !count("bunker") && bank.ore > 290 && !airTech) {
      this.tryBuild(game, "bunker", rally.x - 3, rally.z - 3);
    }
    if (game.time > 160 && !count("antiair") && bank.ore > 320) {
      this.tryBuild(game, "antiair", base.x - 10, base.z + 13);
    }
    if (underAttack && count("turret") < 2 && bank.ore > 300 && !airThreat) {
      this.tryBuild(game, "turret", rally.x, rally.z);
    }
    if (workers.length + queued("worker") < Math.min(22, 15 + 3 * (cores.length - 1))) {
      for (const c of cores.filter((c) => c.built && c.queue.length === 0)) {
        if (this.trainUnit(game, c, "worker")) break;
      }
    }
    this.assignWorkers(game, workers, structures, cores);
    this.assignGarrisons(game, structures, army, underAttack);
    const damaged = structures.find((b) => b.built && b.hp < b.maxHp * 0.7);
    if (damaged && bank.ore > 120 && !workers.some((w) => w.order.kind === "repair")) {
      const worker = workers
        .filter((w) => w.order.kind === "gather" || w.order.kind === "idle")
        .sort((a, b) => dist(a, damaged) - dist(b, damaged))[0];
      if (worker) game.command([worker.id], "repair", { id: damaged.id }, team);
    }
    const reserve =
      !underAttack && game.time > 250 && cores.length < 2 && army.length >= 12 ? 430 : 0;
    this.expand(game, base, cores, workers, army, underAttack, reserve);
    const production = structures
      .filter((b) => b.built && ["barracks", "factory", "starport"].includes(b.type))
      .sort((a, b) => (PRODUCTION_RANK[a.type] ?? 0) - (PRODUCTION_RANK[b.type] ?? 0));
    for (const building of production) {
      building.rally = rally;
      if (building.queue.length >= 2 || army.length >= 40) continue;
      let type: EntityType = "ranger";
      if (building.type === "starport") {
        type = this.aircraftChoice(own, queued, airThreat);
      } else if (building.type === "factory") {
        const tanks = army.filter((e) => e.type === "tank").length;
        const hovers = army.filter((e) => e.type === "hover").length;
        type =
          airThreat && own.filter((e) => e.type === "flak").length + queued("flak") < 3
            ? "flak"
            : team === 2
              ? hovers < tanks * 2 + 3
                ? "hover"
                : "tank"
              : tanks < hovers + 3
                ? "tank"
                : "hover";
      } else if (
        game.time > 75 &&
        army.length >= 7 &&
        army.filter((e) => e.type === "medic").length + queued("medic") <
          Math.ceil(army.length / 12)
      ) {
        type = "medic";
      }
      const factoryReserve = !count("factory") && game.time > 12 ? TYPES.factory.ore : 0;
      const airReserve = airTech ? TYPES.starport.ore : 0;
      const idleSkyport =
        building.type !== "starport" &&
        structures.some((b) => b.type === "starport" && b.built && b.queue.length === 0);
      const aircraft = idleSkyport ? TYPES[this.aircraftChoice(own, queued, airThreat)] : null;
      const aircraftReserve = aircraft?.ore ?? 0;
      const gasReserve = Math.max(airTech ? TYPES.starport.gas : 0, aircraft?.gas ?? 0);
      const preferred: EntityType = team === 2 ? "hover" : "tank";
      const vehicleReserve =
        building.type === "barracks" &&
        army.filter((e) => e.type === preferred).length < 3 &&
        structures.some((e) => e.type === "factory" && e.built && e.queue.length === 0) &&
        bank.gas >= TYPES[preferred].gas
          ? TYPES[preferred].ore
          : 0;
      if (
        bank.ore >=
          TYPES[type].ore +
            Math.max(reserve, factoryReserve, vehicleReserve, airReserve, aircraftReserve) &&
        bank.gas >= TYPES[type].gas + gasReserve
      ) {
        this.trainUnit(game, building, type);
      }
    }
  }

  private assignWorkers(
    game: Game,
    workers: IEntity[],
    structures: IEntity[],
    cores: IEntity[],
  ): void {
    const gasSites = game.nodes.filter(
      (n) =>
        n.kind === "gas" &&
        n.amount > 0 &&
        structures.some((b) => b.type === "refinery" && b.built && dist(b, n) < 3),
    );
    const expansionIds = this.expansion?.workers ?? [];
    for (const worker of workers) {
      if (
        expansionIds.includes(worker.id) ||
        worker.order.kind === "construct" ||
        worker.order.kind === "repair"
      )
        continue;
      const gasWorkers = workers.filter(
        (w) => w.order.kind === "gather" && game.node(w.order.id)?.kind === "gas",
      ).length;
      if (
        worker.order.kind !== "idle" &&
        !(
          gasWorkers < 4 &&
          worker.order.kind === "gather" &&
          game.node(worker.order.id)?.kind === "ore" &&
          worker.id % 3 === 0
        )
      ) {
        continue;
      }
      let nodes = game.nodes.filter(
        (n) => n.kind === "ore" && n.amount > 0 && cores.some((c) => c.built && dist(c, n) < 35),
      );
      if (gasSites.length && gasWorkers < 4) nodes = gasSites;
      if (!nodes.length) continue;
      const claim = (w: IEntity, id: number): boolean =>
        (w.order.kind === "gather" || w.order.kind === "repair" || w.order.kind === "construct") &&
        w.order.id === id;
      const score = (n: IResourceNode): number =>
        dist(n, worker) + workers.filter((w) => claim(w, n.id)).length * 4;
      nodes.sort((a, b) => score(a) - score(b));
      const nearest = nodes[0];
      if (nearest) game.command([worker.id], "gather", { id: nearest.id }, this.team);
    }
  }

  private assignGarrisons(
    game: Game,
    structures: IEntity[],
    army: IEntity[],
    underAttack: boolean,
  ): void {
    for (const bunker of structures.filter((b) => b.type === "bunker" && b.built)) {
      const incoming = game
        .own(this.team)
        .filter((e) => e.order.kind === "garrison" && e.order.id === bunker.id).length;
      const needed = (underAttack ? 4 : 2) - bunker.garrison.length - incoming;
      if (needed <= 0) continue;
      const units = army
        .filter(
          (e) =>
            e.type === "ranger" &&
            e.order.kind !== "garrison" &&
            dist(e, bunker) < 28 &&
            (this.state !== "ATTACKING" || !this.force.includes(e.id)),
        )
        .sort((a, b) => dist(a, bunker) - dist(b, bunker))
        .slice(0, needed);
      if (
        units.length &&
        game.command(
          units.map((e) => e.id),
          "garrison",
          { id: bunker.id },
          this.team,
        ).ok
      ) {
        this.stats.garrisons += units.length;
      }
    }
  }

  private expand(
    game: Game,
    base: IEntity,
    cores: IEntity[],
    workers: IEntity[],
    army: IEntity[],
    underAttack: boolean,
    reserve: number,
  ): void {
    if (cores.length > 1) {
      this.expansion = null;
      return;
    }
    if (underAttack || !reserve || workers.length < 10) return;
    if (!this.expansion && (game.players[this.team]?.resources.ore ?? 0) > 420) {
      const sites = RESOURCE_SITES.slice(3).filter(
        (s) =>
          ![...this.memory.values()].some(
            (e) => e.type === "core" && Math.hypot(e.x - s.baseX, e.z - s.baseZ) < 25,
          ),
      );
      sites.sort(
        (a, b) =>
          Math.hypot(a.baseX - base.x, a.baseZ - base.z) -
          Math.hypot(b.baseX - base.x, b.baseZ - base.z),
      );
      const site = sites[0];
      const chosen = workers
        .filter((w) => {
          const order = w.order;
          if (order.kind === "construct" || order.kind === "repair") return false;
          if (order.kind === "gather" && game.node(order.id)?.kind === "gas") return false;
          return true;
        })
        .slice(0, 2);
      if (!site || !chosen.length) return;
      this.expansion = {
        x: site.baseX,
        z: site.baseZ,
        workers: chosen.map((w) => w.id),
        started: game.time,
      };
      game.command(this.expansion.workers, "move", this.expansion, this.team);
    }
    const expansion = this.expansion;
    if (!expansion) return;
    const builders = expansion.workers
      .map((id) => game.get(id))
      .filter((w): w is IEntity => !!w && w.order.kind !== "construct");
    if (!builders.length || game.time - expansion.started > 100) {
      this.expansion = null;
      return;
    }
    const ready = builders.find((w) => dist(w, expansion) < 11);
    if (
      ready &&
      game.canAfford("core", this.team) &&
      this.tryBuild(game, "core", expansion.x, expansion.z, ready.id)
    ) {
      this.stats.expansions++;
      // Do not stop the Surveyor now bound to the new core. Other escorts may mine.
      for (const worker of builders) {
        if (worker.id !== ready.id) game.command([worker.id], "stop", {}, this.team);
      }
      this.expansion = null;
    }
  }

  private scout(
    game: Game,
    army: IEntity[],
    base: IEntity,
    rally: IPoint,
    enemies: IEntity[],
  ): void {
    if (game.time < this.nextScout) return;
    let scout = this.scoutId === null ? undefined : game.get(this.scoutId);
    if (!scout || scout.garrisonId || scout.order.kind === "garrison") {
      scout =
        army.find((e) => e.type === "fighter") ??
        army.find((e) => e.type === "hover") ??
        army.filter((e) => TYPES[e.type].damage).at(-1);
      if (!scout || army.length < 5) return;
      this.scoutId = scout.id;
    }
    const danger = enemies.some(
      (e) => game.canAttack(e, scout) && dist(e, scout) < (TYPES[e.type].range ?? 0) + 5,
    );
    if (danger || scout.hp < scout.maxHp * 0.5) {
      game.command([scout.id], "move", rally, this.team);
      this.scoutId = null;
      this.nextScout = game.time + 24;
      return;
    }
    if (scout.order.kind === "idle" || this.scoutLeg === 0) {
      const routes =
        this.team === 1
          ? [
              [28, -42],
              [15, 2],
              [-21, 31],
              [-43, 47],
            ]
          : [
              [-52, -30],
              [-56, 3],
              [-46, 32],
              [-53, 48],
            ];
      const point = routes[this.scoutLeg % routes.length];
      if (!point) return;
      game.command([scout.id], "move", { x: point[0], z: point[1] }, this.team);
      this.scoutLeg++;
      this.stats.scouted++;
    }
  }
}
