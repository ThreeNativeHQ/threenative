import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import * as ts from "typescript";
import { describe, expect, test } from "vitest";
import { evaluateRichPlaytestAssertions } from "../src/assertion-evaluators.js";
import { MOVEMENT_EVIDENCE_KINDS, MOVEMENT_EVALUATORS } from "../src/evaluators/movement-evidence.js";
import type { IPlaytestScenario } from "../src/scenario.js";

// PRD-182 Phase 1 characterization net: these tests pin CURRENT semantics of
// evaluateRichPlaytestAssertions - verdict ids, pass values, detail shapes, diagnostic codes
// and result ordering - so the Phase 2 file split cannot disturb them unnoticed. Behavior
// that looks wrong (e.g. tags passing with count 0) is pinned AS IS; fixing behavior is
// explicitly NOT this PRD. Every expected value below was captured from the unsplit module.
const base = {
  consoleErrors: 0,
  diagnostics: [],
  distance: 0,
  entity: "player",
  expectMoved: false,
  frames: 1,
  trivialityOptOuts: [],
  observations: { console: [], hud: {}, network: [], resources: {} },
};
function evaluate(assert_: IPlaytestScenario["assert"], extra: object = {}) {
  return evaluateRichPlaytestAssertions({
    report: { ...base, ...extra } as never,
    scenario: { assert: assert_, name: "c", schemaVersion: 1, steps: [{ release: true, waitTicks: 1 }] } as never,
  });
}

const TRIVIALITY_GUARD_OWNER = "triviality-guard.ts";

function referencesAllowTrivial(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return node.text === "allowTrivial";
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === "allowTrivial" || referencesAllowTrivial(node.expression);
  }
  if (ts.isElementAccessExpression(node)) {
    const property = node.argumentExpression;
    return (property !== undefined && ts.isStringLiteralLike(property) && property.text === "allowTrivial")
      || referencesAllowTrivial(node.expression);
  }
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node)) {
    return referencesAllowTrivial(node.expression);
  }
  return false;
}

function findTrivialityPredicates(source: string, path: string): number {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isTypeOfExpression(node) && referencesAllowTrivial(node.expression)) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}

function scanInlineTrivialityPredicates(files: Array<{ path: string; source: string }>) {
  return files
    .filter(({ path }) => path !== TRIVIALITY_GUARD_OWNER)
    .map(({ path, source }) => ({ count: findTrivialityPredicates(source, path), path }))
    .filter(({ count }) => count > 0);
}

