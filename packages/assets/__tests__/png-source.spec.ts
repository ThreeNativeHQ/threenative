import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PNG_HOME = path.resolve("packages/assets/src/png.ts");
const PNG_INDEX = path.resolve("packages/assets/src/index.ts");
const PNG_CONSUMERS = [
  {
    importPattern: /import \{[^}]*\bparsePng\b[^}]*\} from "\.\/png\.js";/u,
    path: path.resolve("packages/assets/src/health.ts"),
  },
  {
    importPattern: /import \{[^}]*\bparsePng\b[^}]*\} from "\.\.\/png\.js";/u,
    path: path.resolve("packages/assets/src/passes/decode-image.ts"),
  },
  {
    importPattern: /import \{[^}]*\bparsePng\b[^}]*\} from "@threenative\/assets";/u,
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
      // Symbol and module, not the exact statement text: a consumer that also imports another
      // symbol from the same module still gets `parsePng` from the one parser home, which is what
      // this test exists to guarantee. `config.ts` imports `parseAudioConfig` alongside it.
      expect(source).toMatch(consumer.importPattern);
      expect(source).not.toContain("PNG_SIGNATURE");
      expect(source).not.toMatch(/function (?:parsePng|pngHasAlpha)\s*\(/u);
      expect(source).not.toContain("tRNS");
    }
  });
});
