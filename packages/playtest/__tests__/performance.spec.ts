import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoxGeometry, Mesh, MeshBasicMaterial, type Scene as ThreeScene, type Vector2 } from "three";
import { expect, test } from "vitest";

import {
  PLAYTEST_BRIDGE_GLOBAL,
  evaluateRichPlaytestAssertions,
  loadPlaytestScenario,
  type IPlaytestBridgeV1,
  type IPlaytestObservations,
  type IPlaytestObservationSnapshot,
  type IPlaytestScenario,
} from "../src/index.js";
import { defineGame } from "../../core/src/game.js";
import { playtest } from "../../core/src/playtest.js";
import { type ICtx, Scene } from "../../core/src/scene.js";
import { buildReport } from "../src/runner/runner.js";
import type { IStandalonePlaytestConfig } from "../src/runner/config.js";

const EMPTY_OBSERVATIONS: IPlaytestObservations = {
  console: [],
  hud: {},
  network: [],
  resources: {},
};

const CONFIG: IStandalonePlaytestConfig = {
  artifactDirectory: "artifacts/playtest-performance",
  headless: true,
  projectPath: ".",
  scenarioPath: "scenario.json",
  timeoutMs: 1_000,
  trace: false,
  url: "http://127.0.0.1:5173",
};

const REGRESSED_MESH_COUNT = 32;
const DECLARED_MAX_DRAW_CALLS = 8;
const DECLARED_MAX_TRIANGLES = 96;

async function scenario(assertion: unknown): Promise<IPlaytestScenario> {
  const directory = await mkdtemp(join(tmpdir(), "playtest-performance-"));
  await writeFile(join(directory, "scenario.json"), JSON.stringify({
    assert: { performance: assertion },
    name: "performance-proof",
    schemaVersion: 1,
    steps: [{ release: true, waitFrames: 2 }],
  }));
  return loadPlaytestScenario(directory, "scenario.json");
}

function report(series: unknown[]) {
  return {
    diagnostics: [],
    distance: 0,
    entity: "",
    expectMoved: false,
    frames: 2,
    observations: {
      ...EMPTY_OBSERVATIONS,
      performanceSeries: series,
    },
  };
}

interface TestRenderer {
  readonly domElement: HTMLCanvasElement;
  readonly info: { render: { calls?: number; triangles?: number } };
  getDrawingBufferSize(target: Vector2): Vector2;
  render(scene: ThreeScene): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  dispose(): void;
}

function testCanvas(): HTMLCanvasElement {
  const canvas = new EventTarget() as EventTarget & Partial<HTMLCanvasElement>;
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, value: 180 },
    clientWidth: { configurable: true, value: 320 },
    parentElement: { configurable: true, value: null },
  });
  return canvas as HTMLCanvasElement;
}

function bridge(): IPlaytestBridgeV1 {
  const value = (globalThis as Record<string, unknown>)[PLAYTEST_BRIDGE_GLOBAL];
  if (typeof value !== "object" || value === null) throw new Error("Playtest bridge was not installed.");
  return value as IPlaytestBridgeV1;
}

function createTestRenderer(canvas: HTMLCanvasElement, observeRendererCounts: boolean): TestRenderer {
  const renderer: TestRenderer = {
    domElement: canvas,
    info: { render: {} },
    getDrawingBufferSize: (target) => target.set(1280, 720),
    render: (scene) => {
      if (!observeRendererCounts) {
        renderer.info.render = {};
        return;
      }
      let calls = 0;
      let triangles = 0;
      scene.traverse((object) => {
        if (!(object as Mesh).isMesh || !object.visible) return;
        const mesh = object as Mesh;
        const geometry = mesh.geometry;
        const position = geometry.getAttribute("position");
        calls += 1;
        triangles += geometry.index === null ? position.count / 3 : geometry.index.count / 3;
      });
      renderer.info.render = { calls, triangles };
    },
    setSize: () => undefined,
    dispose: () => undefined,
  };
  return renderer;
}

