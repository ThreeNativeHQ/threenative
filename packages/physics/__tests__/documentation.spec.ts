import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("published physics portability documentation", () => {
  it("states the backend version delta and replay boundary", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

    expect(readme).toContain("0.19.3");
    expect(readme).toContain("0.30.0");
    expect(readme).toMatch(/replays and snapshots[\s\S]*not portable/i);
    expect(readme).toMatch(/raw[\s\S]*backend-specific/i);
  });
});
