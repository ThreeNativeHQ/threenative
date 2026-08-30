import { describe, expect, test } from "vitest";

import {
  axisIndex,
  componentAssertionDiagnostic,
  consoleErrors,
  expectedPathAssertion,
  finiteVector,
  isRecord,
  jsonEqual,
  parseMovementAxisExpectation,
  pathAssertionDiagnostic,
  readPath,
  readRotation,
  readVec3,
  record,
  resolveDiagnosticsPolicy,
  runtimeDiagnostics,
  runtimeDiagnosticsSnapshot,
  textValue,
  trivialAssertionDiagnostic,
  vectorDistance,
} from "../src/assertion-report.js";

describe("assertion report utilities", () => {
  test("resolves diagnostic defaults and preserves explicit policy fields", () => {
    expect(resolveDiagnosticsPolicy(undefined)).toEqual({
      noConsoleErrors: true,
      noNetworkErrors: true,
      noRuntimeDiagnostics: true,
    });
    expect(resolveDiagnosticsPolicy({
      consoleErrorsOptOutReason: "browser noise",
      networkErrorsOptOutReason: "offline fixture",
      noConsoleErrors: false,
      noNetworkErrors: false,
      noRuntimeDiagnostics: false,
      runtimeDiagnosticsOptOutReason: "known warning",
      runtimeReady: true,
    } as never)).toEqual({
      consoleErrorsOptOutReason: "browser noise",
      networkErrorsOptOutReason: "offline fixture",
      noConsoleErrors: false,
      noNetworkErrors: false,
      noRuntimeDiagnostics: false,
      runtimeDiagnosticsOptOutReason: "known warning",
      runtimeReady: true,
    });
  });

  test("formats assertion diagnostics with optional paths and source locations", () => {
    expect(trivialAssertionDiagnostic("resource.score", undefined, 3, undefined)).toMatchObject({
      code: "TN_PLAYTEST_ASSERTION_TRIVIAL",
      message: "Assertion 'resource.score' was already satisfied before the scenario ran (value 3).",
      path: undefined,
    });
    expect(trivialAssertionDiagnostic("resource.score", "value.current", { value: 3 }, "scenario.json")).toMatchObject({
      message: "Assertion 'resource.score' at path 'value.current' was already satisfied before the scenario ran (value {\"value\":3}).",
      sourcePath: "scenario.json",
    });
    expect(componentAssertionDiagnostic({ component: "Health", entity: "player" } as never, undefined, { value: 1 })).toMatchObject({
      code: "TN_PLAYTEST_COMPONENT_ASSERTION_FAILED",
      message: "Component 'Health' on entity 'player' did not satisfy the assertion.",
    });
    expect(componentAssertionDiagnostic({ component: "Health", entity: "player", path: "current" } as never, 0, 1).message).toContain("path 'current'");
  });

  test("validates vectors, records, JSON equality, and path assertion projections", () => {
    expect(finiteVector([0, 1, 2])).toBe(true);
    expect(finiteVector([0, 1])).toBe(false);
    expect(finiteVector([0, Number.NaN, 2])).toBe(false);
    expect(record({ value: 1 })).toEqual({ value: 1 });
    expect(record([])).toBeUndefined();
    expect(isRecord({})).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(expectedPathAssertion({
      allowTrivial: "held",
      atSteps: [{ label: "end" }],
      changed: true,
      equals: "done",
      gte: 1,
      lte: 2,
      textIncludes: "ok",
      throughoutSteps: true,
    } as never)).toEqual({
      allowTrivial: "held",
      atSteps: [{ label: "end" }],
      changed: true,
      equals: "done",
      gte: 1,
      lte: 2,
      textIncludes: "ok",
      throughoutSteps: true,
    });
    expect(vectorDistance([0, 0, 0], [1, 2, 2])).toBe(3);
  });

  test("chooses the most specific resource stagnation diagnostic", () => {
    const assertion = { id: "GameState", path: "score" } as never;
    const noLog = pathAssertionDiagnostic("resource", assertion, 1, 1, { movedDistance: 2 });
    expect(noLog).toMatchObject({
      code: "TN_PLAYTEST_RESOURCE_STATE_STAGNATED",
      path: "playtest/assert/resources/GameState/score",
      resourceId: "GameState",
    });
    expect(noLog.suggestion).toContain("never changed");

    const withLog = pathAssertionDiagnostic("resource", assertion, { score: 2 }, { score: 2 }, {
      effectLog: {
        entries: [
          { kind: "resource", resource: "GameState", system: "pickup", value: { score: 2 } },
          { kind: "resource", resource: "GameState", system: "pickup", value: { score: 2 } },
        ],
      },
      movedDistance: 2,
      scenarioSourcePath: "playtests/score.json",
    });
    expect(withLog).toMatchObject({
      code: "TN_PLAYTEST_RESOURCE_STATE_STAGNATED",
      sourcePath: "content/systems/pickup.systems.json",
      systemId: "pickup",
    });
    expect(withLog.suggestion).toContain("2 'GameState' resource snapshot(s)");
  });

  test("uses ordinary HUD/resource diagnostics when stagnation evidence does not apply", () => {
    expect(pathAssertionDiagnostic("hud", { id: "score", path: "text" } as never, 1, 1, {})).toMatchObject({
      code: "",
      message: "HUD assertion failed for 'score' path 'text'.",
    });
    expect(pathAssertionDiagnostic("resource", { id: "score" } as never, 1, 2, {})).toMatchObject({
      code: "",
      message: "Resource assertion failed for 'score'.",
    });
    expect(pathAssertionDiagnostic("hud", { id: "score" } as never, 1, 1, {}).suggestion).toContain("did not change");
    expect(pathAssertionDiagnostic("resource", { id: "score" } as never, 1, 2, {}).suggestion).toContain("resource IDs");
  });

  test("unwraps runtime diagnostic envelopes and combines runtime/resource failures", () => {
    expect(runtimeDiagnosticsSnapshot({ diagnostics: { recentRuntimeErrors: ["error"] } })).toEqual({ recentRuntimeErrors: ["error"] });
    expect(runtimeDiagnosticsSnapshot({ recentRuntimeErrors: ["error"] })).toEqual({ recentRuntimeErrors: ["error"] });
    expect(runtimeDiagnostics(undefined)).toEqual([]);
    expect(runtimeDiagnostics({ recentRuntimeErrors: ["error"], assets: { resourceFailures: ["asset"] } })).toEqual(["error", "asset"]);
    expect(runtimeDiagnostics({ diagnostics: { recentRuntimeErrors: ["nested"] } })).toEqual(["nested"]);
    expect(runtimeDiagnostics({ recentRuntimeErrors: "bad", assets: { resourceFailures: "bad" } })).toEqual([]);
    expect(consoleErrors([{ type: "log" }, { type: "error" }, { type: "assert" }, { type: "pageerror" }])).toEqual([
      { type: "error" },
      { type: "assert" },
      { type: "pageerror" },
    ]);
  });

  test("reads dotted object and array paths without coercion", () => {
    const value = { items: [{ score: 7 }] };
    expect(readPath(value, undefined)).toBe(value);
    expect(readPath(value, "")).toBe(value);
    expect(readPath(value, "items.0.score")).toBe(7);
    expect(readPath(value, "items.00.score")).toBeUndefined();
    expect(readPath(value, "items.one.score")).toBeUndefined();
    expect(readPath({ items: 1 }, "items.score")).toBeUndefined();
  });

  test("parses signed movement axes and reads rotations/vectors safely", () => {
    expect(parseMovementAxisExpectation("x")).toEqual({ axis: "x" });
    expect(parseMovementAxisExpectation("y")).toEqual({ axis: "y" });
    expect(parseMovementAxisExpectation("z")).toEqual({ axis: "z" });
    expect(parseMovementAxisExpectation("+x")).toEqual({ axis: "x", sign: 1 });
    expect(parseMovementAxisExpectation("-z")).toEqual({ axis: "z", sign: -1 });
    expect(parseMovementAxisExpectation("north")).toBeUndefined();
    expect(axisIndex("x")).toBe(0);
    expect(axisIndex("y")).toBe(1);
    expect(axisIndex("z")).toBe(2);
    expect(textValue({ text: "text", label: "label", value: "value" })).toBe("text");
    expect(textValue({ label: "label", value: "value" })).toBe("label");
    expect(textValue({ valueText: "valueText", value: "value" })).toBe("valueText");
    expect(textValue({ value: "value" })).toBe("value");
    expect(textValue(3)).toBe(3);
    expect(readRotation({ rotation: [1, 2, 3, 4] })).toEqual([1, 2, 3]);
    expect(readRotation(undefined)).toBeUndefined();
    expect(readRotation({ rotation: [1, 2] })).toBeUndefined();
    expect(readRotation({ rotation: [1, Number.NaN, 3] })).toBeUndefined();
    expect(readVec3([1, 2, 3, 4])).toEqual([1, 2, 3]);
    expect(readVec3(undefined)).toBeUndefined();
    expect(readVec3([1, 2])).toBeUndefined();
    expect(readVec3([1, Number.POSITIVE_INFINITY, 3])).toBeUndefined();
  });
});
