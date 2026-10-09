import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";
import {
  type IGradeSettings,
  type IGradeTable,
  gradeStages,
} from "../templates/starter/src/render/grade.js";
import {
  gradePreset,
  qualityPreset,
  resolveQualityTier,
} from "../templates/starter/src/render/quality.js";

const TOOLS = path.resolve("packages/create-threenative/templates/starter/tools");
const GENERATOR = path.join(TOOLS, "make-grade-lut.mjs");
const SHIPPED = path.resolve("packages/create-threenative/templates/starter/public/grade.cube");

/** Run the shipped generator, exactly as the template's `package.json` would. */
function writeTable(...flags: readonly string[]): string {
  const out = path.join(makeTempDirSync("tn-grade-"), "grade.cube");
  execFileSync(process.execPath, [GENERATOR, ...flags, "--out", out]);
  return readFileSync(out, "utf8");
}

/**
 * `LUTCubeLoader.parse` in the shape `grade.ts` loads it — `setType(FloatType)` — reduced to what it
 * decides: the edge length, and four floats per texel in x, y, z order holding the file's own
 * numbers (`scale` is 1 on this path, so nothing is quantised on the way in). The four-bytes-per-
 * texel stride is load-bearing for every read below, and so is the fact that a 3D texture is
 * sampled, not indexed: the loader also defaults to `UnsignedByteType`, which *truncates*
 * `value * 255` into a `Uint8Array` and is what this path exists to avoid.
 */
function loadTable(source: string): { size: number; bytes: Float32Array } {
  const declared = /LUT_3D_SIZE +(\d+)/u.exec(source)?.[1];
  const size = Number(declared);
  if (!Number.isInteger(size) || size < 2) throw new Error("no LUT_3D_SIZE");
  const bytes = new Float32Array(size ** 3 * 4);
  let texels = 0;
  for (const [, r, g, b] of source.matchAll(/^([\d.e+-]+) +([\d.e+-]+) +([\d.e+-]+) *$/gmu)) {
    const at = texels * 4;
    bytes[at] = Number(r);
    bytes[at + 1] = Number(g);
    bytes[at + 2] = Number(b);
    bytes[at + 3] = 1;
    texels += 1;
  }
  if (texels !== size ** 3) throw new Error(`parsed ${texels} texels, expected ${size ** 3}`);
  return { bytes, size };
}

/**
 * What `lut3D` does to one channel: pull in by half a texel so the sample starts at the centre of
 * the edge texels, then filter the uploaded values.
 *
 * The grid is separable — every texel's red depends only on x, green only on y, blue only on z —
 * so the hardware's trilinear filter collapses to one linear interpolation along this channel's own
 * axis, and that is what is computed here.
 */
function sampled(bytes: Float32Array, size: number, value: number, channel: number): number {
  const stride = channel === 0 ? 1 : channel === 1 ? size : size ** 2;
  // Texel `i` of a Data3DTexture is sampled at normalised `(i + 0.5) / size`, so `value` 0 and 1
  // land on the first and last texel centre — which is what lut3D's half-texel pull-in arranges.
  const coord = (0.5 / size + value * (1 - 1 / size)) * size - 0.5;
  const low = Math.min(size - 2, Math.max(0, Math.floor(coord)));
  const frac = Math.min(1, Math.max(0, coord - low));
  const at = (index: number): number => bytes[index * stride * 4 + channel] ?? 0;
  return at(low) * (1 - frac) + at(low + 1) * frac;
}

/** The shipped table read back through the loader, so a change in the file cannot pass unnoticed. */
const shipped = loadTable(readFileSync(SHIPPED, "utf8"));
const identity = loadTable(writeTable("--identity"));

/**
 * The starter's colour grade is generated source, so its claim is proved here rather than only in a
 * capture (PRD-492): with the grain off, an **identity** table must hand the frame back within one
 * 8-bit step per channel. The capture's `maxChannelDelta` is the same claim measured on the real
 * frame; this is the arithmetic underneath it, over every value the frame can hold.
 *
 * It is a claim about the seat the stage takes, not about a fitted curve. `grade.ts` grades after
 * the output transform, where a `.cube` and an 8-bit texture already share one domain, so the
 * table's own quantisation is the whole of the error. Mapping scene-referred light onto that domain
 * and back was measured and dropped: the best two-parameter shaper cost 2.0 steps per channel, and
 * `(x/W)^g / (1 + (x/W)^g)` at `W = 4, g = 1/2.2` cost 4.3, against one here.
 */
