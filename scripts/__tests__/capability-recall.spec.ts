import { describe, expect, it } from "vitest";
import type { ICapabilitySearchResult } from "../../packages/engine-mcp/src/index.js";
import {
  type CapabilitySearcher,
  type ICapabilityRecallBudget,
  type ICapabilityRecallRow,
  compareBudget,
  measureRecall,
  resolveCorpusSources,
  validateCorpus,
} from "../capability-recall.js";

const manifestFile = "packages/create-threenative/capabilities.json";

function row(overrides: Partial<ICapabilityRecallRow> = {}): ICapabilityRecallRow {
  return {
    expect: ["GroundSnap"],
    id: "fixture.row",
    query: "keep a character's feet on the floor",
    reject: [],
    scope: "mechanic",
    source: "template:starter#What the framework owns, and what you own",
    ...overrides,
  };
}

function result(symbol: string): ICapabilitySearchResult {
  return {
    constraints: [],
    example: "const capability = new GroundSnap();",
    importPath: "@threenative/core",
    matchedSituation: "fixture",
    summary: "fixture",
    symbol,
  };
}

function budget(overrides: Partial<ICapabilityRecallBudget> = {}): ICapabilityRecallBudget {
  return {
    recallAtK: 0,
    recalledRows: [],
    rejectHits: 0,
    rowCount: 1,
    version: 1,
    zeroResultRate: 0,
    ...overrides,
  };
}

describe("capability recall gate", () => {
  it("should throw when the corpus is empty", () => {
    expect(() => validateCorpus({ rows: [], version: 1 })).toThrow(
      "TN_CAPABILITY_RECALL: corpus.json: corpus has no rows",
    );
  });

  it("should throw when a row expects a symbol absent from the manifest", () => {
    expect(() =>
      measureRecall([row({ expect: ["RenamedCapability"] })], manifestFile, (() => [
        result("GroundSnap"),
      ]) as CapabilitySearcher),
    ).toThrow("RenamedCapability");
  });

  it("should throw when a source pointer no longer resolves", async () => {
    await expect(
      resolveCorpusSources([row({ source: "template:starter#Heading removed by a later edit" })]),
    ).rejects.toThrow("template:starter#Heading removed by a later edit");
  });

  it("should count a row as a miss when no expected symbol is returned", () => {
    const measurement = measureRecall([row()], manifestFile, (() => []) as CapabilitySearcher);
    expect(measurement.metrics.recallAtK).toBe(0);
    expect(measurement.rows[0]?.recalled).toBe(false);
  });

  it("should fail when zeroResultRate exceeds the recorded floor", () => {
    const measurement = measureRecall([row()], manifestFile, (() => []) as CapabilitySearcher);
    const regressions = compareBudget(measurement, budget());
    expect(regressions).toContainEqual({
      message: "zeroResultRate 1.000000 exceeds floor 0.000000",
      metric: "zeroResultRate",
      rowIds: ["fixture.row"],
    });
  });

  it("should fail when rowCount drops below the floor", () => {
    const measurement = measureRecall([row()], manifestFile, (() => [
      result("GroundSnap"),
    ]) as CapabilitySearcher);
    const regressions = compareBudget(measurement, budget({ rowCount: 2 }));
    expect(regressions).toContainEqual({
      message: "rowCount 1 is below floor 2",
      metric: "rowCount",
      rowIds: ["corpus"],
    });
  });

  it("should reject a lost baseline hit when another row compensates", () => {
    const measurement = measureRecall(
      [
        row({ id: "baseline.hit", query: "lost baseline hit" }),
        row({ id: "compensating.improvement", query: "newly recalled" }),
      ],
      manifestFile,
      ((query: string) =>
        query === "newly recalled" ? [result("GroundSnap")] : []) as CapabilitySearcher,
    );
    const protectedBudget = budget({
      recallAtK: 0.5,
      recalledRows: ["baseline.hit"],
      rowCount: 2,
      zeroResultRate: 0.5,
    });

    expect(measurement.metrics.recallAtK).toBe(protectedBudget.recallAtK);
    expect(measurement.metrics.zeroResultRate).toBe(protectedBudget.zeroResultRate);
    expect(compareBudget(measurement, protectedBudget)).toContainEqual({
      message: "1 previously recalled row no longer reaches an expected symbol",
      metric: "recalledRows",
      rowIds: ["baseline.hit"],
    });
  });

  it("should resolve and score the complete text of a wrapped brief bullet", async () => {
    const wrappedQuery =
      "Use a third-person camera and a compact hub that leads to at least two distinct areas. Name the starting area the literal `hub`; the proof compares `state.area` against that word.";
    const wrappedRow = row({
      expect: ["defineGame"],
      id: "brief.exploration.wrapped",
      query: wrappedQuery,
      source: "brief:exploration#1",
    });

    await expect(resolveCorpusSources([wrappedRow])).resolves.toBeUndefined();
    let searchedQuery = "";
    const measurement = measureRecall([wrappedRow], manifestFile, ((query: string) => {
      searchedQuery = query;
      return [result("defineGame")];
    }) as CapabilitySearcher);

    expect(searchedQuery).toBe(wrappedQuery);
    expect(measurement.rows[0]?.query).toBe(wrappedQuery);
    expect(measurement.rows[0]?.recalled).toBe(true);
  });

  it("should pass when every number improves", () => {
    const measurement = measureRecall([row()], manifestFile, (() => [
      result("GroundSnap"),
    ]) as CapabilitySearcher);
    expect(
      compareBudget(measurement, budget({ recallAtK: 0.5, rejectHits: 1, zeroResultRate: 1 })),
    ).toEqual([]);
  });
});
