import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { PathFollow3D } from "../../core/src/index.js";
import { createRandom } from "../../core/src/random.js";
import {
  AUTO_SEND_DELAY,
  ENEMIES,
  MAX_LEVEL,
  START_CREDITS,
  START_LIVES,
  TOTAL_WAVES,
  TOWERS,
  TOWER_KINDS,
  buildWave,
  hpScale,
  sellValue,
  strikeDamage,
  towerStats,
  upgradeCost,
  waveBonus,
  waveCount,
} from "../templates/tower-defense/src/balance.js";
import {
  PADS,
  SAFE_PADS,
  STARTING_PAD,
  WAYPOINTS,
  roundedRoute,
} from "../templates/tower-defense/src/board/Route.js";
import { Economy } from "../templates/tower-defense/src/economy.js";
import type { Enemy } from "../templates/tower-defense/src/enemies/Enemy.js";
import { drainIntents, pushIntent } from "../templates/tower-defense/src/intents.js";
import {
  JitteredScanClock,
  nearestUnhit,
  pickTarget,
  within,
} from "../templates/tower-defense/src/towers/targeting.js";
import { WaveDirector } from "../templates/tower-defense/src/waves.js";

const towerDefenseRoot = path.resolve("packages/create-threenative/templates/tower-defense");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.tsx?$/u.test(file) ? [file] : [];
  });
}

/** The three fields targeting reads from an enemy, and nothing else of one. */
function fakeEnemy(x: number, z: number, progress: number, hp: number, active = true): Enemy {
  return { active, hp, position: new Vector3(x, 0, z), progress } as unknown as Enemy;
}

