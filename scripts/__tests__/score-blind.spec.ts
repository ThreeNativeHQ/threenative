import { describe, expect, it } from "vitest";
import { createBlindBundle, stripArmIdentifiers, validatePromptHash } from "../score-blind.js";

describe("score-blind", () => {
  it("removes every arm identifier from scoring artifacts", () => {
    const redacted = stripArmIdentifiers(
      "@threenative/core in abyss-framework is compared with the vanilla control in Arm A.",
    );

    expect(redacted).not.toMatch(/threenative|vanilla|framework|control|arm\s*a/i);
  });

  it("shuffles artifacts deterministically and replaces source labels", () => {
    const artifacts = [
      { arm: "framework", id: "a", content: "first framework artifact" },
      { arm: "vanilla", id: "b", content: "second vanilla artifact" },
      { arm: "framework", id: "c", content: "third framework artifact" },
    ];
    const first = createBlindBundle("prompt-hash", artifacts, "fixture-seed");
    const second = createBlindBundle("prompt-hash", artifacts, "fixture-seed");

    expect(first).toEqual(second);
    expect(first.artifacts.map((artifact) => artifact.label)).toEqual([
      "sample-01",
      "sample-02",
      "sample-03",
    ]);
    expect(JSON.stringify(first)).not.toMatch(/framework|vanilla|artifact-[abc]/i);
  });

  it("voids a result whose prompt hash differs", () => {
    expect(validatePromptHash("sealed", "edited")).toEqual({
      reason: "Prompt hash mismatch: expected sealed, received edited.",
      verdict: "void",
    });
  });
});
