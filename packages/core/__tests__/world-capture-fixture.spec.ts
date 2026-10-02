import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene as ThreeScene,
} from "three";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { resolveDiagnosticsPolicy } from "../../playtest/src/assertion-report.js";
import { loadPlaytestScenario } from "../../playtest/src/scenario.js";
import { Registry } from "../src/entities.js";
import { Scene } from "../src/scene.js";
import { createGameStore } from "../src/state.js";

const root = resolve(import.meta.dirname, "../../..");
const fixture = "examples/abyss-framework";

async function probe() {
  // The actual scene runs with its renderer/assets boundary stubbed. These distinctive readings
  // catch dropped or invented diagnostics; WorldCells itself has separate engine tests.
  let stats = {
    admission: { backlog: 13, deferred: 2, spentMs: 3.75 },
    evictions: 7,
    failures: 0,
    gpuScene: { on: false, reason: "renderer has no computeAsync", dispatches: 0 },
    instances: 97,
    loadsInFlight: 2,
    loadsQueued: 3,
    pendingPrewarm: 4,
    pressure: { bytes: 0, cells: 0, instances: 0 },
    residentCells: 3,
  };
  const world = { dispose() {}, stats: () => stats };
  const source = readFileSync(resolve(root, fixture, "src/scenes/WorldProbe.ts"), "utf8");
  const module = { exports: {} };
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports: module.exports,
      require: (name: string) => {
        if (name === "@threenative/core") return { Scene, VirtualShadowNode: class {} };
        if (name === "@threenative/core/world") return { WorldCells: { load: async () => world } };
        if (name === "three") return { Color, DirectionalLight, HemisphereLight };
        if (name === "../render/terrain.js") return { terrainMaterial: () => ({}) };
        throw new Error(`Unexpected fixture dependency ${name}`);
      },
    },
  );
  const { WorldProbe } = module.exports as { WorldProbe: new () => Scene<Record<string, unknown>> };
  const scene = new WorldProbe();
  let flying = false;
  const ctx = {
    add() {},
    assets: {},
    camera: new PerspectiveCamera(),
    entities: new Registry(),
    input: { pressed: () => flying },
    renderer: {},
    scene: new ThreeScene(),
    state: createGameStore<Record<string, unknown>>({}),
  } as unknown as Parameters<typeof scene.load>[0];
  await scene.load(ctx);
  scene.enter(ctx);
  return {
    ctx,
    scene,
    debug: () => ctx.entities.snapshot().world,
    fly: (value: boolean) => {
      flying = value;
    },
    stats: () => stats,
    settle: () => {
      stats = { ...stats, admission: { backlog: 0, deferred: 0, spentMs: 0 }, residentCells: 1 };
    },
  };
}

describe("PRD-477 world capture fixture", () => {
  it("publishes actual world stats and preserves admission overshoot and the GPU fallback reason", async () => {
    const run = await probe();
    expect(run.ctx.state.getState().stats).toEqual(run.stats());
    expect(run.debug()).toMatchObject({
      admissionBacklog: 13,
      admissionDeferred: 2,
      admissionSpentMs: 3.75,
      gpuSceneOn: false,
      gpuSceneReason: "renderer has no computeAsync",
      loadsQueued: 3,
      pendingPrewarm: 4,
      maxAdmissionSpentMs: 3.75,
      maxInstances: 97,
    });
    run.settle();
    run.scene.render(run.ctx);
    expect(run.ctx.state.getState().stats).toEqual(run.stats());
    expect(run.debug()).toMatchObject({
      admissionBacklog: 0,
      admissionSpentMs: 0,
      maxAdmissionSpentMs: 3.75,
      maxResidentCells: 3,
    });
  });

  it("reports the input-gated camera pose and elapsed flight time without changing the fixed route", async () => {
    const run = await probe();
    run.scene.update(run.ctx, 10);
    expect(run.debug()).toMatchObject({
      cameraPosition: [-160, 24, 0],
      cameraTarget: [-120, 10, 0],
      flyTimeMs: 0,
    });
    run.fly(true);
    run.scene.update(run.ctx, 0.5);
    expect(run.debug()).toMatchObject({
      cameraPosition: [-128, 24, 0],
      cameraTarget: [-88, 10, 0],
      flyTimeMs: 500,
    });
    run.fly(false);
    run.scene.update(run.ctx, 10);
    expect(run.debug()).toMatchObject({ cameraPosition: [-128, 24, 0], flyTimeMs: 500 });
    run.fly(true);
    run.scene.update(run.ctx, 10);
    expect(run.debug()?.cameraPosition).toEqual([180, 24, 0]);
  });

  it("reports landmark positions from the authored chunk transforms", async () => {
    const run = await probe();
    const landmarks = ["yard_0_2", "yard_1_1"].flatMap((chunk) => {
      const bytes = readFileSync(resolve(root, fixture, `assets/world/chunks/${chunk}.glb`));
      const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8")) as {
        nodes: Array<{ name: string; translation: number[] }>;
      };
      return json.nodes.map((node) => ({ id: node.name, position: node.translation }));
    });
    expect(run.debug()?.landmarks).toEqual(landmarks);
  });

  it("loads a chronological named screenshot series along the same KeyF leg", async () => {
    const scenario = await loadPlaytestScenario(
      root,
      `${fixture}/playtests/phase477-world-capture.playtest.json`,
    );
    expect(scenario.target).toBe("web");
    const moving = scenario.steps.filter((step) => step.press === "KeyF");
    expect(moving).toHaveLength(32);
    expect(moving.every((step) => step.waitTicks === 10 && step.release)).toBe(true);
    expect(moving.map((step) => step.screenshot)).toEqual(
      Array.from(
        { length: 32 },
        (_, index) => `phase477-walk-${String(index + 1).padStart(2, "0")}`,
      ),
    );
    expect(scenario.steps.every((step) => step.label === step.screenshot)).toBe(true);
    expect(scenario.steps[0]?.screenshot).toBe("phase477-pose-start");
    expect(scenario.steps.at(-1)?.screenshot).toBe("phase477-pose-end");
  });

  it.each(["desktop", "android"])(
    "loads the %s proof contract with real upper bounds and settle assertions",
    async (target) => {
      const scenario = await loadPlaytestScenario(
        root,
        `${fixture}/playtests/phase477-world-streaming.${target}.playtest.json`,
      );
      // Android uses the documented CLI --target android override of a web scenario.
      expect(scenario.target).toBe(target === "android" ? "web" : target);
      expect(scenario.assert?.diagnostics).toMatchObject({
        runtimeReady: true,
        noRuntimeDiagnostics: true,
        noConsoleErrors: true,
      });
      expect(resolveDiagnosticsPolicy(scenario.assert?.diagnostics, target)).toMatchObject({
        noNetworkErrors: false,
        networkErrorsOptOutReason: expect.stringContaining("no network observer"),
      });
      expect(scenario.assert?.components).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ component: "maxResidentCells", gte: 1, lte: 25 }),
          expect.objectContaining({ component: "instances", gte: 1, lte: 20_000 }),
          expect.objectContaining({ component: "admissionBacklog", equals: 0 }),
          expect.objectContaining({ component: "loadsQueued", equals: 0 }),
        ]),
      );
      // The final admission unit may overshoot 2ms. Do not turn a diagnostic into a false cap.
      expect(
        scenario.assert?.components?.find((row) => row.component === "maxAdmissionSpentMs")?.lte,
      ).toBeUndefined();
    },
  );
});
