import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { IShapeHit, PhysicsDirectSpaceState3D } from "@threenative/physics";
import { rapier } from "@threenative/physics";
import { InstancedMesh, Matrix4, PerspectiveCamera, Vector2, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { PathFollow3D } from "../../core/src/index.js";
import { createRandom } from "../../core/src/random.js";
import {
  Economy,
  INCOME_RATE,
  STARTING_BALANCE,
  TOWER_COST,
} from "../templates/defense/src/economy.js";
import { Player } from "../templates/defense/src/entities/Player.js";
import { Buildable } from "../templates/defense/src/placement/Buildable.js";
import { MAX_LEAKS, registerLeak } from "../templates/defense/src/state.js";
import {
  type ITargetable,
  JitteredScanClock,
  nearestFirst,
} from "../templates/defense/src/towers/targeting.js";
import {
  ATTACKERS_PER_WAVE,
  TOTAL_WAVES,
  WAVE_INTERVAL,
  WaveSchedule,
} from "../templates/defense/src/waves.js";

const defenseRoot = path.resolve("packages/create-threenative/templates/defense");

let nextBodyId = 1;

/** One spatial-query result, shaped like the one the physics backend returns. */
function shapeHit(entity: string): IShapeHit {
  nextBodyId += 1;
  return { body: { id: nextBodyId, raw: {} }, entity, position: { x: 0, y: 0, z: 0 } };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.tsx?$/u.test(file) ? [file] : [];
  });
}

