import { PerspectiveCamera, Scene, type Vector2, type WebGLRenderer } from "three";
import { expect, test } from "vitest";

import { evaluateRichPlaytestAssertions } from "../src/assertions.js";
import type { IPlaytestReport } from "../src/report.js";
import { installThreePlaytestBridge } from "../src/three/bridge.js";
import { PLAYTEST_PHYSICS_BODY_LIMIT, type IThreePlaytestPhysicsBody } from "../src/three/physics.js";
import type { IPlaytestScenario } from "../src/scenario.js";

// A plain Three.js + Rapier project could not satisfy `settled`, `occluded` or `aerodynamics`
// at all: installThreePlaytestBridge had no way to advertise runtime.physics, so the runner
// refused every such scenario with TN_PLAYTEST_CAPABILITY_MISSING before evaluating anything.
// Round 4's paired sweep recorded exactly that for both arms (0/1, docs/verification/round-4-2026-08-10.md).
// This package runs against plain Three.js with zero ThreeNative dependencies by design, so a
// capability only the framework's own plugin could reach was a hole in the product.

const renderer = {
  getDrawingBufferSize(target: Vector2) {
    return target.set(1280, 720);
  },
} as WebGLRenderer;

function installPhysicsBridge(bodies: () => readonly IThreePlaytestPhysicsBody[]) {
  let tick = 0;
  return installThreePlaytestBridge({
    camera: new PerspectiveCamera(),
    fixedStep: (ticks) => { tick += ticks; },
    physics: { bodies },
    renderer,
    scene: new Scene(),
    tick: () => tick,
  });
}

function settledScenario(assertion: Record<string, unknown>): IPlaytestScenario {
  return { assert: { settled: [assertion] }, name: "settle", schemaVersion: 1, steps: [], target: "web" } as unknown as IPlaytestScenario;
}

/** `sample` throws synchronously here, so wrap it to compare against either failure shape. */
async function sampling(installation: { bridge: { sample: (request: { include: string[]; label: string }) => unknown } }, label: string): Promise<unknown> {
  return installation.bridge.sample({ include: ["physicsDebugSeries"], label });
}

function reportWith(series: unknown): IPlaytestReport {
  return { observations: { console: [], hud: {}, network: [], physicsDebugSeries: series, resources: {} } } as unknown as IPlaytestReport;
}

test("a physics provider advertises runtime.physics and nothing else advertises it", async () => {
  const withPhysics = installPhysicsBridge(() => []);
  const without = installThreePlaytestBridge({ camera: new PerspectiveCamera(), renderer, scene: new Scene() });

  expect((await withPhysics.bridge.describe()).capabilities).toContain("runtime.physics");
  expect((await without.bridge.describe()).capabilities).not.toContain("runtime.physics");
  withPhysics.dispose();
  without.dispose();
});

// The whole point of the option: the series it produces has to satisfy the real evaluator,
// not merely exist. An option that yields a snapshot `settled` cannot read is decoration.
test("a recorded series satisfies the settled assertion the framework arm can already reach", async () => {
  let sleeping = false;
  const installation = installPhysicsBridge(() => [
    { id: "crate.0", position: [0, sleeping ? 0.5 : 4, 0], sleeping },
    { id: "crate.1", position: [1, sleeping ? 0.5 : 4, 0], sleeping },
  ]);

  await installation.bridge.sample({ include: ["physicsDebugSeries"], label: "drop" });
  sleeping = true;
  const snapshot = await installation.bridge.sample({ include: ["physicsDebugSeries"], label: "settled" });

  const { assertions, diagnostics } = evaluateRichPlaytestAssertions({
    report: reportWith(snapshot.physicsDebugSeries),
    scenario: settledScenario({ atStep: "settled", compareToStep: "drop", entity: "crate", minBodies: 2, minMeanPoseDistance: 1 }),
  });

  expect(assertions).toEqual([expect.objectContaining({ id: "settled.crate", pass: true })]);
  expect(diagnostics).toEqual([]);
  installation.dispose();
});

