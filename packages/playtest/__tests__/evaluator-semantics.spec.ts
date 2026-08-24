import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import * as ts from "typescript";
import { describe, expect, test } from "vitest";
import { evaluateRichPlaytestAssertions } from "../src/assertion-evaluators.js";
import { MOVEMENT_EVIDENCE_KINDS, MOVEMENT_EVALUATORS } from "../src/evaluators/movement-evidence.js";
import { buildReport } from "../src/runner/runner-support.js";
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
const observations = (extra: object = {}) => ({ ...base.observations, ...extra });
const movementReport = (minimum: number, distance = 2) => evaluate(
  { movement: { entity: "player", minDistance: minimum } } as never,
  { after: { position: [distance, 0, 0], tick: 3 }, before: { position: [0, 0, 0], tick: 0 }, distance, expectMoved: true, movementDelta: [distance, 0, 0] },
);
const TRIVIALITY_GUARD_OWNER = "triviality-guard.ts";
function referencesAllowTrivial(node: ts.Node, aliases: ReadonlySet<string> = new Set()): boolean {
  if (ts.isIdentifier(node)) return node.text === "allowTrivial" || aliases.has(node.text);
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === "allowTrivial" || referencesAllowTrivial(node.expression, aliases);
  }
  if (ts.isElementAccessExpression(node)) {
    const property = node.argumentExpression;
    return (property !== undefined && ts.isStringLiteralLike(property) && property.text === "allowTrivial")
      || referencesAllowTrivial(node.expression, aliases);
  }
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node)) {
    return referencesAllowTrivial(node.expression, aliases);
  }
  return false;
}
function collectAllowTrivialAliases(file: ts.SourceFile): Set<string> {
  const aliases = new Set<string>();
  let aliasesChanged = true;
  while (aliasesChanged) {
    aliasesChanged = false;
    const collect = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.initializer !== undefined
        && referencesAllowTrivial(node.initializer, aliases)
        && !aliases.has(node.name.text)
      ) {
        aliases.add(node.name.text);
        aliasesChanged = true;
      }
      ts.forEachChild(node, collect);
    };
    collect(file);
  }
  return aliases;
}
function findTrivialityPredicates(source: string, path: string): number {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const aliases = collectAllowTrivialAliases(file);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isTypeOfExpression(node) && referencesAllowTrivial(node.expression, aliases)) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}
function contains(node: ts.Node, predicate: (node: ts.Node) => boolean): boolean {
  if (predicate(node)) return true;
  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && contains(child, predicate)) found = true;
  });
  return found;
}
function isNegatedTrivial(node: ts.Node): boolean {
  return ts.isPrefixUnaryExpression(node)
    && node.operator === ts.SyntaxKind.ExclamationToken
    && ts.isIdentifier(node.operand)
    && node.operand.text === "trivial";
}
function isTrivialityOptOut(node: ts.Node, aliases: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(node) && node.text === "trivialityOptOut") return true;
  if (ts.isTypeOfExpression(node) && referencesAllowTrivial(node.expression, aliases)) return true;
  return ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === "isStringValue"
    && node.arguments.some((argument) => referencesAllowTrivial(argument, aliases));
}
function findTrivialityEnforcements(source: string, path: string): number {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const aliases = collectAllowTrivialAliases(file);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const operands = [node.left, node.right];
      const comparison = operands.find((operand) => ts.isIdentifier(operand) && operand.text === "comparisonPass");
      const guard = operands.find((operand) => contains(operand, isNegatedTrivial));
      if (comparison !== undefined && guard !== undefined && contains(guard, (child) => isTrivialityOptOut(child, aliases))) count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}
