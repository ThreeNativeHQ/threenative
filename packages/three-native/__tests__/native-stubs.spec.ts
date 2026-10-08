import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  type INativeStubLedger,
  gateProblems,
  ledgerProblems,
  readNativeStubLedger,
} from "../scripts/native-stubs.js";

const REPO = process.cwd();
const LEDGER = path.join(REPO, "packages/three-native/api/native-stubs.json");

/**
 * The ledger's size as committed. The owner forbids stubs and mocks in the shipped engine, so this
 * is 0; raising it is a decision that has to show up in a diff of this file, not only the ledger.
 */
const COMMITTED_STUB_COUNT = 0;

const entry = { symbol: "three/webgpu:TempNode", prd: "PRD-531", reason: "post node lifecycle" };

describe("native stub ledger", () => {
  it("is well formed, every entry owned by an open PRD, and no larger than committed", () => {
    expect(ledgerProblems(readNativeStubLedger(LEDGER), COMMITTED_STUB_COUNT, REPO)).toEqual([]);
  });

  it("refuses an entry without a PRD, an unknown or finished PRD, and a repeated symbol", () => {
    const ledger: INativeStubLedger = {
      entries: [
        { ...entry, symbol: "three:A", prd: "" },
        { ...entry, symbol: "three:B", prd: "PRD-999999" },
        { ...entry, symbol: "three:C", prd: "PRD-526" },
        { ...entry, symbol: "TempNode" },
        { ...entry, symbol: "three:D", reason: "" },
        entry,
        entry,
      ],
    };
    expect(ledgerProblems(ledger, 7, REPO)).toEqual([
      "three:A: names no PRD (expected PRD-<number>)",
      "three:B: PRD-999999 has no file under docs/PRDs",
      "three:C: PRD-526 is done; its stub outlived it",
      "TempNode: symbol is not a bundler refusal (`specifier:name`)",
      "three:D: names no reason",
      "three/webgpu:TempNode: listed more than once",
    ]);
  });

  it("refuses growth past the committed count", () => {
    expect(ledgerProblems({ entries: [entry] }, 0, REPO)).toEqual([
      "ledger holds 1 entries, above the committed 0: lower it, or raise COMMITTED_STUB_COUNT in the same diff",
    ]);
  });

  it("blocks promotion and deletion while any entry remains", () => {
    expect(gateProblems({ entries: [] })).toEqual([]);
    expect(gateProblems({ entries: [entry] })).toEqual([
      "TN_NATIVE_STUBS_PRESENT: three/webgpu:TempNode (PRD-531: post node lifecycle)",
    ]);
  });

  it("fails closed on a ledger that is not an entries array", () => {
    expect(() => readNativeStubLedger(path.join(REPO, "package.json"))).toThrow(
      /TN_NATIVE_STUBS_INVALID/,
    );
  });
});
