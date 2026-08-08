import { describe, expect, it } from "vitest";
import {
  CENSUS_CLASSES,
  classifyCensusLine,
  collectArmCensus,
  renderArmCensus,
  validateCensus,
} from "../arm-census.js";

describe("arm census", () => {
  it("classifies shared syntax into the four declared classes", () => {
    expect(classifyCensusLine('import { Scene } from "three";')).toBe("plumbing");
    expect(classifyCensusLine("new THREE.Mesh(geometry, material);")).toBe("look");
    expect(classifyCensusLine("for (const pearl of pearls) {")).toBe("pattern");
    expect(classifyCensusLine("ctx.add(createLighting());")).toBe("game");
    expect(classifyCensusLine("score += 1;")).toBe("game");
    expect(classifyCensusLine("const unknown = value;")).toBe("game");
  });

  it("reconciles every classified line with count-loc", () => {
    const census = collectArmCensus();
    expect(census.files).toHaveLength(5);
    expect(census.files.every((file) => file.lines.length === file.total)).toBe(true);
    expect(
      census.files.every(
        (file) =>
          CENSUS_CLASSES.reduce((total, kind) => total + file.counts[kind], 0) === file.total,
      ),
    ).toBe(true);
    expect(census.files.find((file) => file.arm === "vanilla")?.total).toBe(473);
    expect(
      census.files
        .filter((file) => file.arm === "framework")
        .reduce((total, file) => total + file.total, 0),
    ).toBe(432);
  });

  it("renders the measured ratio and class table", () => {
    const markdown = renderArmCensus(collectArmCensus(), "2026-08-07");
    expect(markdown).toContain("432 / 473 = 91.3%");
    expect(markdown).toContain(
      "| Arm | Look | Game | Pattern | Plumbing | Normalized LOC | Raw LOC |",
    );
    expect(markdown).toContain("Classified line ranges");
  });

  it("fails closed when class counts do not reconcile", () => {
    const census = collectArmCensus();
    const first = census.files[0];
    if (first === undefined) throw new Error("Expected a census file fixture.");
    const invalid = {
      files: [
        {
          ...first,
          counts: { ...first.counts, game: first.counts.game + 1 },
        },
        ...census.files.slice(1),
      ],
    };
    expect(() => validateCensus(invalid)).toThrow(/does not match classified lines/u);

    const balancedButContradictory = {
      files: [
        {
          ...first,
          counts: {
            ...first.counts,
            game: first.counts.game - 1,
            look: first.counts.look + 1,
          },
        },
        ...census.files.slice(1),
      ],
    };
    expect(() => validateCensus(balancedButContradictory)).toThrow(
      /does not match classified lines/u,
    );
  });
});