describe("evaluator semantics (characterization)", () => {
  test("the guard has one definition and movement kinds have one dispatch entry", async () => {
    const root = new URL("../src/", import.meta.url);
    const matches = (await Promise.all((await readdir(root, { recursive: true }))
      .filter((path) => path.endsWith(".ts"))
      .map(async (path) => ({ path, source: await readFile(new URL(path, root), "utf8") }))))
      .map(({ path, source }) => ({ count: findTrivialityPredicates(source, path), path }))
      .filter(({ count }) => count > 0);
    expect(matches).toEqual([{ count: 1, path: "triviality-guard.ts" }]);
    expect(Object.keys(MOVEMENT_EVALUATORS).sort()).toEqual([...MOVEMENT_EVIDENCE_KINDS].sort());
  });
  test.each([
    `const duplicate = (assertion: { allowTrivial?: unknown }) => typeof assertion.allowTrivial === 'string';`,
    "const duplicate = (assertion: { allowTrivial?: unknown }) => typeof assertion.allowTrivial !== `string`;",
    `const duplicate = (assertion: { allowTrivial?: unknown }) =>
      typeof (assertion?.["allowTrivial"]) === "string";`,
  ])("rejects equivalent inline predicates regardless of quote, operator, or format: %s", (source) => {
    expect(scanInlineTrivialityPredicates([{ path: "duplicate.ts", source }])).toEqual([{ count: 1, path: "duplicate.ts" }]);
  });
  test("pre/post serialized verdicts match for every in-repo scenario", async () => {
    const golden = JSON.parse(await readFile(new URL("./fixtures/prd-200-verdicts.json", import.meta.url), "utf8"));
    const paths = execFileSync("rg", ["--files", "-g", "*.playtest.json", "-g", "!**/.worktrees/**"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).sort();
    expect({ source: golden.source, paths }).toEqual({ source: "edbee19fe90c672305568764b98e36620c507e9^", paths: golden.scenarios });
    expect(Object.keys(golden.verdicts).sort()).toEqual(paths);
    const report = { consoleErrors: 0, diagnostics: [], distance: 0, entity: "player", expectMoved: false, frames: 1, trivialityOptOuts: [], observations: { console: [], hud: {}, network: [], resources: {} } } as never;
    const diffs: string[] = [];
    for (const path of paths) {
      const parsed = JSON.parse(await readFile(join(process.cwd(), path), "utf8"));
      const scenario = { ...parsed, name: parsed.name ?? path, target: parsed.target ?? "web", schemaVersion: parsed.schemaVersion ?? 1, steps: parsed.steps ?? [], viewport: parsed.viewport ?? { height: 720, width: 1280 }, sourcePath: path } as never;
      if (JSON.stringify(evaluateRichPlaytestAssertions({ report, scenario })) !== golden.verdicts[path]) diffs.push(path);
    }
    console.log(`PRD-200 verdict parity: ${paths.length} scenarios; diff: ${diffs.length === 0 ? "empty" : diffs.join(",")}`);
    expect(diffs).toEqual([]);
  });
  test("movement pins its verdict id and minimum-distance details", () => {
    const result = evaluate(
      { movement: { entity: "player", minDistance: 1 } } as never,
      {
        expectMoved: true,
        before: { position: [0, 0, 0], tick: 0 },
        after: { position: [2, 0, 0], tick: 3 },
        movementDelta: [2, 0, 0],
        distance: 2,
      },
    );
    expect(result.assertions.map(({ id, pass }) => ({ id, pass }))).toEqual([
      { id: "diagnostics", pass: true },
      { id: "movement.distance", pass: true },
    ]);
    expect(result.assertions[1]?.details).toEqual({ distance: 2, entity: "player", minimum: 1 });
    expect(result.diagnostics).toEqual([]);
  });
  test("movement treats distance exactly equal to the minimum as passing", () => {
    // Boundary pin: >= not >. A flipped comparison must turn this row red.
    const atMinimum = evaluate(
      { movement: { entity: "player", minDistance: 2 } } as never,
      {
        expectMoved: true,
        before: { position: [0, 0, 0], tick: 0 },
        after: { position: [2, 0, 0], tick: 3 },
        movementDelta: [2, 0, 0],
        distance: 2,
      },
    );
    expect(atMinimum.assertions.find(({ id }) => id === "movement.distance")?.pass).toBe(true);

    const below = evaluate(
      { movement: { entity: "player", minDistance: 3 } } as never,
      {
        expectMoved: true,
        before: { position: [0, 0, 0], tick: 0 },
        after: { position: [2, 0, 0], tick: 3 },
        movementDelta: [2, 0, 0],
        distance: 2,
      },
    );
    expect(below.assertions.find(({ id }) => id === "movement.distance")?.pass).toBe(false);
  });
  test("world without a seed observation fails with its three-field detail shape", () => {
    const result = evaluate({ world: {} } as never);
    expect(result.assertions).toEqual([
      {
        details: { expectedRuntime: null, observed: null, observedRuntime: null },
        id: "world.seed",
        pass: false,
      },
      {
        details: {
          consoleErrors: 0,
          networkErrors: 0,
          policy: { noConsoleErrors: true, noNetworkErrors: true, noRuntimeDiagnostics: true },
          runtimeDiagnostics: 0,
        },
        id: "diagnostics",
        pass: true,
      },
    ]);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(["TN_PLAYTEST_WORLD_ASSERTION_FAILED"]);
  });
  test("states require terminal evidence even when the state already matches", () => {
    const result = evaluate(
      { states: [{ entity: "enemy", states: ["chase"] }] } as never,
      {
        observations: {
          console: [],
          hud: {},
          network: [],
          resources: {},
          runtimeObservations: { gameplay: { states: { enemy: "chase" } } },
        },
      },
    );
    const states = result.assertions.find(({ id }) => id === "states.enemy");
    expect(states?.pass).toBe(false);
    expect(states?.details).toMatchObject({
      candidates: [{ entity: "enemy", state: "chase" }],
      initialPass: true,
      observed: "chase",
      terminal: { contactObserved: true, historyComplete: true, preExisting: false, step: null },
      trivial: false,
    });
    expect(result.diagnostics.map(({ code }) => code)).toContain("TN_PLAYTEST_STATE_ASSERTION_FAILED");
  });
  test("a resource assertion with no rich evaluator registers as not-evaluated, never skipped", () => {
    const result = evaluate({ resources: [{ resources: ["gold"], type: "present" }] } as never);
    expect(result.assertions.find(({ id }) => id === "assert.resources")).toEqual({
      details: { reason: "registered-without-evaluator" },
      id: "assert.resources",
      pass: false,
    });
    expect(result.diagnostics.map(({ code }) => code)).toEqual(["TN_PLAYTEST_ASSERTION_NOT_EVALUATED"]);
  });

  test("a blank capture fails the declared visual rows instead of passing them", () => {
    // Decided 2026-08-23: green rows for unevaluated assertions are the v1 dropped-assertion
    // shape this package fails closed against; a capture failure is a missing observation.
    const result = evaluate(
      { visual: [{ frameDiff: { minChangedPixelRatio: 0.01 } }] } as never,
      {
        observations: {
          console: [],
          hud: {},
          network: [],
          resources: {},
          visual: {
            captureFailure: { code: "TN_CAPTURE_BLANK", label: "after.png", reason: "uniform" },
          },
        },
      },
    );
    const row = result.assertions.find(({ id }) => id === "visual.0");
    expect(row?.pass).toBe(false);
    expect(row?.details).toMatchObject({
      captureFailure: { code: "TN_CAPTURE_BLANK" },
      reason: "not-evaluated",
    });
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "TN_PLAYTEST_ASSERTION_NOT_EVALUATED",
    );
  });

  test("empty assertion arrays register as not-evaluated per family, in family order", () => {
    const result = evaluate({ hud: [], resources: [], visual: [] } as never);
    const summary = result.assertions.map((entry) => ({ id: entry.id, pass: entry.pass }));
    expect(summary.filter((entry) => entry.id !== "diagnostics")).toEqual([
      { id: "assert.visual", pass: false },
      { id: "assert.resources", pass: false },
      { id: "assert.hud", pass: false },
    ]);
    expect(result.diagnostics.filter((d) => d.code === "TN_PLAYTEST_ASSERTION_NOT_EVALUATED")).toHaveLength(3);
  });

  test("composite scenarios keep a stable assertion order across families", () => {
    const result = evaluate(
      {
        reachability: { artifact: "unused", entities: ["a", "b"] },
        world: {},
      } as never,
      {
        observations: {
          console: [],
          hud: {},
          network: [],
          resources: {},
          entityTransforms: {
            a: { position: [0, 0, 0], scale: [1, 1, 1] },
            b: { position: [1, 0, 0], scale: [1, 1, 1] },
          },
        },
      },
    );
    expect(result.assertions.map(({ id }) => id)).toEqual([
      "reachability.0.a.b",
      "world.seed",
      "diagnostics",
    ]);
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      "TN_PLAYTEST_REACHABILITY_ASSERTION_FAILED",
      "TN_PLAYTEST_WORLD_ASSERTION_FAILED",
    ]);
  });

  test("framebuffer coverage pins its diagnostic ladder in priority order", () => {
    const unreadable = evaluate(
      {
        framebufferCoverage: { backdrop: [0, 0, 0], tolerance: 0, window: { endStep: "x", startStep: "x" } },
      } as never,
      {
        observations: {
          console: [],
          framebufferCoverage: { unreadableReason: "no readback" },
          hud: {},
          network: [],
          resources: {},
        },
      },
    );
    expect(unreadable.diagnostics[0]?.code).toBe("TN_PLAYTEST_FRAMEBUFFER_PIXELS_UNREADABLE");

    const windowMissing = evaluate(
      {
        framebufferCoverage: { backdrop: [0, 0, 0], tolerance: 0, window: { endStep: "x", startStep: "x" } },
      } as never,
      {
        observations: {
          console: [],
          framebufferCoverage: { frameCount: 3, windowCompleted: false, windowStarted: true },
          hud: {},
          network: [],
          resources: {},
        } as never,
      },
    );
    expect(windowMissing.diagnostics[0]?.code).toBe("TN_PLAYTEST_FRAMEBUFFER_WINDOW_NOT_REACHED");
  });

  test("a camera-only scenario with nothing observed reports no evaluated assertions", () => {
    const result = evaluate({ camera: { follow: true, entity: "player" } } as never, {
      follow: { offset: [0, 2, 5] },
    });
    expect(result.diagnostics.map(({ code }) => code)).toEqual(["TN_PLAYTEST_SCENARIO_NO_ASSERTIONS"]);
    expect(result.assertions.find(({ id }) => id === "scenario.assertions")?.details).toEqual({
      reason: "no-evaluated-assertions",
    });
  });
});
