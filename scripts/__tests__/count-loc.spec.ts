import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLATFORMER_LOC_LIMIT,
  assertFrameworkImportClosure,
  assertFrameworkRatchet,
  classifyVanillaLine,
  collectLoc,
  countLines,
  countPlatformerTemplateLoc,
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
    expect(table).toContain("85.0%");
    expect(table).toContain("Vanilla wins?");
    expect(table).toContain("Static result:");
  });

  it("fails closed when a counted fixture imports an uncounted sibling", () => {
    const root = mkdtempSync(join(tmpdir(), "count-loc-closure-"));
    try {
      writeFileSync(join(root, "main.ts"), 'import "./helper.js";\n');
      writeFileSync(join(root, "helper.ts"), "export const helper = true;\n");
      expect(() => assertFrameworkImportClosure(root, ["main.ts"], [])).toThrow("helper.ts");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("ratchets down and rejects growth", () => {
    const root = mkdtempSync(join(tmpdir(), "count-loc-ratchet-"));
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

  it("keeps the platformer template below the fox-game control", () => {
    expect(countPlatformerTemplateLoc()).toBeLessThan(PLATFORMER_LOC_LIMIT);
  });
});
