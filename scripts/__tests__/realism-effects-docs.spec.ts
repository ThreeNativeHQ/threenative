import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  REALISM_EFFECTS_TABLE_BEGIN,
  REALISM_EFFECTS_TABLE_END,
  replaceRealismEffectsCoverageTable,
} from "../realism-effects-docs.js";

const README_PATH = path.resolve("docs/PRDs/realism-effects/README.md");

describe("realism-effects coverage documentation", () => {
  it("keeps the checked-in table equal to the generated fixture", async () => {
    const readme = await readFile(README_PATH, "utf8");
    expect(replaceRealismEffectsCoverageTable(readme)).toBe(readme);
  });

  it("fails closed when the generated table markers are missing", () => {
    expect(() => replaceRealismEffectsCoverageTable("# missing table", "fixture.md")).toThrow(
      "TN_REALISM_EFFECTS_TABLE_MARKERS_MISSING: fixture.md",
    );
  });

  it("keeps stable marker names for automated updates", () => {
    expect(REALISM_EFFECTS_TABLE_BEGIN).toBe("<!-- BEGIN GENERATED: realism-effects-coverage -->");
    expect(REALISM_EFFECTS_TABLE_END).toBe("<!-- END GENERATED: realism-effects-coverage -->");
  });
});
