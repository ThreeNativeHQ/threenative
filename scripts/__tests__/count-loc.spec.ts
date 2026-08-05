import { describe, expect, it } from "vitest";
import {
  PLATFORMER_LOC_LIMIT,
  classifyVanillaLine,
  collectLoc,
  countLines,
  countPlatformerTemplateLoc,
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
    expect(vanilla[0]?.total).toBe(410);
    expect(rows.every((row) => row.plumbing + row.game === row.total)).toBe(true);
  });

  it("renders a generated table with an explicit vanilla result column", () => {
    const table = renderLocTable(collectLoc());

    expect(table).toContain("Plumbing LOC");
    expect(table).toContain("Vanilla wins?");
    expect(table).toContain("Static result:");
  });

  it("keeps the platformer template below the fox-game control", () => {
    expect(countPlatformerTemplateLoc()).toBeLessThan(PLATFORMER_LOC_LIMIT);
  });
});
