import { describe, expect, it } from "vitest";
import { Game } from "../templates/rts/src/sim/game.js";
import { type EntityType, TYPES, dist } from "../templates/rts/src/sim/types.js";

/** Three cores and one idle Surveyor: every other unit removed so a rule is readable in state. */
function sandbox(seed = 3): Game {
  const game = new Game({ ai: false, seed });
  const worker = game.own(0).find((e) => e.type === "worker");
  game.entities = [...game.entities.filter((e) => e.type === "core"), ...(worker ? [worker] : [])];
  return game;
}

function stepsUntil(game: Game, done: () => boolean, limit = 4000): number {
  for (let i = 0; i < limit && !done(); i++) game.step();
  return game.time;
}

describe("rts navigation", () => {
  it("routes around a wall through the only gap in it", () => {
    const game = new Game({ ai: false, seed: 5 });
    game.obstacles = [];
    for (let z = -100; z <= 100; z += 4) {
      if (z > 30 && z < 50) continue;
      game.obstacles.push({ x: 0, z, r: 3, kind: "rock" });
    }
    game.navRevision++;

    const route = game.pathfind({ x: -40, z: 0 }, { x: 40, z: 0 });

    expect(route.length).toBeGreaterThan(2);
    expect(
      route.every((p) => Math.abs(p.x) > 4 || (p.z > 30 && p.z < 50)),
      "no waypoint inside the wall",
    ).toBe(true);
    expect(
      route.some((p) => Math.abs(p.x) <= 4 && p.z > 30 && p.z < 50),
      "the route goes through the gap",
    ).toBe(true);
  });

  it("returns no route when the goal is sealed inside a compound", () => {
    const game = new Game({ ai: false, seed: 5 });
    game.obstacles = [];
    for (let i = -20; i <= 20; i += 4) {
      const walls: [number, number][] = [
        [50, 70 + i],
        [90, 70 + i],
        [70 + i, 50],
        [70 + i, 90],
      ];
      for (const [x, z] of walls) {
        game.obstacles.push({ x, z, r: 4, kind: "rock" });
      }
    }
    game.navRevision++;

    expect(game.pathfind({ x: -40, z: 0 }, { x: 70, z: 70 })).toEqual([]);
  });
});

describe("rts economy", () => {
  it("has a worker gather a load of ore and bank it", () => {
    const game = sandbox(9);
    const worker = game.own(0).find((e) => e.type === "worker");
    if (!worker) throw new Error("the seeded start has no Surveyor");
    const node = game.nodes
      .filter((n) => n.kind === "ore")
      .sort((a, b) => dist(a, worker) - dist(b, worker))[0];
    if (!node) throw new Error("the seeded world has no ore");
    const before = node.amount;
    const banked = game.players[0]?.resources.ore ?? 0;
    expect(game.command([worker.id], "gather", { id: node.id }).ok).toBe(true);

    stepsUntil(game, () => (game.players[0]?.gathered.ore ?? 0) > 0);

    expect(before - node.amount).toBe(10);
    expect((game.players[0]?.resources.ore ?? 0) - banked).toBe(10);
    expect(game.players[0]?.gathered.ore).toBe(10);
  });
});

describe("rts construction", () => {
  it("pays up front, finishes on time, and refunds three quarters when cancelled", () => {
    const game = sandbox(11);
    const core = game.own(0).find((e) => e.type === "core");
    if (!core) throw new Error("the seeded start has no core");
    const spot = game.findBuildSpot("barracks", core.x, core.z, 0);
    if (!spot) throw new Error("no buildable spot next to the core");
    const cost = TYPES.barracks.ore;

    const started = game.build("barracks", spot.x, spot.z, 0);
    expect(started.ok).toBe(true);
    expect(game.players[0]?.resources.ore).toBe(700 - cost);
    const site = started.id === undefined ? undefined : game.get(started.id);
    expect(site?.built).toBe(false);
    expect(site?.progress).toBe(0);

    const began = game.time;
    stepsUntil(game, () => site?.built === true, 4000);

    expect(site?.built).toBe(true);
    expect(site?.progress).toBe(1);
    expect(game.time - began).toBeGreaterThanOrEqual(TYPES.barracks.time);

    const ore = game.players[0]?.resources.ore ?? 0;
    const second = game.findBuildSpot("barracks", core.x + 6, core.z - 4, 0);
    if (!second) throw new Error("no second buildable spot");
    const cancelled = game.build("barracks", second.x, second.z, 0);
    expect(cancelled.ok).toBe(true);
    expect(game.players[0]?.resources.ore).toBe(ore - cost);
    expect(game.cancelBuild(cancelled.id ?? -1, 0).ok).toBe(true);
    expect((game.players[0]?.resources.ore ?? 0) - (ore - cost)).toBeCloseTo(cost * 0.75, 6);
    expect(game.get(cancelled.id ?? -1)).toBeUndefined();
  });
});

