import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("core package build", () => {
  it("should emit ESM and types for every export", async () => {
    const dist = path.resolve("packages/core/dist");
    expect(existsSync(path.join(dist, "index.js"))).toBe(true);
    expect(existsSync(path.join(dist, "index.d.ts"))).toBe(true);
    const module = await import(
      `${pathToFileURL(path.join(dist, "index.js")).href}?test=${Date.now()}`
    );
    expect(module.version).toBe("0.1.0");
  });
});