test("an awake body fails settled rather than passing on a snapshot the assertion cannot read", async () => {
  const installation = installPhysicsBridge(() => [{ id: "crate.0", position: [0, 4, 0], sleeping: false }]);

  const snapshot = await installation.bridge.sample({ include: ["physicsDebugSeries"], label: "settled" });
  const { assertions } = evaluateRichPlaytestAssertions({
    report: reportWith(snapshot.physicsDebugSeries),
    scenario: settledScenario({ atStep: "settled", entity: "crate", minBodies: 1 }),
  });

  expect(assertions).toEqual([expect.objectContaining({ id: "settled.crate", pass: false })]);
  installation.dispose();
});

test("bodies past the retention limit are reported as omitted, not silently dropped", async () => {
  const overflow = PLAYTEST_PHYSICS_BODY_LIMIT + 3;
  const installation = installPhysicsBridge(() =>
    Array.from({ length: overflow }, (_, index) => ({ id: `crate.${index}`, position: [index, 0.5, 0] as const, sleeping: true })));

  const snapshot = await installation.bridge.sample({ include: ["physicsDebugSeries"], label: "settled" });
  const { assertions } = evaluateRichPlaytestAssertions({
    report: reportWith(snapshot.physicsDebugSeries),
    scenario: settledScenario({ atStep: "settled", entity: "crate", minBodies: 1 }),
  });

  // Every retained body is asleep, so only the omission keeps this from passing.
  expect(assertions).toEqual([expect.objectContaining({ id: "settled.crate", pass: false })]);
  expect(assertions[0]?.details).toMatchObject({ omittedBodies: 3 });
  installation.dispose();
});

test("the series stays absent until a scenario asks for it", async () => {
  const installation = installPhysicsBridge(() => [{ id: "crate.0", position: [0, 0, 0], sleeping: true }]);

  expect((await installation.bridge.sample({ label: "settled" })).physicsDebugSeries).toBeUndefined();
  installation.dispose();
});

test("a repeated step label fails closed instead of overwriting retained evidence", async () => {
  const installation = installPhysicsBridge(() => [{ id: "crate.0", position: [0, 0, 0], sleeping: true }]);

  await installation.bridge.sample({ include: ["physicsDebugSeries"], label: "settled" });

  await expect(sampling(installation, "settled"))
    .rejects.toThrow("TN_PLAYTEST_PHYSICS_LABEL_DUPLICATE: 'settled' was already sampled.");
  installation.dispose();
});

test("a physics provider without an authoritative tick refuses to install", () => {
  expect(() => installThreePlaytestBridge({
    camera: new PerspectiveCamera(),
    physics: { bodies: () => [] },
    renderer,
    scene: new Scene(),
  })).toThrow("A physics provider requires the authoritative tick provider, and therefore fixedStep.");
});

// Each of these would otherwise reach the evaluator as a body it simply skips, and a skipped
// body is an assertion quietly measuring fewer things than it claims.
test.each([
  ["an empty id", { id: "", position: [0, 0, 0], sleeping: true }, /TN_PLAYTEST_PHYSICS_BODY_ID/u],
  ["a non-boolean sleeping flag", { id: "crate.0", position: [0, 0, 0], sleeping: 1 }, /TN_PLAYTEST_PHYSICS_BODY_SLEEPING/u],
  ["a non-finite position", { id: "crate.0", position: [0, Number.NaN, 0], sleeping: true }, /TN_PLAYTEST_PHYSICS_BODY_POSITION/u],
  ["a short position", { id: "crate.0", position: [0, 0], sleeping: true }, /TN_PLAYTEST_PHYSICS_BODY_POSITION/u],
])("%s fails closed", async (_label, body, expected) => {
  const installation = installPhysicsBridge(() => [body as unknown as IThreePlaytestPhysicsBody]);

  await expect(sampling(installation, "settled")).rejects.toThrow(expected);
  installation.dispose();
});

test("two bodies sharing an id fail closed rather than collapsing into one pose", async () => {
  const installation = installPhysicsBridge(() => [
    { id: "crate.0", position: [0, 0, 0], sleeping: true },
    { id: "crate.0", position: [9, 9, 9], sleeping: true },
  ]);

  await expect(sampling(installation, "settled"))
    .rejects.toThrow("TN_PLAYTEST_PHYSICS_BODY_DUPLICATE: body id 'crate.0' was reported twice in one sample.");
  installation.dispose();
});