describe("rts production", () => {
  it("trains the queue in order and refuses work past the supply cap", () => {
    const game = sandbox(13);
    const core = game.own(0).find((e) => e.type === "core");
    if (!core) throw new Error("the seeded start has no core");
    const barracks = game.spawn("barracks", 0, core.x + 12, core.z - 2);
    const player = game.players[0];
    if (!player) throw new Error("the seeded game has no team 0");
    player.resources.ore = 100_000;
    player.resources.gas = 100_000;

    // One Surveyor plus seventeen more fills the Command Core's 18 supply exactly.
    for (let i = 0; i < 17; i++) game.spawn("worker", 0, core.x - 2 - i * 1.7, core.z);
    expect(game.supply(0)).toEqual({ used: 18, cap: 18 });
    expect(game.train(barracks.id, "ranger").message).toBe("Supply blocked. Build a Supply Relay.");
    expect(barracks.queue).toHaveLength(0);

    game.spawn("relay", 0, core.x - 7, core.z - 10);
    expect(game.train(barracks.id, "ranger").ok).toBe(true);
    expect(game.train(barracks.id, "medic").ok).toBe(true);
    expect(game.train(barracks.id, "ranger").ok).toBe(true);
    expect(barracks.queue.map((q) => q.type)).toEqual(["ranger", "medic", "ranger"]);

    const trained: string[] = [];
    for (let i = 0; i < 2000 && trained.length < 3; i++) {
      game.step();
      for (const event of game.drainEvents()) {
        if (event.type === "trained") trained.push(String(event.name));
      }
    }
    expect(trained).toEqual([TYPES.ranger.name, TYPES.medic.name, TYPES.ranger.name]);
    expect(barracks.queue).toHaveLength(0);
  });
});

describe("rts combat", () => {
  it("kills a worker in the number of hits its health and damage imply", () => {
    const game = sandbox(17);
    const core = game.own(0).find((e) => e.type === "core");
    if (!core) throw new Error("the seeded start has no core");
    const ranger = game.spawn("ranger", 0, core.x + 20, core.z);
    const victim = game.spawn("worker", 1, core.x + 24, core.z);
    let shots = 0;

    for (let i = 0; i < 400 && victim.hp > 0; i++) {
      game.step();
      shots += game
        .drainEvents()
        .filter((e) => e.type === "shot" && e.targetId === victim.id).length;
    }

    expect(victim.hp).toBe(0);
    expect(shots).toBe(Math.ceil(TYPES.worker.hp / (TYPES.ranger.damage ?? 0)));
  });

  it("makes an explicit attack order the unit's order and keeps it while the target lives", () => {
    // The gesture the playtest drives reaches the rules through `command`; this is the branch
    // behind "right-click a contact", which a scenario cannot aim: a contact only becomes
    // pickable once it is in sight, and a visible contact is a moving one, so no fixed pixel in a
    // scenario lands on it. The rule is therefore proved here, where the contact can be placed.
    const game = sandbox(23);
    const core = game.own(0).find((e) => e.type === "core");
    if (!core) throw new Error("the seeded start has no core");
    const ranger = game.spawn("ranger", 0, core.x + 8, core.z);
    const contact = game.spawn("tank", 1, core.x + 16, core.z);
    game.updateVision();

    expect(game.command([ranger.id], "attack", { id: contact.id })).toMatchObject({ ok: true });
    expect(ranger.order).toEqual({ kind: "attack", id: contact.id });

    game.step();

    // A ranger's reach is 8.5 m and the contact stands 8 m away, so the order survives the shot
    // rather than falling back to idle the moment the target leaves reach.
    expect(ranger.order).toEqual({ kind: "attack", id: contact.id });
    expect(ranger.targetId).toBe(contact.id);
    expect(contact.hp).toBeLessThan(contact.maxHp);
  });

  it("keeps the declared air and ground target tables", () => {
    const game = sandbox(19);
    const cases: [EntityType, EntityType, boolean][] = [
      ["ranger", "ranger", true],
      ["ranger", "fighter", true],
      ["flak", "fighter", true],
      ["flak", "ranger", false],
      ["bomber", "ranger", true],
      ["bomber", "fighter", false],
      ["fighter", "fighter", true],
      ["fighter", "ranger", true],
      ["worker", "ranger", true],
      ["worker", "fighter", false],
      ["medic", "ranger", false],
      ["bunker", "ranger", false],
    ];

    for (const [attacker, target, expected] of cases) {
      const a = game.spawn(attacker, 0, -80, 0);
      const t = game.spawn(target, 1, -76, 0);
      const d = TYPES[attacker];
      const fromTable =
        !!d.damage && (d.targets ?? ["ground"]).includes(TYPES[target].air ? "air" : "ground");
      expect(fromTable, `${attacker} -> ${target}`).toBe(expected);
      expect(game.canAttack(a, t), `${attacker} -> ${target}`).toBe(expected);
    }
  });
});

describe("rts determinism", () => {
  const play = (seed: number) => {
    const game = new Game({ ai: true, seed });
    let midway = "";
    for (let i = 0; i < 6000; i++) {
      game.step();
      if (i === 1999) midway = game.serialize();
    }
    return {
      midway,
      final: game.serialize(),
      time: game.time,
      result: game.result,
      kills: game.kills,
    };
  };

  it("replays the same seeded AI match twice and diverges on another seed", () => {
    const first = play(18);
    // 6000 fixed 0.05 s steps of two commanders fighting each other. The seeded start leaves
    // team 0 to the player and it falls first, so everything after that is frozen: comparing
    // mid-match is what proves the two replays really ran the same battle, not the same pause.
    expect(first.time).toBeGreaterThan(100);
    expect(first.kills).toBeGreaterThan(0);
    expect(first.result).toBe("defeat");

    const second = play(18);
    expect(second.midway).toBe(first.midway);
    expect(second.final).toBe(first.final);
    expect(play(19).midway).not.toBe(first.midway);
  }, 300_000);
});
