import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourceDirectory = path.resolve("packages/core/src");

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
});