describe("defense starter kit", () => {
  it("keeps the portable source free of browser-only navigation WASM", () => {
    const source = sourceFiles(path.join(defenseRoot, "src"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(source).not.toContain("@threenative/physics/navigation");
    expect(source).not.toMatch(
      /fog of war|marquee selection|navmesh|tech tree|Navigation(?:Agent|Region|Obstacle)3D/iu,
    );
  });

  it("rejects route and overlap placement without spending", () => {
    // A stub space state, not a stub of the whole physics world: `Buildable` reaches the query
    // through the same `PhysicsDirectSpaceState3D` shape the plugin hands the scene, so the cast
    // is over the two methods this test does not call, never over the one it does.
    const query = {
      intersectShape: ({ position }: { readonly position: Vector3 }) =>
        position.x < 0 ? [shapeHit("route.0")] : [shapeHit("tower.0")],
    } as unknown as PhysicsDirectSpaceState3D;
    const buildable = new Buildable(query);
    const economy = new Economy();
    economy.update(1);

    expect(buildable.validate(new Vector3(-3, 0, 0))).toEqual({
      accepted: false,
      reason: "route",
    });
    expect(buildable.validate(new Vector3(3, 0, 0))).toEqual({
      accepted: false,
      reason: "overlap",
    });
    expect(economy.spent).toBe(0);
    expect(economy.income).toBe(INCOME_RATE);
    expect(economy.balance).toBe(STARTING_BALANCE + INCOME_RATE);
  });

  it("moves the registered command beacon from the move vector", () => {
    const ctx = {
      add: (object: object) => object,
      input: { vector: () => new Vector2(0, 1) },
    } as unknown as ConstructorParameters<typeof Player>[0];
    const player = new Player(ctx);
    const startZ = player.mesh.position.z;

    player.update(ctx, 0.5);

    expect(player.mesh.position.z).toBeCloseTo(startZ - 2);
    player.dispose();
  });

  it("scans inside the jitter window instead of once per frame", () => {
    const clock = new JitteredScanClock(createRandom(92092));
    for (let frame = 0; frame < 300; frame += 1) clock.update(1 / 60, () => undefined);

    expect(clock.scans).toBeGreaterThanOrEqual(16);
    expect(clock.scans).toBeLessThanOrEqual(28);
  });

  it("acquires the nearest spatial hit when a wave has multiple attackers", () => {
    const target = (id: string, x: number): ITargetable => ({
      dead: false,
      id,
      mesh: { position: new Vector3(x, 0, 0) },
      takeDamage: () => undefined,
    });
    const first = target("attacker.1.0", 5);
    const nearest = target("attacker.1.1", 1);
    const targets = new Map([
      [first.id, first],
      [nearest.id, nearest],
    ]);

    expect(nearestFirst([shapeHit(first.id), shapeHit(nearest.id)], new Vector3(), targets)).toBe(
      nearest,
    );
  });

  // One route user is all that is left. The platformer's steering chaser went with its game when
  // the template became the fox run, which has no chaser at all: its walkers patrol a straight x
  // range, so a path follower would be an abstraction with one caller and no second user left.
  it("uses the promoted core route follower in the defense attacker", () => {
    const attacker = readFileSync(path.join(defenseRoot, "src/attackers/Attacker.ts"), "utf8");

    expect(attacker).toContain("PathFollow3D");
    expect(attacker).not.toMatch(/CatmullRomCurve3|routeIndex|routeProgress/u);
  });

  it("holds a route follower to its sampled points, which is what both users depend on", () => {
    const route = new PathFollow3D({
      points: [new Vector3(0, 0, 0), new Vector3(10, 0, 0), new Vector3(20, 0, 0)],
      speed: 2,
    });

    // A 1/60 step is a fraction of a sampled point, so a follower that advanced per frame would
    // jump the curve and cut the corner. The claim is that the advance is bounded by the sample.
    const before = route.advance(1 / 60);
    expect(before.progress).toBeCloseTo((1 / 60) * 2, 6);
    expect(before.point.x).toBeGreaterThan(0);
    expect(route.progress).toBeLessThanOrEqual(route.totalLength);
    // Past the end, progress is clamped rather than running off the curve.
    route.progressTo(route.totalLength * 2);
    expect(route.progress).toBe(route.totalLength);
    expect(route.advance(1 / 60)).toMatchObject({ progress: route.totalLength });
    expect(route.completed).toBe(true);
  });

  // The geometry HUD this test covered was removed in round 10: defense mounted it *and* a React
  // <Hud />, so both drew the same numbers on top of each other. The subject is gone, so the
  // assertion has no subject. The replacement invariant lives in template.spec.ts — no template
  // may mount two HUDs — and it fails when a call site is restored.

  it("keeps the economy ledger balanced after income and spend", () => {
    const economy = new Economy();
    for (let frame = 0; frame < 300; frame += 1) economy.update(1 / 60);

    expect(economy.spend(TOWER_COST)).toBe(true);
    expect(economy.balance).toBeCloseTo(STARTING_BALANCE + economy.income - economy.spent);
    expect(economy.income).toBeCloseTo(INCOME_RATE * 5);
  });

  it("spawns both members of every wave and wins after the field clears", () => {
    const spawned: Array<[number, number]> = [];
    let wins = 0;
    const schedule = new WaveSchedule({
      onSpawn: (wave, member) => spawned.push([wave, member]),
      onWin: () => {
        wins += 1;
      },
    });

    schedule.update(WAVE_INTERVAL, 1);
    for (let wave = 1; wave < TOTAL_WAVES; wave += 1) schedule.update(WAVE_INTERVAL, 1);
    schedule.update(0, 0);

    expect(schedule.spawned).toBe(TOTAL_WAVES);
    expect(spawned).toHaveLength(TOTAL_WAVES * ATTACKERS_PER_WAVE);
    expect(wins).toBe(1);
  });

  it("transitions to lost exactly when twenty attackers leak", () => {
    let state: ReturnType<typeof registerLeak> = { leaks: 0, status: "PLAYING" };
    for (let leak = 0; leak < MAX_LEAKS - 1; leak += 1) state = registerLeak(state.leaks);
    expect(state).toEqual({ leaks: MAX_LEAKS - 1, status: "PLAYING" });

    state = registerLeak(state.leaks);
    expect(state).toEqual({ leaks: MAX_LEAKS, status: "LOST" });
  });
});
