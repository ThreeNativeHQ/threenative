import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Game } from "../templates/rts/src/sim/game.js";
import { clearMovement, travelEntity } from "../templates/rts/src/sim/movement.js";
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

  it("reads a reachable route from the unit outward, with every waypoint filled", () => {
    const game = new Game({ ai: false, seed: 5 });
    game.obstacles = [];
    for (let z = -100; z <= 100; z += 4) {
      if (z > 30 && z < 50) continue;
      game.obstacles.push({ x: 0, z, r: 3, kind: "rock" });
    }
    game.navRevision++;
    const from = { x: -40, z: 0 };
    const to = { x: 40, z: 0 };

    const route = game.pathfind(from, to);

    // Two failures hide behind "the route went through the gap". A route whose parent chain is
    // written goal-first still contains every cell of the right path, in the right place, and walks
    // the unit the wrong way: the giveaway is a hop longer than one cell diagonal (2·√2 m here),
    // between the first waypoint and the second. A route with a hole in it — the chain written to
    // the wrong index — reads `undefined` where a point belongs.
    const first = route[0];
    const last = route[route.length - 1];
    expect(first, "the route has a first waypoint").toBeDefined();
    expect(last, "the route has a last waypoint").toBeDefined();
    if (!first || !last) throw new Error("the route has no endpoints");
    expect(
      route.every((p) => p !== undefined),
      "every waypoint is a point",
    ).toBe(true);
    let widest = 0;
    for (let i = 1; i < route.length; i++) {
      widest = Math.max(widest, dist(route[i - 1] ?? from, route[i] ?? to));
    }
    expect(
      widest,
      "consecutive waypoints are one cell apart, so the route reads start-to-goal",
    ).toBeLessThanOrEqual(2 * Math.SQRT2 + 0.001);
    expect(dist(first, from), "the route starts at the unit").toBeLessThan(dist(last, from));
    expect(dist(last, to), "the route ends at the goal").toBeLessThan(0.5);
  });
});

