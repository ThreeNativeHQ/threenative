import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("quality JSON command", () => {
  it(
    "should emit only parseable finding records through the documented silent form",
    { timeout: 20_000 },
    () => {
      const result = spawnSync("pnpm", ["--silent", "quality", "--json"], {
        cwd: path.resolve("."),
        encoding: "utf8",
      });

      expect(result.status, result.stderr).toBe(0);
      const records = result.stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(records.length).toBeGreaterThan(0);
      for (const record of records)
        expect(record).toEqual(
          expect.objectContaining({
            file: expect.any(String),
            line: expect.any(Number),
            signal: expect.any(String),
            state: expect.stringMatching(/^(?:new|grew|inherited|waived)$/u),
            threshold: expect.anything(),
            value: expect.anything(),
          }),
        );

      const unknownCasts = records.filter((record) => record.signal === "suppression/unknown-cast");
      const biomeIgnores = records.filter((record) => record.signal === "suppression/biome-ignore");
      expect(unknownCasts.length).toBeGreaterThan(0);
      expect(biomeIgnores.length).toBeGreaterThan(0);
      expect(unknownCasts.every((record) => record.threshold === 10)).toBe(true);
      expect(biomeIgnores.every((record) => record.threshold === 1)).toBe(true);
      expect(records.some((record) => record.threshold === 14 || record.threshold === 2)).toBe(
        false,
      );
    },
  );
});
