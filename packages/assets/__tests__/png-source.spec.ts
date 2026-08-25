import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PNG_HOME = path.resolve("packages/assets/src/png.ts");
const PNG_INDEX = path.resolve("packages/assets/src/index.ts");
const PNG_CONSUMERS = [
  {
    importStatement: 'import { parsePng } from "./png.js";',
    path: path.resolve("packages/assets/src/health.ts"),
  },
  {
    importStatement: 'import { parsePng } from "../png.js";',
    path: path.resolve("packages/assets/src/passes/decode-image.ts"),
  },
  {
    importStatement: 'import { parsePng } from "@threenative/assets";',
    path: path.resolve("packages/create-threenative/src/config.ts"),
  },
] as const;

describe("PNG parser ownership", () => {
  it("keeps every PNG consumer on the one parser home", async () => {
    const parser = await readFile(PNG_HOME, "utf8");
    const index = await readFile(PNG_INDEX, "utf8");

    expect(parser.match(/const PNG_SIGNATURE =/gu)).toHaveLength(1);
    expect(index).toContain('export { parsePng } from "./png.js";');
    for (const consumer of PNG_CONSUMERS) {
      const source = await readFile(consumer.path, "utf8");
      expect(source).toContain(consumer.importStatement);
      expect(source).not.toContain("PNG_SIGNATURE");
      expect(source).not.toMatch(/function (?:parsePng|pngHasAlpha)\s*\(/u);
      expect(source).not.toContain("tRNS");
    }
  });
});