async function renderControl(
  meshCount: number,
  observeRendererCounts: boolean,
): Promise<IPlaytestObservationSnapshot> {
  const canvas = testCanvas();
  const callbacks: Array<(time: number) => void> = [];
  const requestFrame = globalThis.requestAnimationFrame;
  const cancelFrame = globalThis.cancelAnimationFrame;
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: (time: number) => void) => {
      callbacks.push(callback);
      return callbacks.length;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: () => undefined,
  });
  class RegressedScene extends Scene {
    override enter(ctx: ICtx): void {
      for (let index = 0; index < meshCount; index += 1) {
        const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
        mesh.position.set((index % 8) - 3.5, Math.floor(index / 8) - 1.5, 0);
        ctx.add(mesh);
      }
    }
  }
  const game = defineGame({
    initialState: {},
    plugins: [playtest()],
    renderer: {
      canvas,
      preferWebGPU: false,
      webgl2Factory: () => createTestRenderer(canvas, observeRendererCounts),
    },
    scenes: { regressed: RegressedScene },
    start: "regressed",
  });
  try {
    await game.start();
    callbacks.shift()?.(0);
    callbacks.shift()?.(16);
    callbacks.shift()?.(32);
    return await bridge().sample({});
  } finally {
    game.stop();
    if (requestFrame === undefined) Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    else Object.defineProperty(globalThis, "requestAnimationFrame", { value: requestFrame });
    if (cancelFrame === undefined) Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
    else Object.defineProperty(globalThis, "cancelAnimationFrame", { value: cancelFrame });
  }
}

test("performance bounds pass against observed frame cost and renderer counts", async () => {
  const loaded = await scenario({ maxDrawCalls: 10, maxFrameMsP95: 20, maxTriangles: 500 });
  const evaluated = evaluateRichPlaytestAssertions({
    report: report([
      { drawCalls: 4, frameMs: 16, triangles: 120 },
      { drawCalls: 5, frameMs: 18, triangles: 140 },
      { drawCalls: 3, frameMs: 17, triangles: 100 },
    ]),
    scenario: loaded,
  });

  expect(evaluated.assertions).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "performance.samples", pass: true }),
    expect.objectContaining({ id: "performance.maxFrameMsP95", pass: true }),
    expect.objectContaining({ id: "performance.maxDrawCalls", pass: true }),
    expect.objectContaining({ id: "performance.maxTriangles", pass: true }),
  ]));
  expect(evaluated.diagnostics).toEqual([]);
});

test("the permanent regressed-scene control drives the render loop and turns red", async () => {
  const loaded = await scenario({ maxDrawCalls: DECLARED_MAX_DRAW_CALLS, maxTriangles: DECLARED_MAX_TRIANGLES });
  const snapshot = await renderControl(REGRESSED_MESH_COUNT, true);
  const result = buildReport(CONFIG, loaded, undefined, snapshot, [], []);

  expect(snapshot.runtimeDiagnosticsSeries).toEqual([
    { drawCalls: REGRESSED_MESH_COUNT, frameMs: 16, triangles: REGRESSED_MESH_COUNT * 12 },
    { drawCalls: REGRESSED_MESH_COUNT, frameMs: 16, triangles: REGRESSED_MESH_COUNT * 12 },
  ]);
  expect(result.assertionResults).toEqual(expect.arrayContaining([
    expect.objectContaining({ details: expect.objectContaining({ actual: REGRESSED_MESH_COUNT }), id: "performance.maxDrawCalls", pass: false }),
    expect.objectContaining({ details: expect.objectContaining({ actual: REGRESSED_MESH_COUNT * 12 }), id: "performance.maxTriangles", pass: false }),
  ]));
  expect(result.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_PERFORMANCE_ASSERTION_FAILED");
  expect(result.pass).toBe(false);
});

test("the permanent regressed-scene control fails closed when renderer counts disappear", async () => {
  const loaded = await scenario({ maxDrawCalls: DECLARED_MAX_DRAW_CALLS, maxTriangles: DECLARED_MAX_TRIANGLES });
  const snapshot = await renderControl(REGRESSED_MESH_COUNT, false);
  const result = buildReport(CONFIG, loaded, undefined, snapshot, [], []);

  expect(snapshot.runtimeDiagnosticsSeries).toEqual([
    { frameMs: 16 },
    { frameMs: 16 },
  ]);
  expect(result.assertionResults).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "performance.maxDrawCalls", pass: false }),
    expect.objectContaining({ id: "performance.maxTriangles", pass: false }),
  ]));
  expect(result.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_PERFORMANCE_ASSERTION_FAILED");
  expect(result.pass).toBe(false);
});

test("an empty performance series fails closed instead of passing vacuously", async () => {
  const loaded = await scenario({ maxFrameMsP95: 20 });
  const evaluated = evaluateRichPlaytestAssertions({
    report: report([]),
    scenario: loaded,
  });

  expect(evaluated.assertions).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "performance.samples", pass: false }),
    expect.objectContaining({ id: "performance.maxFrameMsP95", pass: false }),
  ]));
  expect(evaluated.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_PERFORMANCE_SAMPLES_MISSING");
});