function scanGuardSources(files: Array<{ path: string; source: string }>) {
  return files
    .map(({ path, source }) => ({
      enforcementCount: findTrivialityEnforcements(source, path),
      path,
      predicateCount: findTrivialityPredicates(source, path),
    }))
    .filter(({ enforcementCount, predicateCount }) => enforcementCount > 0 || predicateCount > 0);
}
function scanInlineTrivialityPredicates(files: Array<{ path: string; source: string }>) {
  return files
    .filter(({ path }) => path !== TRIVIALITY_GUARD_OWNER)
    .map(({ path, source }) => ({ count: findTrivialityPredicates(source, path), path }))
    .filter(({ count }) => count > 0);
}
const PARITY_CONFIG = {
  allowSoftwareAdapter: true,
  artifactDirectory: "artifacts/prd-200-parity",
  headless: true,
  projectPath: process.cwd(),
  timeoutMs: 1,
  trace: false,
  url: "http://127.0.0.1:1",
};
const parityHash = (path: string) => [...path].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) % 997, 17);
const paritySnapshot = (entity: string, position: [number, number, number], tick: number) => ({
  clock: { mode: "fixed-step" as const, tick },
  ...(entity === "" ? {} : { entities: [{ id: entity, transform: { position }, visible: true }] }),
});
function buildParityReport(path: string, scenario: IPlaytestScenario) {
  const movement = scenario.assert?.movement;
  const entity = movement?.entity ?? scenario.subject ?? "";
  const distance = movement?.minDistance === undefined ? parityHash(path) % 3 / 2 : movement.minDistance + 1;
  const tick = parityHash(path);
  const beforeSnapshot = paritySnapshot(entity, [0, 0, 0], tick);
  const afterSnapshot = paritySnapshot(entity, [distance, 0, 0], tick + 1);
  const movementSamples = movement !== undefined && movement.entity === undefined && scenario.subject === undefined
    ? [{ after: paritySnapshot("player", [0, 0, 0], tick), before: paritySnapshot("player", [0, 0, 0], tick - 1), inputDriven: false }, { after: paritySnapshot("player", [distance, 0, 0], tick + 1), before: paritySnapshot("player", [0, 0, 0], tick), inputDriven: true }]
    : [];
  return buildReport({
    afterSnapshot,
    beforeSnapshot,
    config: { ...PARITY_CONFIG, scenarioPath: path },
    consoleEntries: [],
    movementSamples,
    networkEntries: [],
    pathLength: distance,
    scenario,
  });
}
const projectReport = (report: { assertionResults?: unknown; diagnostics: unknown }) => JSON.stringify({ assertions: report.assertionResults ?? [], diagnostics: report.diagnostics });
describe("evaluator semantics (characterization)", () => {
  test("the guard has one definition and movement kinds have one dispatch entry", async () => {
    const root = new URL("../src/", import.meta.url);
    const sources = await Promise.all((await readdir(root, { recursive: true }))
      .filter((path) => path.endsWith(".ts"))
      .map(async (path) => ({ path, source: await readFile(new URL(path, root), "utf8") })));
    expect(scanGuardSources(sources)).toEqual([{ enforcementCount: 1, path: TRIVIALITY_GUARD_OWNER, predicateCount: 1 }]);
    expect(Object.keys(MOVEMENT_EVALUATORS).sort()).toEqual([...MOVEMENT_EVIDENCE_KINDS].sort());
  });
  test("guard source mutations fail the uniqueness gate", async () => {
    const ownerSource = await readFile(new URL("../src/triviality-guard.ts", import.meta.url), "utf8");
    const expected = [{ enforcementCount: 1, path: TRIVIALITY_GUARD_OWNER, predicateCount: 1 }];
    const helperDuplicate = `${ownerSource}\nconst duplicate = (comparisonPass: boolean, trivial: boolean, allowTrivial: unknown) => comparisonPass && (!trivial || isStringValue(allowTrivial));`;
    const enforcementRemoved = ownerSource.replace("pass: comparisonPass && (!trivial || trivialityOptOut)", "pass: comparisonPass");
    expect(enforcementRemoved).not.toBe(ownerSource);
    expect(scanGuardSources([{ path: TRIVIALITY_GUARD_OWNER, source: helperDuplicate }])).not.toEqual(expected);
    expect(scanGuardSources([{ path: TRIVIALITY_GUARD_OWNER, source: enforcementRemoved }])).not.toEqual(expected);
  });
  test.each([
    `const duplicate = (assertion: { allowTrivial?: unknown }) => typeof assertion.allowTrivial === 'string';`,
    "const duplicate = (assertion: { allowTrivial?: unknown }) => typeof assertion.allowTrivial !== `string`;",
    `const duplicate = (assertion: { allowTrivial?: unknown }) =>
      typeof (assertion?.["allowTrivial"]) === "string";`,
    `const duplicate = (assertion: { allowTrivial?: unknown }) => {
      const waiver = assertion.allowTrivial;
      return typeof waiver === "string";
    };`,
  ])("rejects equivalent inline predicates regardless of quote, operator, or format: %s", (source) => {
    expect(scanInlineTrivialityPredicates([{ path: "duplicate.ts", source }])).toEqual([{ count: 1, path: "duplicate.ts" }]);
  });
  test("pre/post serialized verdicts match for every in-repo scenario", async () => {
    const golden = JSON.parse(await readFile(new URL("./fixtures/prd-200-verdicts.json", import.meta.url), "utf8"));
    const paths = execFileSync("rg", ["--files", "-g", "*.playtest.json", "-g", "!**/.worktrees/**"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).sort();
    expect({ source: golden.source, paths }).toEqual({ source: "edbee19fe90c672305568764b98e36620c507e9^", paths: golden.scenarios });
    expect(Object.keys(golden.verdicts).sort()).toEqual(paths);
    const diffs: string[] = [];
    for (const path of paths) {
      const parsed = JSON.parse(await readFile(join(process.cwd(), path), "utf8"));
      const scenario = { ...parsed, name: parsed.name ?? path, target: parsed.target ?? "web", schemaVersion: parsed.schemaVersion ?? 1, steps: parsed.steps ?? [], viewport: parsed.viewport ?? { height: 720, width: 1280 }, sourcePath: path } as never;
      if (projectReport(buildParityReport(path, scenario)) !== golden.verdicts[path]) diffs.push(path);
    }
    console.log(`PRD-200 verdict parity: ${paths.length} scenarios; diff: ${diffs.length === 0 ? "empty" : diffs.join(",")}`);
    expect(diffs).toEqual([]);
  });
  test("parity rejects bypassing production report assembly", () => {
    const scenario = { name: "build-report-red-control", schemaVersion: 1, steps: [{ release: true, waitTicks: 1 }], assert: { movement: { entity: "player", minDistance: 1 } } } as never;
    const assembled = buildParityReport("red-control.playtest.json", scenario);
    const bypassed = evaluateRichPlaytestAssertions({ report: { ...base, entity: "player" } as never, scenario });
    expect(assembled.assertionResults?.find(({ id }) => id === "movement.distance")?.pass).toBe(true);
    expect(bypassed.assertions.find(({ id }) => id === "movement.distance")?.pass).toBe(false);
    expect(projectReport(assembled)).not.toBe(JSON.stringify(bypassed));
  });
  test("movement pins its verdict id and minimum-distance details", () => {
    const result = movementReport(1);
    expect(result.assertions.map(({ id, pass }) => ({ id, pass }))).toEqual([
      { id: "diagnostics", pass: true },
      { id: "movement.distance", pass: true },
    ]);
    expect(result.assertions[1]?.details).toEqual({ distance: 2, entity: "player", minimum: 1 });
    expect(result.diagnostics).toEqual([]);
  });
  test("movement treats distance exactly equal to the minimum as passing", () => {
    // Boundary pin: >= not >. A flipped comparison must turn this row red.
    const atMinimum = movementReport(2);
    expect(atMinimum.assertions.find(({ id }) => id === "movement.distance")?.pass).toBe(true);
    const below = movementReport(3);
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
        observations: observations({ runtimeObservations: { gameplay: { states: { enemy: "chase" } } } }),
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
        observations: observations({ visual: { captureFailure: { code: "TN_CAPTURE_BLANK", label: "after.png", reason: "uniform" } } }),
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
        observations: observations({ entityTransforms: {
          a: { position: [0, 0, 0], scale: [1, 1, 1] },
          b: { position: [1, 0, 0], scale: [1, 1, 1] },
        } }),
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
        observations: observations({ framebufferCoverage: { unreadableReason: "no readback" } }),
      },
    );
    expect(unreadable.diagnostics[0]?.code).toBe("TN_PLAYTEST_FRAMEBUFFER_PIXELS_UNREADABLE");

    const windowMissing = evaluate(
      {
        framebufferCoverage: { backdrop: [0, 0, 0], tolerance: 0, window: { endStep: "x", startStep: "x" } },
      } as never,
      {
        observations: observations({ framebufferCoverage: { frameCount: 3, windowCompleted: false, windowStarted: true } }) as never,
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
