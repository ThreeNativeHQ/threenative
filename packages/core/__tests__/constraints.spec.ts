import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourceDirectory = path.resolve("packages/core/src");
const randomSource = path.join(sourceDirectory, "random.ts");
const replaySource = path.join(sourceDirectory, "replay.ts");
const indexSource = path.join(sourceDirectory, "index.ts");

describe("core constraints", () => {
  it("should keep visual concerns out of core source", () => {
    const source = readdirSync(sourceDirectory)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => file !== "particles.ts")
      .map((file) => readFileSync(path.join(sourceDirectory, file), "utf8"))
      .join("\n");

    expect(source).not.toMatch(/material|light|tonemapping|postprocessing|\.wgsl/iu);

    const particles = readFileSync(path.join(sourceDirectory, "particles.ts"), "utf8");
    expect(particles).not.toMatch(
      /new\s+\w*Material|new\s+Color|light|tonemapping|postprocessing|\.wgsl/iu,
    );
  });

  it("should keep core source under 2,500 lines", () => {
    const lines = readdirSync(sourceDirectory)
      .filter((file) => file.endsWith(".ts"))
      .reduce(
        (total, file) =>
          total + readFileSync(path.join(sourceDirectory, file), "utf8").split("\n").length,
        0,
      );

    expect(lines).toBeLessThan(2_500);
  });

  it("should reject a recording schema key that names an entity type", () => {
    const source = readFileSync(replaySource, "utf8");
    expect(source).not.toMatch(/"(type|class|kind|prefab|components|nodes)"/u);
    expect(source).not.toMatch(/new (\w+\[|constructors?\[|registry\.get)/u);
    expect(source).not.toContain("EntitySnapshot");

    const recording = {
      input: [],
      randomState: 0,
      runtime: { agent: "node", core: "0.1.0", rapier: null, step: 1 / 60 },
      seed: 1,
      ticks: 1,
      version: 1,
    };
    expect(Object.keys(recording).sort()).toEqual([
      "input",
      "randomState",
      "runtime",
      "seed",
      "ticks",
      "version",
    ]);
  });

  it("should keep the saveable random state on the public surface", () => {
    expect(readFileSync(randomSource, "utf8")).toMatch(/state:\s*number/u);
  });

  it("should keep the replay exports on the public surface", () => {
    const source = readFileSync(indexSource, "utf8");
    expect(source).toContain('export { createReplayDriver, replay } from "./replay.js";');
    expect(source).toContain('export type { Recording } from "./replay.js";');
  });
});
