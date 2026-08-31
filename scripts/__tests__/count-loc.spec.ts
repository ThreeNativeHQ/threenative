import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { makeTempDirSync } from "../../test-support/temp-dir.js";

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertFrameworkImportClosure,
  assertFrameworkRatchet,
  classifyVanillaLine,
  collectLoc,
  countGeneratedHudLoc,
  countLines,
  countPlatformerTemplateLoc,
  countSoftBodyFeatureLoc,
  countTemplateTouchControlsLoc,
  countWorldHeightfieldLoc,
  normaliseSource,
  renderLocTable,
} from "../count-loc.js";

describe("count-loc", () => {
  it("classifies a known fixture exactly", () => {
    const fixture = [
      ...Array.from({ length: 10 }, () => "// plumbing"),
      ...Array.from({ length: 20 }, () => "game();"),
    ].join("\n");

    expect(countLines(fixture, classifyVanillaLine)).toEqual({ plumbing: 10, game: 20, total: 30 });
  });

  it("reports both benchmark arms and all physical source lines", () => {
    const rows = collectLoc();
    const vanilla = rows.filter((row) => row.arm === "vanilla");
    const framework = rows.filter((row) => row.arm === "framework");

    expect(vanilla).toHaveLength(1);
    expect(framework).toHaveLength(4);
    expect(vanilla[0]?.raw).toBe(410);
    expect(vanilla[0]?.total).toBe(473);
    expect(rows.every((row) => row.plumbing + row.game === row.total)).toBe(true);
  });

  it("normalises packed and expanded versions of the same program to the same count", () => {
    const packed = "const value=1;\n";
    const expanded = "const value =\n  1;\n";
    expect(packed.split("\n").length).not.toBe(expanded.split("\n").length);
    expect(countLines(normaliseSource(packed, "fixture.ts"), classifyVanillaLine).total).toBe(
      countLines(normaliseSource(expanded, "fixture.ts"), classifyVanillaLine).total,
    );
  });

  it("renders a generated table with an explicit vanilla result column", () => {
    const table = renderLocTable(collectLoc());

    expect(table).toContain("Plumbing LOC");
    expect(table).toContain("Raw LOC");
    expect(table).toContain("Normalised LOC");
    expect(table).toContain("93.2%");
    expect(table).toContain("Vanilla wins?");
    expect(table).toContain("Static result:");
  });

  it("fails closed when a counted fixture imports an uncounted sibling", () => {
    const root = makeTempDirSync("count-loc-closure-");
    try {
      writeFileSync(join(root, "main.ts"), 'import "./helper.js";\n');
      writeFileSync(join(root, "helper.ts"), "export const helper = true;\n");
      expect(() => assertFrameworkImportClosure(root, ["main.ts"], [])).toThrow("helper.ts");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("ratchets down and rejects growth", () => {
    const root = makeTempDirSync("count-loc-ratchet-");
    try {
      mkdirSync(join(root, "benchmark"));
      writeFileSync(
        join(root, "benchmark/loc-baseline.json"),
        JSON.stringify({ frameworkNormalised: 10, vanillaNormalised: 20 }),
      );
      const rows = [
        { arm: "vanilla" as const, file: "vanilla", raw: 20, plumbing: 10, game: 10, total: 20 },
        { arm: "framework" as const, file: "framework", raw: 8, plumbing: 4, game: 4, total: 8 },
      ];
      expect(assertFrameworkRatchet(rows, root)).toMatchObject({ current: 8, suggested: 8 });
      expect(() =>
        assertFrameworkRatchet(
          rows.map((row) => (row.arm === "framework" ? { ...row, total: 11 } : row)),
          root,
        ),
      ).toThrow("exceeds baseline");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("reports the platformer template LOC without capping it", () => {
    expect(countPlatformerTemplateLoc()).toBeGreaterThan(0);
  });

  it("prices the seven authored touch-control copies against a shared-export estimate", () => {
    const comparison = countTemplateTouchControlsLoc();

    expect(comparison.copies).toHaveLength(7);
    expect(comparison.total).toBe(comparison.copies.reduce((sum, copy) => sum + copy.lines, 0));
    expect(comparison.hypotheticalSharedExport).toBe(
      Math.max(...comparison.copies.map((copy) => copy.lines)),
    );
    expect(comparison.duplicated).toBe(comparison.total - comparison.hypotheticalSharedExport);
    expect(comparison.duplicated).toBeGreaterThan(0);
  });

  // PRD-217 removed the starter's second HUD, so what this prices now is the one HUD that runs
  // everywhere. Same bar: the generated source must stay smaller than the geometry HUD it replaces.
  it("prices the generated HUD against the geometry HUD", () => {
    const comparison = countGeneratedHudLoc();

    expect(comparison.generated).toBeLessThanOrEqual(comparison.geometry);
  });

  it("prices heightfield framework wiring against every proven game repetition", () => {
    const comparison = countWorldHeightfieldLoc(2);

    expect(comparison.portableRepeated).toBe(comparison.implementation * 2);
    expect(comparison.framework).toBe(comparison.implementation + comparison.wiring);
    expect(comparison.framework).toBeLessThan(comparison.portableRepeated);
    expect(() => countWorldHeightfieldLoc(0)).toThrow("positive integer");
  });

  it("prices cloth across flag, cape, and curtain consumers", () => {
    const comparison = countSoftBodyFeatureLoc();

    expect(comparison.consumers).toEqual(["flag", "cape", "curtain"]);
    expect(comparison.framework).toBe(comparison.frameworkCallers);
    expect(comparison.handwritten).toBe(
      comparison.portableImplementation + comparison.handwrittenCallers,
    );
    expect(comparison.handwritten).toBeGreaterThan(comparison.framework * 2);
  });
});
