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

  // Three rounds of sweeps lost time to these two conventions because the types state a
  // number and nothing states which way it points. The doc comments are the fix, so they
  // are gated: deleting one is a failing change, not a tidy-up.
  it("states the gravity sign and the capsule origin at the call site", async () => {
    const [character, shape] = await Promise.all([
      readFile(new URL("../src/CharacterBody3D.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/CollisionShape3D.ts", import.meta.url), "utf8"),
    ]);

    expect(character).toMatch(/down is negative/i);
    expect(shape).toMatch(/centred on the body's origin/i);
    expect(shape).toMatch(/halfHeight \+ radius/);
  });

  it("keeps the parity evidence linked from the native PRD index", async () => {
    const [report, nativeIndex] = await Promise.all([
      readFile(new URL("../../../docs/verification/PRD-049.md", import.meta.url), "utf8"),
      readFile(new URL("../../../docs/PRDs/native/README.md", import.meta.url), "utf8"),
    ]);

    expect(report).toContain("# PRD-049 — physics parity verification");
    expect(nativeIndex).toContain("docs/verification/PRD-049.md");
  });
});
