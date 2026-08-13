import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { rapier } from "@threenative/physics";
import { InstancedMesh, Matrix4, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createRandom } from "../../core/src/random.js";
import {
  Economy,
  INCOME_RATE,
  STARTING_BALANCE,
  TOWER_COST,
} from "../templates/defense/src/economy.js";
import { Buildable } from "../templates/defense/src/placement/Buildable.js";
import { createHud } from "../templates/defense/src/render/hud.js";
import { toon } from "../templates/defense/src/render/palette.js";
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
import { Chaser } from "../templates/platformer/src/entities/Chaser.js";

const defenseRoot = path.resolve("packages/create-threenative/templates/defense");

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
    const query = {
      intersectShape: ({ position }: { readonly position: Vector3 }) =>
        position.x < 0 ? [{ body: {}, entity: "route.0" }] : [{ body: {}, entity: "tower.0" }],
    };
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

    expect(
      nearestFirst(
        [
          { body: {}, entity: first.id },
          { body: {}, entity: nearest.id },
        ],
        new Vector3(),
        targets,
      ),
    ).toBe(nearest);
  });

  it("uses the promoted core route follower in both portable route users", () => {
    const attacker = readFileSync(path.join(defenseRoot, "src/attackers/Attacker.ts"), "utf8");
    const chaser = readFileSync(
      path.resolve("packages/create-threenative/templates/platformer/src/entities/Chaser.ts"),
      "utf8",
    );
    const sources = `${attacker}\n${chaser}`;

    expect(attacker).toContain("PathFollow3D");
    expect(chaser).toContain("PathFollow3D");
    expect(sources).not.toMatch(/CatmullRomCurve3|routeIndex|routeProgress/u);
    expect(chaser).toContain("position.distanceTo(routeSample.point) <= ROUTE_REACH_DISTANCE");
    expect(chaser).toContain("this.#route.progressTo(this.#route.progress + SPEED * dt)");
    expect(chaser).not.toContain("this.#route.advance(dt)");
  });

  it("advances a Chaser route only after reaching its sampled point", async () => {
    const ctx = {
      add: () => undefined,
      physics: undefined,
    } as unknown as ConstructorParameters<typeof Chaser>[0];
    const plugin = rapier({ gravity: { x: 0, y: 0, z: 0 } });
    await plugin.setup?.(ctx);
    const player = {
      mesh: { position: new Vector3(100, 0.66, 0) },
    } as unknown as ConstructorParameters<typeof Chaser>[1];
    const chaser = new Chaser(ctx, player, new Vector3(0, 0.66, -3.05));

    try {
      const initial = chaser.debug();
      const routeSample = new Vector3(...(initial.routeSample as number[]));
      expect(chaser.mesh.position.distanceTo(routeSample)).toBeGreaterThan(0.35);

      chaser.update(1 / 60);
      expect(chaser.debug().routeDistance).toBe(initial.routeDistance);

      chaser.mesh.position.copy(routeSample);
      chaser.update(1 / 60);
      expect(chaser.debug().routeDistance).toBeGreaterThan(initial.routeDistance as number);
    } finally {
      chaser.dispose();
      plugin.dispose?.(ctx);
    }
  });

  it("keeps win and loss geometry HUD glyphs inside the camera frustum", () => {
    const camera = new PerspectiveCamera(48, 390 / 844, 0.1, 120);
    const hud = createHud(camera);
    const matrix = new Matrix4();

    for (const status of ["WON", "LOST"]) {
      hud.update({ balance: 0, leaks: 0, status, towers: 0, wave: 0 });
      camera.updateMatrixWorld(true);
      const root = camera.children.at(-1);
      if (!(root instanceof InstancedMesh)) throw new Error("Defense HUD root is not instanced.");

      let statusPixels = 0;
      for (let index = 0; index < root.count; index += 1) {
        root.getMatrixAt(index, matrix);
        const local = new Vector3().setFromMatrixPosition(matrix);
        if (local.y > -36) continue;
        const point = local.applyMatrix4(root.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
        const halfHeight = Math.tan((camera.fov * Math.PI) / 360) * -point.z;
        expect(point.z).toBeLessThan(-camera.near);
        expect(Math.abs(point.x)).toBeLessThan(halfHeight * camera.aspect);
        expect(Math.abs(point.y)).toBeLessThan(halfHeight);
        statusPixels += 1;
      }
      expect(statusPixels).toBeGreaterThan(0);
    }

    hud.dispose();
  });

  it("keys toon materials by color and roughness", () => {
    const smooth = toon(0x123456, 0.2);
    const rough = toon(0x123456, 0.9);

    expect(smooth).not.toBe(rough);
    expect(smooth.roughness).toBeCloseTo(0.2);
    expect(rough.roughness).toBeCloseTo(0.9);
    expect(toon(0x123456, 0.2)).toBe(smooth);
  });

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
