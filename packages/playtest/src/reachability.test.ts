import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { evaluateRichPlaytestAssertions, loadPlaytestScenario } from "./index.js";

test("reachability loads the measured artifact and evaluates every consecutive hop", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "playtest-reachability-"));
  await mkdir(join(projectPath, "artifacts"));
  await writeFile(join(projectPath, "artifacts", "player.json"), JSON.stringify({ jump: { fallDistanceToGround: 4, forwardReach: 4, maxRise: 2.9 } }));
  await writeFile(join(projectPath, "scenario.json"), JSON.stringify({
    assert: { reachability: { artifact: "artifacts/player.json", entities: ["a", "b", "c"] } },
    name: "critical-path",
    schemaVersion: 1,
    steps: [{ release: true, waitTicks: 1 }],
  }));

  const scenario = await loadPlaytestScenario(projectPath, "scenario.json");
  const report = evaluateRichPlaytestAssertions({
    report: {
      diagnostics: [], distance: 0, entity: "player", expectMoved: false, frames: 1,
      observations: {
        console: [], hud: {}, network: [], resources: {},
        entityTransforms: {
          a: { position: [0, 0, 0], scale: [2, 1, 2] },
          b: { position: [4, 2, 0], scale: [2, 1, 6] },
          c: { position: [8, 5.5, 0], scale: [2, 1, 2] },
        },
      },
    },
    scenario,
  });

  assert.deepEqual(report.assertions.map(({ id, pass }) => ({ id, pass })), [
    { id: "reachability.0.a.b", pass: true },
    { id: "reachability.1.b.c", pass: false },
  ]);
  assert.equal(report.diagnostics[0]?.code, "TN_PLAYTEST_REACHABILITY_ASSERTION_FAILED");
  assert.equal(report.diagnostics[0]?.path, "/assert/reachability/entities/2");
  assert.match(report.diagnostics[0]?.suggestion ?? "", /Reduce the platform rise/u);
  assert.equal(Number(report.assertions[0]?.details?.horizontalLimit) > 4, true, "a target below the apex should use the descending arc, not apex distance");
});

test("reachability is explicit static envelope-fit and rejects falls beyond the measured landing", async () => {
  const report = evaluateRichPlaytestAssertions({
    report: {
      diagnostics: [], distance: 0, entity: "player", expectMoved: false, frames: 1,
      observations: { console: [], hud: {}, network: [], resources: {}, entityTransforms: {
        sameA: { position: [0, 0, 0], scale: [0, 0, 0] },
        sameB: { position: [7, 0, 0], scale: [0, 0, 0] },
        below: { position: [7, -3, 0], scale: [0, 0, 0] },
      } },
    },
    scenario: {
      assert: { reachability: { artifact: "unused", entities: ["sameA", "sameB", "below"], envelope: { fallDistanceToGround: 2.5, forwardReach: 4, maxRise: 2 } } },
      name: "static-fit", schemaVersion: 1, steps: [{ release: true, waitTicks: 1 }], target: "web", viewport: { height: 720, width: 1280 }, warmupFrames: 0,
    },
  });
  assert.deepEqual(report.assertions.map(({ details, pass }) => ({ constraint: details?.constraint, pass })), [
    { constraint: "static-movement-envelope-fit", pass: true },
    { constraint: "static-movement-envelope-fit", pass: false },
  ]);
});