describe("starter grade table", () => {
  it("round-trips every value the frame can hold within one 8-bit step", () => {
    let worst = 0;
    let at = "";
    let signed = 0;
    let samples = 0;
    for (let channel = 0; channel < 3; channel++) {
      for (let code = 0; code <= 255; code++) {
        const value = code / 255;
        const delta = (sampled(identity.bytes, identity.size, value, channel) - value) * 255;
        if (Math.abs(delta) > worst) {
          worst = Math.abs(delta);
          at = `channel ${channel} at display value ${value.toFixed(4)}`;
        }
        signed += delta;
        samples += 1;
      }
    }
    // A float table stores the file's own numbers, so the round trip is the box's one step rather
    // than the truncation an 8-bit load made of it — and it is not biased low, which is what the
    // measured frame half saw at a signed mean of −0.5737 codes.
    expect(worst, `worst ${at}`).toBeLessThanOrEqual(1);
    expect(
      Math.abs(signed / samples),
      `signed mean ${(signed / samples).toFixed(4)} codes`,
    ).toBeLessThanOrEqual(0.01);
  });

  it("keeps the 9³ grid inside 8 steps of the grade the generator wrote", () => {
    // A coarse grid bends a smooth curve between texels, and the constants come from the generator
    // itself, so raising its contrast — or its SIZE — cannot pass this unnoticed.
    const source = readFileSync(GENERATOR, "utf8");
    const number = (pattern: RegExp, label: string): number => {
      const found = pattern.exec(source)?.[1];
      if (found === undefined)
        throw new Error(`tools/make-grade-lut.mjs no longer defines ${label}`);
      return Number(found);
    };
    const contrast = number(/^const CONTRAST = ([\d.]+);$/mu, "CONTRAST");
    const pivot = number(/^const PIVOT = ([\d.]+);$/mu, "PIVOT");
    // `GAIN` is written `b`, `g`, `r`; the uploaded texture's axes are red, green, blue.
    const gain = [..."rgb"].map((name) =>
      number(new RegExp(`^const GAIN = \\{[^}]*\\b${name}: ([\\d.]+)`, "mu"), `GAIN.${name}`),
    );
    const grade = (value: number, channel: number): number =>
      Math.min(1, pivot ** (1 - contrast) * value ** contrast * (gain[channel] ?? 1));

    let worst = 0;
    for (let channel = 0; channel < 3; channel++) {
      for (let code = 0; code <= 255; code++) {
        const value = code / 255;
        worst = Math.max(
          worst,
          Math.abs(sampled(shipped.bytes, shipped.size, value, channel) - grade(value, channel)) *
            255,
        );
      }
    }
    // All of it lives in the top interval of a channel whose gain clips; see SIZE in the generator.
    expect(worst).toBeLessThan(8);
  });

  it("leaves the table's own edges at the frame's own edges", () => {
    // A grid that does not reach 0 and 1 lifts the blacks and washes the highlights, and it is
    // invisible in the arithmetic above because that measures the identity table.
    for (const channel of [0, 1, 2]) {
      expect(sampled(shipped.bytes, shipped.size, 0, channel)).toBeCloseTo(0, 6);
      expect(sampled(shipped.bytes, shipped.size, 1, channel)).toBeCloseTo(1, 6);
    }
  });
});

/**
 * A default must never degrade the look it ships with (owner, PRD-492). This table first shipped
 * with a 13% warm spread, and a blind judge compared the starter with it against the starter with
 * no table at all and preferred **no table**: grey concrete read as sandstone, the sky as cream,
 * the frame as mud. So the shipped numbers answer to three claims, measured here on the shipped
 * table — arithmetic, not a capture, and `sampled()` is what the hardware returns.
 */