describe("rts path goal cache", () => {
  it("keeps one goal across steps and plans again after the order moves or is cleared", () => {
    const game = new Game({ ai: false, seed: 49 });
    game.entities = game.entities.filter((e) => e.type === "core");
    game.obstacles = [];
    game.navRevision++;
    const unit = game.spawn("tank", 0, -60, 0);

    expect(travelEntity(game, unit, 40, 40, 0.05, 0.5)).toBe(false);
    const goal = unit.pathGoal;
    expect(goal, "a travelling unit keeps the goal its path was planned for").not.toBe(null);
    // The goal is the entity's own record rather than the per-call scratch: aliased to the scratch
    // it would follow every call, so every step would read as a new destination and replan.
    expect(goal).not.toBe(unit.goalPoint);
    const revision = unit.pathRevision;
    const end = unit.pathEnd;
    for (let i = 0; i < 20; i++) travelEntity(game, unit, 40, 40, 0.05, 0.5);
    expect(unit.pathGoal, "the goal survives twenty steps toward the same place").toBe(goal);
    expect(unit.pathRevision, "an unchanged goal does not replan").toBe(revision);
    expect(unit.pathEnd, "the route's end is cached with it").toBe(end);

    travelEntity(game, unit, -40, 40, 0.05, 0.5);
    expect(unit.pathGoal, "a new order plans a new goal").toBe(goal);
    expect(
      unit.pathGoal && `${unit.pathGoal.x},${unit.pathGoal.z}`,
      "the goal is the new one",
    ).toBe("-40,40");
    expect(unit.pathRevision, "a new goal is a replan").toBe(game.navRevision);

    clearMovement(unit);
    expect(unit.pathGoal, "clearing the path drops the goal").toBe(null);
    expect(unit.pathEnd).toBe(null);
    travelEntity(game, unit, -40, 40, 0.05, 0.5);
    expect(unit.pathGoal, "the next step plans again after a clear").not.toBe(null);
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

// The event records are reused slots rather than a record per event, which is only safe because of
// three properties, and each of them is a way the reuse could go wrong. A batch is only ever read
// between a drain and the next one, so these are about the lifetime rather than the contents.
describe("rts event queue", () => {
  const game_ = () => sandbox(3);

  it("keeps two events in one batch distinct and in order", () => {
    const game = game_();
    game.emit("trained", { id: 11, name: "Ranger", team: 0 });
    game.emit("complete", { id: 22, name: "Barracks", team: 0 });
    const batch = game.drainEvents();
    // One shared record for both would make these the same event twice, which is the failure a
    // single reused slot produces and the reason there are 250 distinct ones.
    expect(batch.map((e) => e.type)).toEqual(["trained", "complete"]);
    expect(batch.map((e) => e.id)).toEqual([11, 22]);
    expect(batch.map((e) => e.name)).toEqual(["Ranger", "Barracks"]);
  });

  it("drops the oldest event past 250, keeping the newest 250 in order", () => {
    const game = game_();
    for (let i = 0; i < 260; i++) game.emit("trained", { id: i, name: `u${i}`, team: 0 });
    const batch = game.drainEvents();
    expect(batch).toHaveLength(250);
    // The overflow rule is unchanged: the first ten are gone and nothing is duplicated or reordered.
    expect(batch[0]?.id).toBe(10);
    expect(batch[249]?.id).toBe(259);
    expect(batch.map((e) => e.id)).toEqual(Array.from({ length: 250 }, (_, i) => i + 10));
  });

  it("does not overwrite a batch that was returned but not yet read again", () => {
    const game = game_();
    game.emit("trained", { id: 1, name: "first", team: 0 });
    const first = game.drainEvents();
    // The consumer is still holding the first batch. Everything emitted now must land elsewhere.
    for (let i = 0; i < 40; i++) game.emit("shot", { id: 100 + i, team: 1 });
    expect(first.map((e) => e.id)).toEqual([1]);
    expect(first[0]?.name).toBe("first");
    // ...and the next drain is the one that ends that promise, handing over the 40 shots.
    expect(game.drainEvents().map((e) => e.id)).toEqual(
      Array.from({ length: 40 }, (_, i) => 100 + i),
    );
  });

  it("clears a field the next event does not set, so a slot never reports a stale value", () => {
    const game = game_();
    game.emit("death", { id: 5, x: 1, z: 2, name: "Ranger", team: 0 });
    // The next event is 250-1 events later only in the full queue, so drain to free the slot: the
    // same slot comes back on the bank swap and must not still be the death event's.
    game.drainEvents();
    game.emit("end", { result: "victory" });
    const [ended] = game.drainEvents();
    expect(ended?.type).toBe("end");
    expect(ended?.result).toBe("victory");
    // These were set on the reused slot by the death event and must not survive into the end event.
    expect(ended?.name).toBeUndefined();
    expect(ended?.x).toBeUndefined();
    expect(ended?.team).toBeUndefined();
  });

  it("does not let a caller's reused payload alias the queue", () => {
    const game = game_();
    // The copy has to be immediate: a payload the caller keeps writing to must not be what the
    // consumer later reads out of the batch.
    const scratch = { id: 1, name: "alpha", team: 0 };
    game.emit("trained", scratch);
    scratch.id = 2;
    scratch.name = "beta";
    game.emit("trained", scratch);
    const batch = game.drainEvents();
    expect(batch.map((e) => e.name)).toEqual(["alpha", "beta"]);
    expect(batch.map((e) => e.id)).toEqual([1, 2]);
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

  // Replaying a seed against itself only proves the match is deterministic, not that it is the
  // same match. An allocation rewrite passed the case above and still ended seed 18 at 149.6 s
  // instead of 230.95 s, because two commander decisions were transposed on the way to being
  // allocation-free — the army took its defender and then attacked the nearest shed. These are the
  // pre-rewrite states, so any semantic change to the rules shows up here as a different hash
  // rather than as a slower, differently-shaped game nobody notices.
  //
  // What `serialize()` covers is the played state: every entity's order, queue, path and supplies,
  // the resource totals and the built flags. It does not cover the RNG's internal position, a
  // commander's private state, or the event stream, so this is a fence on the match the player saw,
  // not a claim that the two sources execute identical machine instructions.
  describe("the match is the one that was played before the rewrite", () => {
    const digest = (game: Game) =>
      createHash("sha256").update(game.serialize()).digest("hex").slice(0, 16);

    const CHECKPOINTS = [
      [1000, "0496d97bfe4c5132"],
      [2000, "cf946d59db620c5d"],
      [3000, "4f30b8a55d355cb2"],
      [6000, "6d79264916495caa"],
    ] as const;

    it("replays seed 18 to the same match, step for step", () => {
      const game = new Game({ ai: true, seed: 18 });
      const seen = new Map<number, string>();
      for (let i = 0; i < 6000; i++) {
        game.step();
        for (const [step, hash] of CHECKPOINTS) if (step === i + 1) seen.set(step, digest(game));
      }
      for (const [step, expected] of CHECKPOINTS)
        expect(seen.get(step), `seed 18 at step ${step}`).toBe(expected);
      expect(game.time).toBeCloseTo(230.95, 6);
      expect(game.kills).toBe(6);
      expect(game.result).toBe("defeat");
    }, 300_000);

    it("replays seed 19 to the same match, step for step", () => {
      // The other seed is the one that must still differ, so its checkpoints prove the fence is
      // pinned to this match and not to "every match hashes the same".
      const other = [
        [1000, "250e71a712596ee0"],
        [2000, "a3afc3fb6841ca19"],
        [3000, "432fa5f7732ff6fc"],
        [6000, "ee270f78dd8e9059"],
      ] as const;
      const game = new Game({ ai: true, seed: 19 });
      const seen = new Map<number, string>();
      for (let i = 0; i < 6000; i++) {
        game.step();
        for (const [step, hash] of other) if (step === i + 1) seen.set(step, digest(game));
      }
      for (const [step, expected] of other)
        expect(seen.get(step), `seed 19 at step ${step}`).toBe(expected);
    }, 300_000);
  });
});
