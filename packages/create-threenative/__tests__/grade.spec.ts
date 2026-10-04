import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
  const out = path.join(mkdtempSync(path.join(tmpdir(), "tn-grade-")), "grade.cube");
  execFileSync(process.execPath, [GENERATOR, ...flags, "--out", out]);
  return readFileSync(out, "utf8");
}

/**
 * `LUTCubeLoader.parse`, reduced to what it decides: the edge length, and four bytes per texel in
 * x, y, z order with the load's `Number(text) * 255` written into a `Uint8Array` — so each stored
 * value is *truncated*, not rounded. A fact this file's arithmetic depends on more than any other,
 * and the four-bytes-per-texel stride is load-bearing for every read below.
 */
function loadTable(source: string): { size: number; bytes: Uint8Array } {
  const declared = /LUT_3D_SIZE +(\d+)/u.exec(source)?.[1];
  const size = Number(declared);
  if (!Number.isInteger(size) || size < 2) throw new Error("no LUT_3D_SIZE");
  const bytes = new Uint8Array(size ** 3 * 4);
  let texels = 0;
  for (const [, r, g, b] of source.matchAll(/^([\d.e+-]+) +([\d.e+-]+) +([\d.e+-]+) *$/gmu)) {
    const at = texels * 4;
    bytes[at] = Number(r) * 255;
    bytes[at + 1] = Number(g) * 255;
    bytes[at + 2] = Number(b) * 255;
    bytes[at + 3] = 255;
    texels += 1;
  }
  if (texels !== size ** 3) throw new Error(`parsed ${texels} texels, expected ${size ** 3}`);
  return { bytes, size };
}

/**
 * What `lut3D` does to one channel: pull in by half a texel so the sample starts at the centre of
 * the edge texels, then filter the uploaded bytes.
 *
 * The grid is separable — every texel's red depends only on x, green only on y, blue only on z —
 * so the hardware's trilinear filter collapses to one linear interpolation along this channel's own
 * axis, and that is what is computed here.
 */
function sampled(bytes: Uint8Array, size: number, value: number, channel: number): number {
  const stride = channel === 0 ? 1 : channel === 1 ? size : size ** 2;
  // Texel `i` of a Data3DTexture is sampled at normalised `(i + 0.5) / size`, so `value` 0 and 1
  // land on the first and last texel centre — which is what lut3D's half-texel pull-in arranges.
  const coord = (0.5 / size + value * (1 - 1 / size)) * size - 0.5;
  const low = Math.min(size - 2, Math.max(0, Math.floor(coord)));
  const frac = Math.min(1, Math.max(0, coord - low));
  const at = (index: number): number => bytes[index * stride * 4 + channel] ?? 0;
  return (at(low) * (1 - frac) + at(low + 1) * frac) / 255;
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
    for (let channel = 0; channel < 3; channel++) {
      for (let code = 0; code <= 255; code++) {
        const value = code / 255;
        const delta =
          Math.abs(sampled(identity.bytes, identity.size, value, channel) - value) * 255;
        if (delta > worst) {
          worst = delta;
          at = `channel ${channel} at display value ${value.toFixed(4)}`;
        }
      }
    }
    // The load truncates, so the table reads low by up to one step and never by two.
    expect(worst, `worst ${at}`).toBeLessThanOrEqual(1);
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
