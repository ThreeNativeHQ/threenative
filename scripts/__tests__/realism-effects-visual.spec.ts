import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  REALISM_EFFECT_VISUAL_VARIANTS,
  assertVisualVariantComparisons,
} from "../realism-effects-visual.js";

function image(colours: readonly (readonly [number, number, number])[]): Buffer {
  const png = new PNG({ height: 1, width: colours.length });
  for (const [index, [red, green, blue]] of colours.entries()) {
    const offset = index * 4;
    png.data[offset] = red;
    png.data[offset + 1] = green;
    png.data[offset + 2] = blue;
    png.data[offset + 3] = 255;
  }
  return PNG.sync.write(png);
}

const off = image([
  [5, 8, 16],
  [32, 48, 64],
  [96, 112, 128],
  [180, 196, 212],
]);
const defaultVariant = image([
  [12, 16, 28],
  [42, 60, 78],
  [112, 126, 144],
  [204, 220, 238],
]);
const changed = image([
  [26, 8, 40],
  [58, 34, 92],
  [132, 80, 168],
  [230, 178, 248],
]);

describe("realism-effects visual variants", () => {
  it("declares one changed named constant for each editable effect", () => {
    expect(REALISM_EFFECT_VISUAL_VARIANTS).toEqual([
      {
        changedConstant: "LENS_DISTORTION_K1",
        effect: "LensDistortionEffect",
        id: "lens-distortion",
      },
      { changedConstant: "SPARKLE_THRESHOLD", effect: "SparkleEffect", id: "sparkle" },
      {
        changedConstant: "GRADUAL_BACKGROUND_STRENGTH",
        effect: "GradualBackgroundEffect",
        id: "gradual-background",
      },
    ]);
  });

  it("requires both the off/default and default/changed frames to differ", () => {
    expect(() =>
      assertVisualVariantComparisons("SparkleEffect", {
        changed,
        default: defaultVariant,
        off,
      }),
    ).not.toThrow();
    expect(() =>
      assertVisualVariantComparisons("SparkleEffect", {
        changed: defaultVariant,
        default: defaultVariant,
        off,
      }),
    ).toThrow("TN_REALISM_EFFECT_VISUAL_UNCHANGED:SparkleEffect default/changed");
    expect(() =>
      assertVisualVariantComparisons("SparkleEffect", {
        changed,
        default: off,
        off,
      }),
    ).toThrow("TN_REALISM_EFFECT_VISUAL_UNCHANGED:SparkleEffect off/default");
  });
});