describe("tower-defense kit: rules", () => {
  it("keeps the portable source free of browser-only navigation WASM", () => {
    const source = sourceFiles(path.join(towerDefenseRoot, "src"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(source).not.toContain("@threenative/physics/navigation");
    expect(source).not.toMatch(/Navigation(?:Agent|Region|Obstacle)3D/u);
  });

  it("starts with Bastion's credits, lives and twelve waves", () => {
    expect([START_CREDITS, START_LIVES, TOTAL_WAVES, MAX_LEVEL]).toEqual([360, 25, 12, 3]);
    expect(TOWER_KINDS.map((kind) => TOWERS[kind].cost)).toEqual([100, 160, 190, 120]);
  });

  it("scales a tower with its level: damage +70%, range +0.6 m, rate +12% a level", () => {
    expect(towerStats("sentry", 1)).toMatchObject({ damage: 19, range: 5.5 });
    expect(towerStats("sentry", 2).damage).toBe(32);
    expect(towerStats("sentry", 3).damage).toBe(46);
    expect(towerStats("sentry", 3).range).toBeCloseTo(6.7, 10);
    expect(towerStats("sentry", 3).interval).toBeCloseTo(0.48 / 1.24, 10);
    expect(towerStats("mortar", 3)).toMatchObject({ damage: 158, splash: 3 });
    expect(towerStats("arc", 3).chains).toBe(6);
    expect(towerStats("cryo", 3).slow).toBeCloseTo(0.37, 10);
    expect(() => towerStats("sentry", 0)).toThrow(/level/u);
    expect(() => towerStats("sentry", 4)).toThrow(/level/u);
  });

  it("prices upgrades at 0.85x then 1.3x the build cost, and recycling at 65% of everything paid", () => {
    expect(TOWER_KINDS.map((kind) => [upgradeCost(kind, 1), upgradeCost(kind, 2)])).toEqual([
      [85, 130],
      [136, 208],
      [162, 247],
      [102, 156],
    ]);
    expect(upgradeCost("sentry", 3)).toBeUndefined();
    expect(sellValue(100)).toBe(65);
    expect(sellValue(100 + 85 + 130)).toBe(204);
  });

  it("sizes waves 7 + 2n and scales their health from 1x to about 6x", () => {
    expect(waveCount(1)).toBe(9);
    expect(waveCount(12)).toBe(31);
    expect(hpScale(1)).toBe(1);
    expect(hpScale(12)).toBeCloseTo(1 + 11 * 0.2 + 121 * 0.023, 10);
    expect(waveBonus(3, true)).toBe(85);
    expect(waveBonus(3, false)).toBe(110);
    expect(strikeDamage(5)).toBe(340);
  });

  it("composes each wave by Bastion's index rules, and only ever the same way", () => {
    const first = buildWave(1);
    expect(first).toHaveLength(9);
    expect(new Set(first.map((spawn) => spawn.kind))).toEqual(new Set(["skitter"]));
    expect(first[0]?.delay).toBe(0.15);
    expect(first[1]?.delay).toBeCloseTo(1.015, 10);

    // Runners from wave 2 on every fourth from index 2; bulwarks from wave 3 on every sixth from 4.
    expect(buildWave(2).map((spawn) => spawn.kind)[2]).toBe("runner");
    expect(buildWave(3).map((spawn) => spawn.kind)[4]).toBe("bulwark");
    // From wave 8 every fifth walker is a bulwark, and that rule wins over the runner rule.
    expect(buildWave(8).map((spawn) => spawn.kind)[0]).toBe("bulwark");
    expect(buildWave(8).map((spawn) => spawn.kind)[10]).toBe("bulwark");
    expect(buildWave(9)).toEqual(buildWave(9));
    // The gap tightens with the wave and never below 0.35 s.
    expect(buildWave(12)[1]?.delay).toBeCloseTo(0.63, 10);
    expect(() => buildWave(0)).toThrow(/Wave/u);
    expect(() => buildWave(13)).toThrow(/Wave/u);
  });

  it("brings one Titan on waves 6 and 12, 55% of the way in, two seconds after its neighbour", () => {
    for (const wave of [6, 12]) {
      const spawns = buildWave(wave);
      const titans = spawns.filter((spawn) => spawn.kind === "titan");
      expect(titans).toHaveLength(1);
      const index = spawns.findIndex((spawn) => spawn.kind === "titan");
      expect(index).toBe(Math.floor(waveCount(wave) * 0.55));
      expect(spawns[index]?.delay).toBe(2);
      expect(spawns).toHaveLength(waveCount(wave) + 1);
    }
    expect(buildWave(6).find((spawn) => spawn.kind === "titan")?.hp).toBe(
      Math.round(ENEMIES.titan.hp * hpScale(6) * 0.82),
    );
    expect(buildWave(12).find((spawn) => spawn.kind === "titan")?.hp).toBe(
      Math.round(ENEMIES.titan.hp * hpScale(12) * 1.1),
    );
    expect(buildWave(5).some((spawn) => spawn.kind === "titan")).toBe(false);
  });
});

describe("tower-defense kit: economy", () => {
  it("spends only what it has, and says so", () => {
    const economy = new Economy();
    expect(economy.credits).toBe(START_CREDITS);
    expect(economy.spend(100)).toBe(true);
    expect(economy.spend(TOWERS.arc.cost + 100)).toBe(false);
    expect([economy.credits, economy.spent]).toEqual([260, 100]);
  });

  it("scores ten a credit for a kill and five for a wave bonus, and nothing for a refund", () => {
    const economy = new Economy();
    economy.reward(10);
    expect([economy.credits, economy.score]).toEqual([START_CREDITS + 10, 100]);
    economy.bonus(85);
    expect(economy.score).toBe(100 + 425);
    economy.refund(65);
    expect(economy.score).toBe(525);
    expect(economy.credits).toBe(START_CREDITS + 10 + 85 + 65);
  });

  it("floors the reactor at zero lives and refuses a nonsense amount", () => {
    const economy = new Economy();
    economy.leak(30);
    expect(economy.lives).toBe(0);
    expect(() => economy.spend(0)).toThrow(/positive/u);
    expect(() => economy.reward(Number.NaN)).toThrow(/positive/u);
  });
});

describe("tower-defense kit: wave director", () => {
  function director(options: { onSpawn?: () => void } = {}) {
    const events: string[] = [];
    let spawned = 0;
    const waves = new WaveDirector({
      onCleared: (wave, leaked) => events.push(`cleared:${wave}:${leaked}`),
      onSpawn: () => {
        spawned += 1;
        options.onSpawn?.();
      },
    });
    return { events, spawned: () => spawned, waves };
  }

  it("launches only from the build phase and never past the last wave", () => {
    const { waves } = director();
    expect(waves.launch()).toBe(true);
    expect(waves.launch()).toBe(false);
    expect(waves.phase).toBe("combat");
  });

  it("releases the whole wave, and does not end it while anything is still alive", () => {
    const { events, spawned, waves } = director();
    waves.launch();
    let alive = 0;
    for (let frame = 0; frame < 60 * 30; frame += 1) {
      const before = spawned();
      waves.update(1 / 60, alive);
      alive += spawned() - before;
    }
    expect(spawned()).toBe(waveCount(1));
    expect(waves.phase).toBe("combat");
    expect(events).toEqual([]);

    waves.update(1 / 60, 0);
    expect(events).toEqual(["cleared:1:false"]);
    expect(waves.phase).toBe("build");
  });

  it("does not clear a wave in the very update that releases its last enemy", () => {
    // The scene counts the living *before* it steps the director, so the enemy released this
    // update is not in that count. A director that trusted it would end a wave as it began.
    const { events, spawned, waves } = director();
    waves.launch();
    waves.update(100, 0);
    expect(spawned()).toBe(waveCount(1));
    expect(events).toEqual([]);
    expect(waves.phase).toBe("combat");
    waves.update(1 / 60, 0);
    expect(events).toEqual(["cleared:1:false"]);
  });

  it("waits for shells in flight, and reports whether anything leaked", () => {
    const { events, waves } = director();
    waves.launch();
    waves.update(100, 0);
    waves.markLeak();
    waves.update(1 / 60, 0, 1);
    expect(waves.phase).toBe("combat");
    waves.update(1 / 60, 0, 0);
    expect(events).toEqual(["cleared:1:true"]);
  });

  it("wins when the last wave is cleared, and only then", () => {
    const { waves } = director();
    for (let wave = 1; wave <= TOTAL_WAVES; wave += 1) {
      expect(waves.won).toBe(false);
      expect(waves.launch()).toBe(true);
      waves.update(1000, 0);
      waves.update(1 / 60, 0);
    }
    expect(waves.won).toBe(true);
    expect(waves.launch()).toBe(false);
  });

  it("sends the next wave itself, seven seconds after a clear, when auto-send is on", () => {
    const { waves } = director();
    waves.autoSend = true;
    waves.launch();
    waves.update(1000, 0);
    waves.update(1 / 60, 0);
    expect(waves.phase).toBe("build");
    waves.update(AUTO_SEND_DELAY - 0.5, 0);
    expect(waves.phase).toBe("build");
    waves.update(0.6, 0);
    expect(waves.wave).toBe(2);
    expect(waves.phase).toBe("combat");
  });

  it("rejects a delta that is not a finite time", () => {
    expect(() => director().waves.update(-1, 0)).toThrow(/finite/u);
  });
});

describe("tower-defense kit: the road", () => {
  const route = roundedRoute();

  it("starts and ends on the authored waypoints and stays on the slab", () => {
    expect(route[0]?.toArray()).toEqual([WAYPOINTS[0]?.[0], 0, WAYPOINTS[0]?.[1]]);
    expect(route.at(-1)?.toArray()).toEqual([WAYPOINTS.at(-1)?.[0], 0, WAYPOINTS.at(-1)?.[1]]);
    for (const point of route) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(19);
      expect(Math.abs(point.z)).toBeLessThanOrEqual(12);
    }
  });

  it("is about sixty metres of curve a walker follows, in order, to the end", () => {
    const path = new PathFollow3D({ points: route, speed: 2 });
    expect(path.totalLength).toBeGreaterThan(58);
    expect(path.totalLength).toBeLessThan(64);
    path.progressTo(path.totalLength * 2);
    expect(path.progress).toBe(path.totalLength);
    expect(path.completed).toBe(true);
  });

  it("puts sixteen pads clear of the road and of one another", () => {
    expect(PADS).toHaveLength(16);
    const samples = new PathFollow3D({ points: route }).curve.getSpacedPoints(400);
    for (const [x, z] of PADS) {
      const nearest = Math.min(...samples.map((point) => Math.hypot(point.x - x, point.z - z)));
      expect(nearest).toBeGreaterThan(1.9);
    }
    for (const [index, [ax, az]] of PADS.entries())
      for (const [bx, bz] of PADS.slice(index + 1))
        expect(Math.hypot(ax - bx, az - bz)).toBeGreaterThan(2.6);
  });

  it("ranks pads for the safe-build key, best first, with the starting Sentry's pad on top", () => {
    expect(SAFE_PADS[0]).toBe(STARTING_PAD);
    expect(new Set(SAFE_PADS).size).toBe(SAFE_PADS.length);
    for (const pad of SAFE_PADS) expect(PADS[pad]).toBeDefined();
  });
});

describe("tower-defense kit: targeting", () => {
  const origin = { x: 0, z: 0 };
  const ahead = fakeEnemy(3, 0, 30, 20);
  const strong = fakeEnemy(0, 4, 10, 200);
  const close = fakeEnemy(1, 0, 5, 50);

  it("picks first, strongest or nearest from what is in range", () => {
    const all = [ahead, strong, close];
    expect(pickTarget(all, origin, 5.5, "first")).toBe(ahead);
    expect(pickTarget(all, origin, 5.5, "strongest")).toBe(strong);
    expect(pickTarget(all, origin, 5.5, "nearest")).toBe(close);
  });

  it("ignores what is out of range or no longer fighting", () => {
    expect(pickTarget([fakeEnemy(9, 0, 99, 99)], origin, 5.5, "first")).toBeUndefined();
    expect(pickTarget([fakeEnemy(1, 0, 99, 99, false)], origin, 5.5, "first")).toBeUndefined();
    expect(pickTarget([undefined, close], origin, 5.5, "first")).toBe(close);
  });

  it("finds a splash's victims and the next link of a chain", () => {
    const enemies = [ahead, strong, close, fakeEnemy(20, 20, 1, 1)];
    expect(within(enemies, origin, 3.5)).toEqual([ahead, close]);
    expect(nearestUnhit(enemies, close.position, 3.6, new Set([close]))).toBe(ahead);
    expect(nearestUnhit(enemies, close.position, 1, new Set([close]))).toBeUndefined();
  });

  it("scans on a jittered interval inside its bounds, never in lockstep", () => {
    const clock = new JitteredScanClock(createRandom(7), 0.1, 0.16);
    const times: number[] = [];
    let now = 0;
    for (let frame = 0; frame < 600; frame += 1) {
      now += 1 / 60;
      clock.update(1 / 60, () => times.push(now));
    }
    expect(clock.scans).toBeGreaterThan(60);
    expect(clock.scans).toBeLessThan(100);
    const gaps = times.slice(1).map((time, index) => time - (times[index] ?? 0));
    expect(new Set(gaps.map((gap) => gap.toFixed(3))).size).toBeGreaterThan(1);
    expect(() => new JitteredScanClock(createRandom(1), 0.2, 0.1)).toThrow(/bounds/u);
  });
});

describe("tower-defense kit: the seam between the HUD and the game", () => {
  it("hands intents to the scene in the order the HUD sent them, once", () => {
    drainIntents();
    pushIntent("arm", "sentry");
    pushIntent("launch");
    expect(drainIntents()).toEqual([
      { intent: "arm", payload: "sentry" },
      { intent: "launch", payload: undefined },
    ]);
    expect(drainIntents()).toEqual([]);
  });
});
