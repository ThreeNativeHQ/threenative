import { existsSync } from "node:fs";
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
  // Skipped rather than deleted while the batch it documents is archived. `ee63eea9` removed
  // `docs/PRDs/realism-effects/README.md` and left this generator and its test behind, which took
  // both `pnpm build` and `pnpm test` down with an ENOENT on a file nobody meant to keep. If the
  // README returns, this asserts again with no further change.
  it.skipIf(!existsSync(README_PATH))(
    "keeps the checked-in table equal to the generated fixture",
    async () => {
      const readme = await readFile(README_PATH, "utf8");
      expect(replaceRealismEffectsCoverageTable(readme)).toBe(readme);
    },
  );

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
