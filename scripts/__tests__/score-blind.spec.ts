import { readFileSync } from "node:fs";
import { makeTempDirSync } from "../../test-support/temp-dir.js";

import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  createBlindBundle,
  createImageBlindBundle,
  stripArmIdentifiers,
  validatePromptHash,
} from "../score-blind.js";

function pngFixture(): Buffer {
  const png = new PNG({ height: 2, width: 2 });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = offset === 0 ? 255 : 20;
    png.data[offset + 1] = 80;
    png.data[offset + 2] = 140;
    png.data[offset + 3] = 255;
  }
  return PNG.sync.write(png);
}

function pngWithArmText(): Buffer {
  const png = pngFixture();
  const data = Buffer.from("Comment=@threenative/framework", "utf8");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write("tEXt", 4, 4, "ascii");
  data.copy(chunk, 8);
  return Buffer.concat([png.subarray(0, png.length - 12), chunk, png.subarray(png.length - 12)]);
}

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

  it("writes metadata-free blind image samples and an external reveal", () => {
    const root = makeTempDirSync("score-blind-images-");
    const bundleDirectory = join(root, "bundle");
    const revealPath = join(root, "reveal.json");
    const bundle = createImageBlindBundle(
      "prompt-hash",
      [
        { arm: "framework", content: pngWithArmText(), id: "framework-1" },
        { arm: "vanilla", content: pngFixture(), id: "vanilla-1" },
      ],
      bundleDirectory,
      revealPath,
      "fixture-seed",
    );

    expect(bundle.samples.map(({ label }) => label)).toEqual(["sample-01", "sample-02"]);
    const firstSample = bundle.samples[0];
    if (firstSample === undefined) throw new Error("Image bundle has no samples.");
    const imagePath = join(bundleDirectory, firstSample.image);
    expect(PNG.sync.read(readFileSync(imagePath)).width).toBe(2);
    expect(readFileSync(imagePath).toString("utf8")).not.toContain("threenative");
    expect(readFileSync(join(bundleDirectory, "bundle.json"), "utf8")).not.toMatch(
      /framework|vanilla/i,
    );
    expect(readFileSync(revealPath, "utf8")).toMatch(/framework|vanilla/);
  });

  it("voids image bundles with a missing arm or an in-bundle reveal", () => {
    const root = makeTempDirSync("score-blind-images-invalid-");
    const png = pngFixture();
    expect(() =>
      createImageBlindBundle(
        "prompt-hash",
        [
          { arm: "framework", content: png, id: "framework-1" },
          { arm: "framework", content: png, id: "framework-2" },
        ],
        join(root, "bundle"),
        join(root, "reveal.json"),
      ),
    ).toThrow(/missing required arm/);
    expect(() =>
      createImageBlindBundle(
        "prompt-hash",
        [
          { arm: "framework", content: png, id: "framework-1" },
          { arm: "vanilla", content: png, id: "vanilla-1" },
        ],
        join(root, "bundle"),
        join(root, "bundle", "reveal.json"),
      ),
    ).toThrow(/reveal mapping must be outside/);
  });
});