describe("the shipped grade is a default, not a look", () => {
  const at = (value: number, channel: number): number =>
    sampled(shipped.bytes, shipped.size, value, channel);

  it("moves concrete and sky by at most one 8-bit step of hue", () => {
    // The two surfaces the judge named. The warm spread is this r/b distance, and the shipped
    // table stores 8-bit codes, so the claim is a count of codes — which also absorbs the 9³
    // interpolation's own sub-step noise. The table this replaced moved concrete by 12.
    for (const [surface, value] of [
      ["concrete", 0.35],
      ["sky", 0.9],
    ] as const) {
      const codes = Math.round(Math.abs(at(value, 0) - at(value, 2)) * 255);
      expect(codes, surface).toBeLessThanOrEqual(1);
    }
  });

  it("keeps more contrast than the ungraded frame, and lifts no black", () => {
    expect(at(0.75, 1)).toBeGreaterThan(0.75);
    expect(at(0.05, 1)).toBeLessThan(0.05);
  });
});

/** A table that exists. `available()` never reads it — `build()` does. */
const LOADED: IGradeTable = { size: 9, texture: {} as IGradeTable["texture"] };

/**
 * What the chain will be told, asked of the stage objects themselves rather than of a helper: this
 * is the path `TN_RENDER_CHAIN`'s `dropped` list is built from.
 */
const available = (
  name: "grade" | "grain",
  settings: IGradeSettings,
  tableLoaded: boolean,
): boolean | string | undefined =>
  gradeStages(settings, tableLoaded ? LOADED : undefined)
    .find((stage) => stage.name === name)
    ?.available?.(undefined as never);

describe("starter grade tiers", () => {
  it("runs grade and grain at high", () => {
    const settings = gradePreset("high");
    expect(available("grade", settings, true)).toBe(true);
    expect(available("grain", settings, true)).toBe(true);
  });

  it("refuses grain at low with a reason, and refuses grade while the table is still loading", () => {
    const settings = gradePreset("low");
    expect(available("grain", settings, true)).toBe("grainIntensity:0");
    expect(available("grade", settings, false)).toBe("lut:pending");
    expect(available("grade", settings, true)).toBe(true);
  });

  it("refuses the grade outright when this game set its intensity to zero", () => {
    expect(available("grade", { ...gradePreset("high"), gradeIntensity: 0 }, true)).toBe(
      "gradeIntensity:0",
    );
    expect(available("grain", { ...gradePreset("high"), grainIntensity: 0 }, true)).toBe(
      "grainIntensity:0",
    );
  });

  it("keeps the shipped grain below what an 8-bit frame can show", () => {
    // `film()` returns `base + base * clamp(noise + 0.1, 0, 1)`, so its largest move on a pixel is
    // that pixel's own value times the intensity — at white, the intensity alone. It shipped at
    // 0.12 and a blind judge named the result: "grain clearly visible as speckle over sky and flat
    // walls". A default must not degrade the look, so the number stays under one step; it stays
    // above zero so `TN_RENDER_CHAIN` can still name grain as applied at `high`.
    for (const tier of ["low", "medium", "high"] as const) {
      const intensity = gradePreset(tier).grainIntensity;
      expect(intensity * 255, tier).toBeLessThanOrEqual(1);
    }
    expect(gradePreset("high").grainIntensity).toBeGreaterThan(0);
  });

  it("keeps every tier's presets reachable by name and unknown names fatal", () => {
    for (const tier of ["low", "medium", "high"] as const) {
      expect(gradePreset(tier).gradeIntensity).toBeGreaterThan(0);
      expect(gradePreset(tier).tier).toBe(tier);
      expect(qualityPreset(tier)).toBeTruthy();
      expect(resolveQualityTier({ tier })).toBe(tier);
    }
    expect(() => gradePreset("ultra")).toThrow(/Unknown quality tier/u);
  });

  it("hands the chain one stage that owns the output transform and one that follows it", () => {
    // `grain` may not claim the seat: two stages claiming it would both expect the transform, and
    // the chain refuses a stage that declares it with an anchor.
    const stages = gradeStages(gradePreset("high"), LOADED);
    expect(stages.map((stage) => stage.name)).toEqual(["grade", "grain"]);
    expect(stages[0]?.afterOutputTransform).toBe(true);
    expect(stages[0]?.after).toBeUndefined();
    expect(stages[1]?.after).toBe("grade");
    expect(stages[1]?.afterOutputTransform).toBeUndefined();
  });
});
